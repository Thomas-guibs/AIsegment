// =============================================================================
// Snapshot extraction (spec §1)
//
//   HubSpot ──► snapshot ──► normalized model ──► metrics
//
// Extraction is decoupled from calculation on purpose: the snapshot freezes the
// CRM state so a past payout can be re-audited and the calculation tested.
// =============================================================================

import { hubspotSearch, type SearchFilterGroup } from "../hubspot/client"
import { batchReadWithHistory, fetchDealCompanyMap, type ObjectWithHistory } from "../hubspot/history"
import { getCached, setCache } from "../cache"
import { ATTRIBUTION } from "../constants"
import { buildTimeline, latestValue, type Timeline } from "./timeline"
import type { Account, Movement, Snapshot } from "./model"
import type { MovementType } from "./config"

const SNAPSHOT_CACHE_KEY = "engine_snapshot_v1"

/** Phases an account can hold and still belong to somebody's portfolio history. */
const TRACKED_PHASES = ["New", "To come", "Onboarding", "Activated", "Run", "churn"]

const HISTORY_PROPERTIES = [
  "total_revenue",
  "proprietaire_de_l_entreprise__csm_",
  "phase_du_client",
]

const ACCOUNT_PROPERTIES = ["name", ...HISTORY_PROPERTIES]

const MOVEMENT_ATTRIBUTIONS = [ATTRIBUTION.UPSELL, ATTRIBUTION.DOWNSELL, ATTRIBUTION.CHURN]

const DEAL_PROPERTIES = [
  "dealname",
  "amount",
  "attribution",
  "dealstage",
  "deal_eligibility",
  "date_de_paiement",
  "date_de_prise_en_compte",
  "hubspot_owner_id",
]

const ATTRIBUTION_TO_TYPE: Record<string, MovementType> = {
  [ATTRIBUTION.UPSELL]: "upsell",
  [ATTRIBUTION.DOWNSELL]: "downsell",
  [ATTRIBUTION.CHURN]: "churn",
}

interface RawDeal {
  id: string
  properties: Record<string, string | null>
}

// -----------------------------------------------------------------------------
// Parsers
// -----------------------------------------------------------------------------

function parseAmount(raw: string): number | undefined {
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function parseOwner(raw: string): string | undefined {
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parsePhase(raw: string): string | undefined {
  const trimmed = raw.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * `deal_eligibility` is an enumeration whose internal values are "true"/"false"
 * (displayed Oui/Non). Older exports use Yes/No — both are accepted. Anything
 * else, blank included, means *never filled in*, which is not the same as No.
 */
function parseEligibility(raw: string | null | undefined): boolean | null {
  if (raw == null) return null
  const value = raw.trim().toLowerCase()
  if (value === "") return null
  if (value === "true" || value === "yes" || value === "oui") return true
  if (value === "false" || value === "no" || value === "non") return false
  return null
}

/** HubSpot date properties come back as `YYYY-MM-DD` or an epoch in ms. */
function parseDateOnly(raw: string | null | undefined): string | null {
  if (!raw) return null
  const value = String(raw).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const epoch = Number(value)
  if (Number.isFinite(epoch) && epoch > 0) {
    return new Date(epoch).toISOString().slice(0, 10)
  }
  return null
}

// -----------------------------------------------------------------------------
// Accounts
// -----------------------------------------------------------------------------

function toAccount(raw: ObjectWithHistory, backfill: boolean): Account {
  const history = raw.propertiesWithHistory ?? {}

  const mrr = buildTimeline(history.total_revenue, parseAmount, { backfill })
  const csm = buildTimeline(history.proprietaire_de_l_entreprise__csm_, parseOwner, { backfill })
  const phase = buildTimeline(history.phase_du_client, parsePhase, { backfill })

  return {
    id: raw.id,
    name: raw.properties?.name ?? "",
    mrr: withCurrentFallback(mrr, parseAmount(raw.properties?.total_revenue ?? "")),
    csm: withCurrentFallback(csm, parseOwner(raw.properties?.proprietaire_de_l_entreprise__csm_ ?? "")),
    phase: withCurrentFallback(phase, parsePhase(raw.properties?.phase_du_client ?? "")),
    firstPaymentDate: null, // filled in from the deals, below
    currentMrr: latestValue(mrr) ?? parseAmount(raw.properties?.total_revenue ?? "") ?? 0,
    currentCsm: latestValue(csm) ?? raw.properties?.proprietaire_de_l_entreprise__csm_ ?? null,
    currentPhase: latestValue(phase) ?? parsePhase(raw.properties?.phase_du_client ?? "") ?? null,
  }
}

/**
 * When HubSpot returns no history at all for a property but the record does
 * carry a current value, treat that value as having always been true. Without
 * it the account would vanish from every month — a data gap masquerading as a
 * business rule, exactly what spec §2 warns against.
 */
function withCurrentFallback<T>(timeline: Timeline<T>, current: T | undefined): Timeline<T> {
  if (timeline.entries.length > 0 || current === undefined) return timeline
  return {
    entries: [{ timestamp: "1970-01-01T00:00:00Z", value: current }],
    earliest: "1970-01-01T00:00:00Z",
    backfilled: true,
  }
}

// -----------------------------------------------------------------------------
// Snapshot build
// -----------------------------------------------------------------------------

export interface SnapshotOptions {
  /** Carry the oldest known value of a history back to the origin of time. */
  backfillHistory?: boolean
  /** Ignore the cache and re-extract. */
  refresh?: boolean
}

export async function buildSnapshot(options: SnapshotOptions = {}): Promise<Snapshot> {
  const { backfillHistory = false, refresh = false } = options
  const cacheKey = `${SNAPSHOT_CACHE_KEY}_${backfillHistory ? "backfill" : "raw"}`

  if (!refresh) {
    const cached = getCached<Snapshot>(cacheKey)
    if (cached) return cached
  }

  // 1. Every deal that either carries a MRR movement or records a payment date.
  //    The second set matters for condition 4 of §3: the first billing of an
  //    account comes from its new-business deal, not from a movement.
  const dealFilterGroups: SearchFilterGroup[] = [
    { filters: [{ propertyName: "attribution", operator: "IN", values: [...MOVEMENT_ATTRIBUTIONS] }] },
    { filters: [{ propertyName: "date_de_paiement", operator: "HAS_PROPERTY" }] },
  ]

  const rawDeals = await hubspotSearch<RawDeal>("deals", {
    filterGroups: dealFilterGroups,
    properties: DEAL_PROPERTIES,
  })

  // De-duplicate: a deal can match both filter groups.
  const dealsById = new Map<string, RawDeal>()
  for (const deal of rawDeals) dealsById.set(deal.id, deal)
  const deals = Array.from(dealsById.values())

  // 2. Which account each deal belongs to.
  const dealToAccount = await fetchDealCompanyMap(deals.map((d) => d.id))

  // 3. Accounts: those tracked today, plus any account a deal points at. A
  //    company that has since been re-phased must still be replayable.
  const trackedAccounts = await hubspotSearch<{ id: string }>("companies", {
    filterGroups: [
      { filters: [{ propertyName: "phase_du_client", operator: "IN", values: TRACKED_PHASES }] },
    ],
    properties: ["name"],
  })

  const accountIds = new Set<string>(trackedAccounts.map((c) => c.id))
  for (const accountId of dealToAccount.values()) accountIds.add(accountId)

  const rawAccounts = await batchReadWithHistory(
    "companies",
    Array.from(accountIds),
    ACCOUNT_PROPERTIES,
    HISTORY_PROPERTIES
  )

  const accounts = rawAccounts.map((raw) => toAccount(raw, backfillHistory))
  const accountsById = new Map(accounts.map((a) => [a.id, a]))

  // 4. First billing per account = oldest effective payment date across its
  //    deals, all attributions confounded (spec §3, condition 4).
  const firstPayment = new Map<string, string>()
  for (const deal of deals) {
    const accountId = dealToAccount.get(deal.id)
    if (!accountId) continue
    const paymentDate = parseDateOnly(deal.properties.date_de_paiement)
    if (!paymentDate) continue
    const known = firstPayment.get(accountId)
    if (!known || paymentDate < known) firstPayment.set(accountId, paymentDate)
  }
  for (const [accountId, date] of firstPayment) {
    const account = accountsById.get(accountId)
    if (account) account.firstPaymentDate = date
  }

  // 5. Movements.
  const movements: Movement[] = []
  for (const deal of deals) {
    const attribution = deal.properties.attribution
    const type = attribution ? ATTRIBUTION_TO_TYPE[attribution] : undefined
    if (!type) continue

    const accountId = dealToAccount.get(deal.id) ?? null
    const rawAmount = parseAmount(deal.properties.amount ?? "") ?? 0

    movements.push({
      id: deal.id,
      name: deal.properties.dealname ?? "",
      type,
      amount: Math.abs(rawAmount),
      rawAmount,
      paymentDate: parseDateOnly(deal.properties.date_de_paiement),
      operationDate: parseDateOnly(deal.properties.date_de_prise_en_compte),
      eligibility: parseEligibility(deal.properties.deal_eligibility),
      stage: deal.properties.dealstage ?? "",
      dealOwnerId: deal.properties.hubspot_owner_id ?? null,
      accountId,
      accountName: accountId ? accountsById.get(accountId)?.name ?? null : null,
    })
  }

  const snapshot: Snapshot = {
    capturedAt: new Date().toISOString(),
    accounts,
    movements,
    accountsById,
  }

  setCache(cacheKey, snapshot)
  return snapshot
}

export { parseEligibility, parseDateOnly }
