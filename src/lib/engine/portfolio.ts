// =============================================================================
// MRR under management (spec §3) and the exit of churned accounts (spec §4)
// =============================================================================

import { valueAt, isTruncatedAt } from "./timeline"
import type { Account, Movement, Snapshot } from "./model"
import type { MetricsConfig } from "./config"

/** Observation instant: the 1st of the month at 00:00 UTC. */
export function monthStart(month: string): Date {
  return new Date(`${month}-01T00:00:00.000Z`)
}

/** Why an account is not in the portfolio this month. */
export type ExclusionReason =
  | "no_csm_at_date"
  | "csm_out_of_scope"
  | "mrr_below_threshold"
  | "not_yet_billed"
  | "churned"
  | "history_truncated"

export interface PortfolioEntry {
  account: Account
  csmId: string
  mrr: number
  phase: string | null
}

export interface ChurnExit {
  accountId: string
  accountName: string
  csmId: string | null
  /** MRR the account was still carrying when it left — the ghost MRR removed. */
  mrr: number
  phase: string | null
  /** Exited on a decremented churn deal, on the phase alone, or on both. */
  via: "deal" | "phase" | "both"
}

export interface ChurnVeto {
  accountId: string
  accountName: string
  csmId: string | null
  mrr: number
  phase: string | null
  /** Total of the decremented churns that did not carry the whole MRR away. */
  churnedAmount: number
}

export interface PortfolioMonth {
  month: string
  /** Retained accounts, by CSM id. */
  byCsm: Map<string, PortfolioEntry[]>
  /** Accounts that left this month after a churn. */
  exits: ChurnExit[]
  /** Accounts kept despite a churn deal — a downsell wearing the wrong label. */
  vetoes: ChurnVeto[]
  /** Accounts invisible because their history does not reach this month. */
  truncated: Array<{ accountId: string; accountName: string; earliest: string | null }>
  /** Accounts carrying a MRR and a CSM but never billed: counted nowhere. */
  neverBilled: Array<{ accountId: string; accountName: string; csmId: string; mrr: number }>
}

/**
 * Churns that make an account leave are exactly those that hit the NRR — same
 * filters as the movements (spec §4). A churn not counted (missing eligibility,
 * say) must not evict the account, otherwise we would strip the MRR without
 * ever booking the loss.
 */
export interface CountedChurn {
  accountId: string
  amount: number
  operationDate: string
}

/**
 * The portfolio of every CSM for one month.
 *
 * @param countedChurns churns retained by the movement pipeline, so the two
 *                      rules stay consistent. Keyed by account, cumulative.
 */
export function computePortfolioMonth(
  snapshot: Snapshot,
  month: string,
  countedChurns: CountedChurn[],
  config: MetricsConfig,
  csmScope?: Set<string>
): PortfolioMonth {
  const observedAt = monthStart(month)
  const observedIso = observedAt.toISOString()
  const monthFirstDay = `${month}-01`

  // Churns decremented **strictly before** the 1st of the month evict the
  // account. A churn during the month leaves it in the base — it was there on
  // the 1st — and hits the NRR normally; it disappears the month after.
  const churnBefore = new Map<string, number>()
  for (const churn of countedChurns) {
    if (churn.operationDate < monthFirstDay) {
      churnBefore.set(churn.accountId, (churnBefore.get(churn.accountId) ?? 0) + churn.amount)
    }
  }

  const byCsm = new Map<string, PortfolioEntry[]>()
  const exits: ChurnExit[] = []
  const vetoes: ChurnVeto[] = []
  const truncated: PortfolioMonth["truncated"] = []
  const neverBilled: PortfolioMonth["neverBilled"] = []

  const churnedPhases = new Set(config.churnedCustomerStages.map((s) => s.toLowerCase()))
  const activePhases = new Set(config.activeCustomerStages.map((s) => s.toLowerCase()))

  for (const account of snapshot.accounts) {
    // Condition 1 — a CSM is known at T.
    const csmId = valueAt(account.csm, observedIso)
    if (!csmId) {
      // Distinguish "nobody owns it" from "we cannot see who owned it".
      if (isTruncatedAt(account.csm, observedIso) || isTruncatedAt(account.mrr, observedIso)) {
        truncated.push({
          accountId: account.id,
          accountName: account.name,
          earliest: account.csm.earliest ?? account.mrr.earliest,
        })
      }
      continue
    }

    // Condition 2 — that CSM is inside the requested scope.
    if (csmScope && !csmScope.has(csmId)) continue

    // Condition 3 — MRR at T is strictly above the threshold.
    const mrr = valueAt(account.mrr, observedIso) ?? 0
    if (!(mrr > config.minMrrUnderManagement)) continue

    const phase = valueAt(account.phase, observedIso) ?? null

    // Condition 4 — the client was already billed before the 1st.
    if (config.requirePaymentBeforeMonth) {
      if (!account.firstPaymentDate) {
        neverBilled.push({ accountId: account.id, accountName: account.name, csmId, mrr })
        continue
      }
      if (!(account.firstPaymentDate < monthFirstDay)) continue
    }

    // Condition 5 — the account has not left the portfolio (spec §4).
    if (config.excludeChurnedAccounts) {
      const churnedByDeal = (churnBefore.get(account.id) ?? 0) > 0
      const churnedByPhase = phase != null && churnedPhases.has(phase)

      if (churnedByDeal || churnedByPhase) {
        // The veto: active phase **and** partial loss. Both are necessary —
        // on the phase alone, real departures whose phase was never updated
        // would keep their ghost MRR forever.
        const totalChurned = churnBefore.get(account.id) ?? 0
        const isActivePhase = phase != null && activePhases.has(phase)
        const isPartialLoss = totalChurned > 0 && totalChurned < mrr

        if (isActivePhase && isPartialLoss) {
          vetoes.push({
            accountId: account.id,
            accountName: account.name,
            csmId,
            mrr,
            phase,
            churnedAmount: totalChurned,
          })
          // Falls through: the account stays in the portfolio.
        } else {
          exits.push({
            accountId: account.id,
            accountName: account.name,
            csmId,
            mrr,
            phase,
            via: churnedByDeal && churnedByPhase ? "both" : churnedByDeal ? "deal" : "phase",
          })
          continue
        }
      }
    }

    const entries = byCsm.get(csmId) ?? []
    entries.push({ account, csmId, mrr, phase })
    byCsm.set(csmId, entries)
  }

  return { month, byCsm, exits, vetoes, truncated, neverBilled }
}

/** Σ mrr_at(T) over the retained accounts of one CSM. */
export function startingMrr(portfolio: PortfolioMonth, csmId: string): number {
  const entries = portfolio.byCsm.get(csmId)
  if (!entries) return 0
  return entries.reduce((sum, e) => sum + e.mrr, 0)
}

/** Σ mrr_at(T) over every retained account, all CSMs confounded. */
export function totalStartingMrr(portfolio: PortfolioMonth): number {
  let total = 0
  portfolio.byCsm.forEach((entries) => {
    for (const entry of entries) total += entry.mrr
  })
  return total
}

/** The CSM owning an account on the 1st of `month` — the default attribution. */
export function ownerAtMonthStart(account: Account, month: string): string | undefined {
  return valueAt(account.csm, monthStart(month).toISOString())
}

/** Movement-side helper: the account a movement points at, if any. */
export function accountOf(snapshot: Snapshot, movement: Movement): Account | undefined {
  return movement.accountId ? snapshot.accountsById.get(movement.accountId) : undefined
}
