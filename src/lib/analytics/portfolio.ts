// =============================================================================
// Portfolio analytics — spec CALCUL.md §3 §4 §5 §6
//
// This module reads point-in-time (from CompanyHistory) instead of "current
// value" from the CRM. That's what makes MRR under management and per-CSM
// attribution correct when accounts change owner mid-quarter.
// =============================================================================

import type { Deal } from "../types"
import type { CompanyHistory } from "../hubspot/history"
import { valueAt } from "../hubspot/history"
import {
  ATTRIBUTION,
  SALES_STAGES,
  movementDate,
  movementDateFor,
  isRetainedMovement,
  type CalcMethod,
} from "../constants"

// Stages where a deal has actually "landed" (revenue is committed).
const WON_STAGES = new Set<string>([SALES_STAGES.CLOSED_WON, SALES_STAGES.PAIEMENT_RECU])

// Acquisition attributions — new business
const ACQUISITION_ATTRIBUTIONS = new Set<string>([
  ATTRIBUTION.PARTNERS,
  ATTRIBUTION.HUNT,
  ATTRIBUTION.INBOUND,
  ATTRIBUTION.PAID,
  ATTRIBUTION.EVENT,
  ATTRIBUTION.PLG,
])

// Phases signifiant "parti" (spec §4 signal 2)
export const CHURNED_PHASES = ["churn"]
// Phases actives — opposent un veto à la sortie (spec §4)
export const ACTIVE_PHASES = ["Activated", "Run"]

// ISO for the 1st of a month at 00:00 UTC (spec §3 observation instant)
export function firstOfMonthUTC(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0)).toISOString()
}

// Month key "YYYY-MM" from an ISO timestamp (UTC).
export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7)
}

// Earliest date_de_paiement across a company's deals. Kept for callers that
// need the strict spec §3 condition 4 check; mrrUnderManagement no longer
// uses it since MRR is now derived from deals.
export function earliestPaymentByCompany(deals: Deal[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const d of deals) {
    if (!d.paymentDate || !d.companyId) continue
    const current = map.get(d.companyId)
    if (!current || d.paymentDate < current) {
      map.set(d.companyId, d.paymentDate)
    }
  }
  return map
}

// Group deals by companyId (needed for §4 exit rule which looks at counted
// churn deals per company).
export function dealsByCompany(deals: Deal[]): Map<string, Deal[]> {
  const map = new Map<string, Deal[]>()
  for (const d of deals) {
    if (!d.companyId) continue
    const arr = map.get(d.companyId) ?? []
    arr.push(d)
    map.set(d.companyId, arr)
  }
  return map
}

export interface MrrContribution {
  companyId: string
  companyName: string
  mrr: number
  csm: string
}

// Compute a company's MRR at instant T as the signed sum of its retained deals
// effective before T.
//
//   acquisition + upsell  → + amount
//   downsell + churn      → − amount
//
// A deal is "retained" (landed) if it reached a won stage:
//   - Movements (Upsell/Churn/Downsell): filtered by isRetainedMovement (spec §5).
//   - Acquisitions: stage in [CLOSED_WON, PAIEMENT_RECU].
// Effective date for the "before T" check uses movementDateFor(calcMethod) for
// movements (upsell honors billed/booked) and operationDate (fallback paymentDate)
// for acquisitions.
export function mrrFromDeals(
  companyDeals: Deal[],
  t: string,
  calcMethod: CalcMethod
): number {
  const tDate = t.slice(0, 10)
  let total = 0
  for (const d of companyDeals) {
    const attr = d.attribution
    if (!attr) continue

    // Determine if this deal is "landed" (retained) and its effective date.
    let effectiveDate: string | null = null
    if (attr === ATTRIBUTION.UPSELL || attr === ATTRIBUTION.CHURN || attr === ATTRIBUTION.DOWNSELL) {
      if (!isRetainedMovement(d)) continue
      effectiveDate = movementDateFor(d, calcMethod)
    } else if (ACQUISITION_ATTRIBUTIONS.has(attr)) {
      if (!WON_STAGES.has(d.stage) || d.amount === 0) continue
      effectiveDate = d.operationDate ?? d.paymentDate ?? d.closeDate
    } else {
      continue
    }
    if (!effectiveDate || effectiveDate.slice(0, 10) >= tDate) continue

    const amt = Math.abs(d.amount)
    if (attr === ATTRIBUTION.CHURN || attr === ATTRIBUTION.DOWNSELL) total -= amt
    else total += amt
  }
  return total
}

// Spec §4: an account has exited the portfolio at T iff any exit signal fires
// AND the veto (active phase + partial loss) does not apply.
export function hasExited(
  c: CompanyHistory,
  companyDealsAll: Deal[],
  t: string,
  mrrAtT: number
): boolean {
  const tDate = t.slice(0, 10) // YYYY-MM-DD

  // Signal 1: counted churn deals with operationDate strictly before T.
  // "Comme la §5" — same filters (stage + operationDate + non-zero amount).
  const countedChurns = companyDealsAll.filter(
    (d) =>
      d.attribution === ATTRIBUTION.CHURN &&
      isRetainedMovement(d) &&
      d.operationDate! < tDate
  )
  const totalChurn = countedChurns.reduce((s, d) => s + Math.abs(d.amount), 0)

  // Signal 2: phase_du_client is a churned phase at T
  const phase = valueAt(c.phase, t) ?? null
  const phaseIndicatesExit = phase !== null && CHURNED_PHASES.includes(phase)

  // No signal → stays
  if (countedChurns.length === 0 && !phaseIndicatesExit) return false

  // Veto: active phase AND partial loss (only part of MRR is emported)
  const isActivePhase = phase !== null && ACTIVE_PHASES.includes(phase)
  const isPartialLoss = totalChurn > 0 && totalChurn < mrrAtT
  if (isActivePhase && isPartialLoss) return false

  return true
}

// Spec §3: MRR sous gestion at instant T.
// Applies the conditions in order:
//   1. CSM connu à T
//   2. CSM dans le périmètre demandé
//   3. MRR à T > 0 — computed as the SIGNED SUM of the company's retained deals
//      effective before T (acquisition + upsell = +, churn + downsell = −).
//      The company's total_revenue field is NOT used as source of truth —
//      it's often stale in HubSpot; deals are.
//   4. (implicit in 3: a positive deal-derived MRR means the company has
//      landed transactions before T, so it was billed)
//   5. Pas sorti du portefeuille (§4)
export function mrrUnderManagement(
  companies: CompanyHistory[],
  companyDealsMap: Map<string, Deal[]>,
  t: string,
  calcMethod: CalcMethod,
  csmFilter?: string
): MrrContribution[] {
  const out: MrrContribution[] = []
  for (const c of companies) {
    // 1. CSM known at T
    const csm = valueAt(c.csm, t)
    if (!csm) continue
    // 2. CSM in scope
    if (csmFilter && csm !== csmFilter) continue
    // 3. MRR at T > 0 (from deals)
    const mrr = mrrFromDeals(companyDealsMap.get(c.id) ?? [], t, calcMethod)
    if (mrr <= 0) continue
    // 5. Not exited (§4)
    if (hasExited(c, companyDealsMap.get(c.id) ?? [], t, mrr)) continue

    out.push({ companyId: c.id, companyName: c.name, mrr, csm })
  }
  return out
}

// Sum MRR under management per CSM at T.
export function mrrUnderManagementByCsm(
  companies: CompanyHistory[],
  companyDealsMap: Map<string, Deal[]>,
  t: string,
  calcMethod: CalcMethod
): Map<string, number> {
  const contribs = mrrUnderManagement(companies, companyDealsMap, t, calcMethod)
  const out = new Map<string, number>()
  for (const c of contribs) {
    out.set(c.csm, (out.get(c.csm) ?? 0) + c.mrr)
  }
  return out
}

// Spec §5 default attribution: "owner_at_month_start" — the CSM who owned
// the company on the 1st of the month of the movement.
//
// Fallback chain when no CSM is known at that instant:
//   1. First CSM ever recorded on the company
//   2. Deal owner (hubspot_owner_id on the deal itself)
//   3. null → caller should signal as "unassignable" and skip
export function ownerAtMonthStart(
  deal: Deal,
  companyHistory: CompanyHistory | undefined
): string | null {
  const refDate = movementDate(deal)
  if (!refDate) return deal.ownerId ?? null
  const d = new Date(refDate)
  const t = firstOfMonthUTC(d.getUTCFullYear(), d.getUTCMonth() + 1)

  if (companyHistory) {
    const owner = valueAt(companyHistory.csm, t)
    if (owner) return owner
    if (companyHistory.csm.length > 0) {
      return companyHistory.csm[0].value // first-ever CSM on the account
    }
  }
  return deal.ownerId ?? null
}

// Spec §6: NRR monthly formula.
// Not computable when MRR_début ≤ 0 → returns null.
export function monthlyNrr(startingMrr: number, upsell: number, churn: number, downsell: number): number | null {
  if (startingMrr <= 0) return null
  return ((startingMrr + upsell - churn - downsell) / startingMrr) * 100
}

// Spec §6: quarterly NRR — default method is `weighted`.
//   weighted = (Σ MRR_début + Σ net) / Σ MRR_début   sur les mois où MRR_début > 0
// Returns null if no eligible month.
export function weightedQuarterlyNrr(
  months: Array<{ startingMrr: number; upsell: number; churn: number; downsell: number }>
): number | null {
  const eligible = months.filter((m) => m.startingMrr > 0)
  if (eligible.length === 0) return null
  const totalStart = eligible.reduce((s, m) => s + m.startingMrr, 0)
  const totalNet = eligible.reduce((s, m) => s + m.upsell - m.churn - m.downsell, 0)
  return ((totalStart + totalNet) / totalStart) * 100
}
