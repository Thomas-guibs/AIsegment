// =============================================================================
// Metrics engine — orchestration
//
//   snapshot ──► movements (§5) ──► portfolio (§3–4) ──► NRR (§6)
//                     │                    │
//                     └──────► diagnostics (§9) ◄──────┘
//
// Implementation order follows spec §13: point-in-time first, everything else
// depends on it.
// =============================================================================

import { format, startOfMonth, subMonths } from "date-fns"
import { fr } from "date-fns/locale"

import { buildSnapshot, type SnapshotOptions } from "./snapshot"
import { filterMovements, countedChurns, type RetainedMovement } from "./movements"
import { computePortfolioMonth, startingMrr, type PortfolioMonth } from "./portfolio"
import { computeMonthly, aggregateNrr, round2, type MonthlyMetrics, type AggregateNrr } from "./metrics"
import { groupRejections, type Diagnostics } from "./diagnostics"
import { loadOverrides, CONFIGURED_OVERRIDES, type DealOverride } from "./overrides"
import { resolveConfig, type MetricsConfig } from "./config"
import { SALES_STAGE_LABELS, CSM_TEAM, getCsmName } from "../constants"
import type { Snapshot } from "./model"

export interface MovementDetail {
  id: string
  name: string
  type: string
  amount: number
  rawAmount: number
  accountId: string | null
  accountName: string | null
  referenceDate: string | null
  stage: string
  eligibility: boolean | null
  csmId: string
  /** Non-null when the nominal attribution rule did not apply. */
  attributionFallback: string | null
  /** Present when a manual correction changed this movement. */
  override?: { amount?: number; csmId?: string; reason: string; author: string }
}

export interface CsmMetrics {
  csmId: string
  csmName: string
  color: string
  months: MonthlyMetrics[]
  /** Aggregate over the whole analysed period, using the configured method. */
  aggregate: AggregateNrr
  /** Every movement retained for this CSM, so any figure can be drilled into. */
  movements: MovementDetail[]
}

export interface MetricsResult {
  capturedAt: string
  config: MetricsConfig
  months: Array<{ key: string; label: string }>
  /** All CSMs in scope, portfolio-weighted. */
  global: {
    months: MonthlyMetrics[]
    aggregate: AggregateNrr
  }
  perCsm: CsmMetrics[]
  diagnostics: Diagnostics
}

export interface ComputeOptions {
  /** How many months back from the current one, inclusive. */
  monthsBack?: number
  /** Explicit month list as `YYYY-MM`; takes precedence over `monthsBack`. */
  months?: string[]
  /** Restrict to these CSM ids. Empty or absent = every CSM of the team. */
  csmIds?: string[]
  config?: Partial<MetricsConfig>
  snapshot?: Snapshot
  snapshotOptions?: SnapshotOptions
  overrides?: Array<Partial<DealOverride>>
}

function monthList(monthsBack: number): Array<{ key: string; label: string }> {
  const now = new Date()
  const out: Array<{ key: string; label: string }> = []
  for (let i = monthsBack - 1; i >= 0; i--) {
    const date = startOfMonth(subMonths(now, i))
    out.push({ key: format(date, "yyyy-MM"), label: format(date, "MMM yy", { locale: fr }) })
  }
  return out
}

function labelFor(monthKey: string): string {
  return format(new Date(`${monthKey}-01T00:00:00Z`), "MMM yy", { locale: fr })
}

export async function computeMetrics(options: ComputeOptions = {}): Promise<MetricsResult> {
  const config = resolveConfig(options.config)

  const months = options.months
    ? options.months.map((key) => ({ key, label: labelFor(key) }))
    : monthList(options.monthsBack ?? 6)
  const monthKeys = new Set(months.map((m) => m.key))

  const snapshot =
    options.snapshot ??
    (await buildSnapshot({
      backfillHistory: config.backfillHistory,
      ...options.snapshotOptions,
    }))

  // --- Manual corrections (§10) ---------------------------------------------
  const overrideResult = loadOverrides(options.overrides ?? CONFIGURED_OVERRIDES, snapshot)

  // --- Movements (§5) --------------------------------------------------------
  // Two passes. The unrestricted one collects the churns that evict an account:
  // a client churned before the window must still be out of the portfolio
  // inside it. The restricted one feeds the metrics.
  const allTime = filterMovements(snapshot, config, { months: null, overrides: overrideResult.applied })
  const churns = countedChurns(allTime)
  const windowed = filterMovements(snapshot, config, {
    months: monthKeys,
    overrides: overrideResult.applied,
  })

  // --- Scope -----------------------------------------------------------------
  const scopeIds = options.csmIds?.length ? options.csmIds : CSM_TEAM.map((c) => c.id)
  const csmScope = new Set(scopeIds)

  // --- Portfolio per month (§3–4) -------------------------------------------
  const portfolios = new Map<string, PortfolioMonth>()
  for (const month of months) {
    portfolios.set(month.key, computePortfolioMonth(snapshot, month.key, churns, config, csmScope))
  }

  // --- Movements indexed by CSM and month ------------------------------------
  const byCsmMonth = new Map<string, RetainedMovement[]>()
  for (const entry of windowed.retained) {
    if (!csmScope.has(entry.csmId)) continue
    const key = `${entry.csmId}|${entry.month}`
    const bucket = byCsmMonth.get(key) ?? []
    bucket.push(entry)
    byCsmMonth.set(key, bucket)
  }

  function totals(entries: RetainedMovement[]) {
    let upsell = 0
    let downsell = 0
    let churn = 0
    for (const e of entries) {
      if (e.type === "upsell") upsell += e.amount
      else if (e.type === "downsell") downsell += e.amount
      else churn += e.amount
    }
    return { upsell, downsell, churn }
  }

  // --- Per-CSM metrics -------------------------------------------------------
  const perCsm: CsmMetrics[] = []

  for (const csmId of scopeIds) {
    const member = CSM_TEAM.find((c) => c.id === csmId)
    const monthly: MonthlyMetrics[] = []
    const movementDetails: MovementDetail[] = []

    for (const month of months) {
      const portfolio = portfolios.get(month.key)!
      const entries = byCsmMonth.get(`${csmId}|${month.key}`) ?? []
      const { upsell, downsell, churn } = totals(entries)

      monthly.push(
        computeMonthly(
          month.key,
          month.label,
          startingMrr(portfolio, csmId),
          upsell,
          downsell,
          churn,
          portfolio.byCsm.get(csmId)?.length ?? 0
        )
      )

      for (const entry of entries) movementDetails.push(toMovementDetail(entry))
    }

    perCsm.push({
      csmId,
      csmName: member?.name ?? getCsmName(csmId),
      color: member?.color ?? "#64748B",
      months: monthly,
      aggregate: aggregateNrr(monthly, config.quarterlyNrrMethod),
      movements: movementDetails,
    })
  }

  // --- Global ----------------------------------------------------------------
  const globalMonths: MonthlyMetrics[] = months.map((month) => {
    const portfolio = portfolios.get(month.key)!
    let starting = 0
    let accounts = 0
    portfolio.byCsm.forEach((entries) => {
      accounts += entries.length
      for (const entry of entries) starting += entry.mrr
    })

    const entries = windowed.retained.filter(
      (e) => e.month === month.key && csmScope.has(e.csmId)
    )
    const { upsell, downsell, churn } = totals(entries)

    return computeMonthly(month.key, month.label, starting, upsell, downsell, churn, accounts)
  })

  // --- Diagnostics (§9) ------------------------------------------------------
  const { byReason, byStage } = groupRejections(windowed.rejected, SALES_STAGE_LABELS)

  const churnExits: Diagnostics["churnExits"] = []
  const churnVetoes: Diagnostics["churnVetoes"] = []
  const truncatedHistory: Diagnostics["truncatedHistory"] = []
  const neverBilledMap = new Map<string, Diagnostics["neverBilled"][number]>()

  // Report each account once, on the first month it shows up.
  const seenExit = new Set<string>()
  const seenVeto = new Set<string>()
  const seenTruncated = new Set<string>()

  for (const month of months) {
    const portfolio = portfolios.get(month.key)!

    for (const exit of portfolio.exits) {
      if (seenExit.has(exit.accountId)) continue
      seenExit.add(exit.accountId)
      churnExits.push({ ...exit, month: month.key })
    }
    for (const veto of portfolio.vetoes) {
      if (seenVeto.has(veto.accountId)) continue
      seenVeto.add(veto.accountId)
      churnVetoes.push({ ...veto, month: month.key })
    }
    for (const item of portfolio.truncated) {
      if (seenTruncated.has(item.accountId)) continue
      seenTruncated.add(item.accountId)
      truncatedHistory.push({ ...item, month: month.key })
    }
    for (const item of portfolio.neverBilled) {
      if (!neverBilledMap.has(item.accountId)) neverBilledMap.set(item.accountId, item)
    }
  }

  const anomalyGroups = byReason
  const anomalyCount = anomalyGroups.reduce((sum, g) => sum + g.count, 0)
  const anomalyAmount = anomalyGroups.reduce((sum, g) => sum + g.totalAmount, 0)

  const diagnostics: Diagnostics = {
    rejectedByReason: byReason,
    outOfScopeByStage: byStage,
    neverBilled: Array.from(neverBilledMap.values()).sort((a, b) => b.mrr - a.mrr),
    churnExits: churnExits.sort((a, b) => b.mrr - a.mrr),
    churnVetoes: churnVetoes.sort((a, b) => b.churnedAmount - a.churnedAmount),
    truncatedHistory,
    overrides: {
      applied: overrideResult.details,
      refused: overrideResult.refused,
      orphaned: overrideResult.orphaned,
    },
    summary: {
      anomalyCount,
      anomalyAmount: round2(anomalyAmount),
      outOfScopeCount: byStage.reduce((sum, g) => sum + g.count, 0),
      neverBilledCount: neverBilledMap.size,
      churnExitCount: churnExits.length,
      churnExitsWithoutDealCount: churnExits.filter((e) => e.via === "phase").length,
      churnVetoCount: churnVetoes.length,
      truncatedCount: truncatedHistory.length,
      ghostMrrRemoved: round2(churnExits.reduce((sum, e) => sum + e.mrr, 0)),
    },
  }

  return {
    capturedAt: snapshot.capturedAt,
    config,
    months,
    global: {
      months: globalMonths,
      aggregate: aggregateNrr(globalMonths, config.quarterlyNrrMethod),
    },
    perCsm,
    diagnostics,
  }
}

function toMovementDetail(entry: RetainedMovement): MovementDetail {
  const m = entry.movement
  return {
    id: m.id,
    name: m.name,
    type: entry.type,
    amount: entry.amount,
    rawAmount: m.rawAmount,
    accountId: m.accountId,
    accountName: m.accountName,
    referenceDate: entry.type === "upsell" ? m.paymentDate : m.operationDate,
    stage: m.stage,
    eligibility: m.eligibility,
    csmId: entry.csmId,
    attributionFallback: entry.attributionFallback,
    ...(entry.override
      ? {
          override: {
            ...(entry.override.amount != null ? { amount: entry.override.amount } : {}),
            ...(entry.override.csmId ? { csmId: entry.override.csmId } : {}),
            reason: entry.override.reason,
            author: entry.override.author,
          },
        }
      : {}),
  }
}

export * from "./config"
export * from "./model"
export * from "./metrics"
export type { Diagnostics } from "./diagnostics"
