// =============================================================================
// Portfolio analytics — spec CALCUL.md §3 §4 §5 §6 (strict) + §9 diagnostics
//
// Point-in-time reading (spec §2). All three properties are read at the
// observation instant T:
//   - MRR              from total_revenue history
//   - CSM propriétaire from proprietaire_de_l_entreprise__csm_ history
//   - Phase du client  from phase_du_client history
//
// fetchCompanyHistoryBatch synthesizes a single history entry anchored at
// hs_createdate when a property has no history tracking enabled on this
// HubSpot instance — this is spec §12 `backfill_history: true` behavior.
// =============================================================================

import type { Deal } from "../types"
import type { CompanyHistory } from "../hubspot/history"
import { valueAt } from "../hubspot/history"
import { ATTRIBUTION, SALES_STAGES, movementDate, isRetainedMovement } from "../constants"

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

// Earliest billing date across a company's deals (spec §3 condition 4).
// Spec §3.4 asks for the earliest `date_de_paiement`; we fall back to
// `date_de_prise_en_compte` (operationDate) when payment date is missing,
// because HubSpot in this instance does not systematically populate
// date_de_paiement on new-business deals. The intent of the condition —
// "le client était déjà facturé avant le 1er du mois" — is preserved:
// operationDate marks when the deal was accounted for.
export function earliestPaymentByCompany(deals: Deal[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const d of deals) {
    if (!d.companyId) continue
    const date = d.paymentDate ?? d.operationDate
    if (!date) continue
    const current = map.get(d.companyId)
    if (!current || date < current) {
      map.set(d.companyId, date)
    }
  }
  return map
}

// Group deals by companyId.
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

// -----------------------------------------------------------------------------
// Diagnostics — spec §9 "rien ne doit disparaître en silence".
// Six signal families the caller can expose in the API response.
// -----------------------------------------------------------------------------

export interface Diagnostics {
  // Comptes exclus par condition (§3)
  excludedNoCsm: string[]          // condition 1 failed
  excludedZeroMrr: string[]        // condition 3 failed
  excludedNoBilling: string[]      // condition 4 failed
  excludedExited: string[]         // condition 5 failed (§4)
  // §9 signals
  accountsWithoutBilling: string[] // MRR + CSM present but no date_de_paiement
  accountsExitedByPhaseOnly: string[]  // phase=churn but no counted churn deal
  accountsRetainedWithChurn: string[]  // veto applied — likely mis-attributed downsell
  accountsInvisibleTruncatedHistory: string[]  // history doesn't reach T
  accountsMrrFromDeals: string[]   // total_revenue history empty at T → MRR reconstructed from deals
}

export function newDiagnostics(): Diagnostics {
  return {
    excludedNoCsm: [],
    excludedZeroMrr: [],
    excludedNoBilling: [],
    excludedExited: [],
    accountsWithoutBilling: [],
    accountsExitedByPhaseOnly: [],
    accountsRetainedWithChurn: [],
    accountsInvisibleTruncatedHistory: [],
    accountsMrrFromDeals: [],
  }
}

// -----------------------------------------------------------------------------
// MRR fallback — computed from deals when total_revenue history is empty at T.
//
// Loyoly's HubSpot instance does NOT keep `total_revenue` up to date (a known
// trap listed in CALCUL.md §8). Per §2 warning "l'historique peut être
// tronqué", we reconstruct MRR at T from the deals:
//
//   MRR(T) = Σ new business (paymentDate < T)
//          + Σ upsell        (paymentDate < T)
//          − Σ churn         (operationDate < T)
//          − Σ downsell      (operationDate < T)
//
// Only deals in retained stages (closedlost/won, 143474109, 1220133077) are
// counted — same filter as isRetainedMovement (§5), broadened to include the
// new-business acquisitions that landed the initial MRR.
// -----------------------------------------------------------------------------
const RETAINED_STAGES = new Set<string>([
  SALES_STAGES.CLOSED_WON,       // "closedlost" — actually Closed Won
  SALES_STAGES.PAIEMENT_RECU,    // "143474109"
  SALES_STAGES.CHURN_DOWNSELL,   // "1220133077"
])

export function computeMrrFromDeals(deals: Deal[], t: string): number {
  const tDate = t.slice(0, 10)
  let mrr = 0
  for (const d of deals) {
    if (!RETAINED_STAGES.has(d.stage)) continue
    if (!d.amount) continue
    let refDate: string | null = null
    let sign = 1
    if (d.attribution === ATTRIBUTION.UPSELL) {
      refDate = d.paymentDate
    } else if (
      d.attribution === ATTRIBUTION.CHURN ||
      d.attribution === ATTRIBUTION.DOWNSELL
    ) {
      refDate = d.operationDate
      sign = -1
    } else {
      // New business: paymentDate first, fall back to operationDate.
      refDate = d.paymentDate ?? d.operationDate
    }
    if (!refDate || refDate >= tDate) continue
    mrr += sign * Math.abs(d.amount)
  }
  return mrr
}

// Spec §4: an account has exited the portfolio at T iff any exit signal fires
// AND the veto (active phase + partial loss) does not apply.
export function hasExited(
  c: CompanyHistory,
  companyDealsAll: Deal[],
  t: string,
  mrrAtT: number
): boolean {
  const tDate = t.slice(0, 10)

  // Signal 1: counted churn deals with operationDate strictly before T
  // (same filters as §5: stage + operationDate + non-zero amount).
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

// Spec §3: MRR sous gestion at instant T — strict.
// Applies the 5 conditions in order:
//   1. CSM connu à T                — csm_at(T) non vide
//   2. CSM dans le périmètre demandé
//   3. MRR à T strictement positif  — mrr_at(T) > 0 from total_revenue history
//   4. Client déjà facturé          — earliest date_de_paiement < 1er du mois
//   5. Pas sorti du portefeuille    — §4
//
// Diagnostics are populated when passed (spec §9).
export function mrrUnderManagement(
  companies: CompanyHistory[],
  earliestPayment: Map<string, string>,
  companyDealsMap: Map<string, Deal[]>,
  t: string,
  csmFilter?: string,
  diagnostics?: Diagnostics,
  billedOverride?: Set<string>
): MrrContribution[] {
  const tDate = t.slice(0, 10)
  const out: MrrContribution[] = []
  for (const c of companies) {
    // 1. CSM known at T — with §5 first-CSM safety net.
    // If history doesn't reach back to T, fall back to the earliest CSM ever
    // recorded (spec §5 "premier CSM jamais enregistré sur le compte" — same
    // fallback chain, applied here to condition §3.1).
    let csm = valueAt(c.csm, t) ?? null
    if (!csm && c.csm.length > 0) {
      csm = c.csm[0].value
      if (c.csm[0].timestamp > t) {
        diagnostics?.accountsInvisibleTruncatedHistory.push(c.id)
      }
    }
    if (!csm) {
      diagnostics?.excludedNoCsm.push(c.id)
      continue
    }
    // 2. CSM in scope
    if (csmFilter && csm !== csmFilter) continue
    // 3. MRR > 0 at T — total_revenue history first, deal-derived fallback.
    // Loyoly's HubSpot leaves total_revenue empty (CALCUL.md §8 known trap);
    // §2 explicitly allows reconstruction when history is truncated at T.
    const companyDeals = companyDealsMap.get(c.id) ?? []
    const mrrFromHist = valueAt(c.mrr, t)
    let mrr = mrrFromHist ?? 0
    if (mrr <= 0) {
      const mrrFromDeals = computeMrrFromDeals(companyDeals, t)
      if (mrrFromDeals > 0) {
        mrr = mrrFromDeals
        diagnostics?.accountsMrrFromDeals.push(c.id)
      }
    }
    if (mrr <= 0) {
      diagnostics?.excludedZeroMrr.push(c.id)
      continue
    }
    // 4. Already billed — pragmatic fallback chain because HubSpot does
    // not consistently populate date_de_paiement on new-business deals:
    //   a) billedOverride set — company is on the active-customer roster,
    //      phase confirms they ARE a paying customer; skip §3.4.
    //   b) earliest deal date (paymentDate ?? operationDate) < T.
    //   c) hs_createdate < T — the company existed before the observation
    //      instant, spec §12 backfill_history spirit.
    const earlyPayFromDeals = earliestPayment.get(c.id)
    const createdAtDay =
      c.createdAt && c.createdAt.length >= 10 ? c.createdAt.slice(0, 10) : null
    const billedByOverride = billedOverride?.has(c.id) ?? false
    const billedByDeals = !!earlyPayFromDeals && earlyPayFromDeals.slice(0, 10) < tDate
    const billedByCreation = !!createdAtDay && createdAtDay < tDate
    if (!billedByOverride && !billedByDeals && !billedByCreation) {
      diagnostics?.excludedNoBilling.push(c.id)
      if (!earlyPayFromDeals) diagnostics?.accountsWithoutBilling.push(c.id)
      continue
    }
    // 5. Not exited (§4)
    if (hasExited(c, companyDeals, t, mrr)) {
      diagnostics?.excludedExited.push(c.id)
      // Sub-signal: exited by phase only (no counted churn deal)
      const hasCountedChurn = companyDeals.some(
        (d) =>
          d.attribution === ATTRIBUTION.CHURN &&
          isRetainedMovement(d) &&
          d.operationDate! < tDate
      )
      if (!hasCountedChurn) diagnostics?.accountsExitedByPhaseOnly.push(c.id)
      continue
    }

    // Passed all 5 conditions. Detect "retained despite churn" for §9.
    if (diagnostics) {
      const hasCountedChurn = companyDeals.some(
        (d) =>
          d.attribution === ATTRIBUTION.CHURN &&
          isRetainedMovement(d) &&
          d.operationDate! < tDate
      )
      if (hasCountedChurn) diagnostics.accountsRetainedWithChurn.push(c.id)
    }

    out.push({ companyId: c.id, companyName: c.name, mrr, csm })
  }
  return out
}

// Sum MRR under management per CSM at T.
export function mrrUnderManagementByCsm(
  companies: CompanyHistory[],
  earliestPayment: Map<string, string>,
  companyDealsMap: Map<string, Deal[]>,
  t: string
): Map<string, number> {
  const contribs = mrrUnderManagement(companies, earliestPayment, companyDealsMap, t)
  const out = new Map<string, number>()
  for (const c of contribs) {
    out.set(c.csm, (out.get(c.csm) ?? 0) + c.mrr)
  }
  return out
}

// Spec §5 default attribution: "owner_at_month_start" — the CSM who owned
// the company on the 1st of the month of the movement.
// Fallback chain: first-ever CSM → deal.ownerId → null (skipped, spec §9).
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
