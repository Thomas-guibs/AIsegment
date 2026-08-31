// =============================================================================
// Diagnostics (spec §9) — nothing may disappear in silence
//
// A remuneration calculation must account for **everything** it sets aside.
// Six families of signals:
//
//   1. Movements rejected, by reason        → data-entry anomalies
//   2. Deals out of scope, by stage         → pipeline information, NOT a defect
//   3. Accounts never billed                → counted nowhere
//   4. Accounts exited after churn          → incl. those exited on the phase alone
//   5. Accounts kept despite a churn        → downsells wearing the wrong label
//   6. Accounts invisible for lack of history → a data limit, said out loud
// =============================================================================

import type { RejectedMovement, RejectionReason } from "./movements"
import type { ChurnExit, ChurnVeto } from "./portfolio"
import type { LoadedOverride, DealOverride } from "./overrides"

export const REJECTION_LABELS: Record<RejectionReason, string> = {
  stage_out_of_scope: "Hors périmètre (stage)",
  missing_reference_date: "Date de référence absente",
  zero_amount: "Montant nul",
  unattributable: "CSM non identifiable",
}

/** Only these are anomalies. An out-of-scope stage is information. */
export const ANOMALY_REASONS: RejectionReason[] = [
  "missing_reference_date",
  "zero_amount",
  "unattributable",
]

export interface DiagnosticDeal {
  id: string
  name: string
  type: string
  amount: number
  accountName: string | null
  paymentDate: string | null
  operationDate: string | null
  stage: string
  eligibility: boolean | null
}

export interface RejectionGroup {
  reason: RejectionReason
  label: string
  count: number
  totalAmount: number
  deals: DiagnosticDeal[]
}

export interface StageGroup {
  stage: string
  label: string
  count: number
  totalAmount: number
  deals: DiagnosticDeal[]
}

export interface Diagnostics {
  /** 1 — anomalies, grouped by reason. */
  rejectedByReason: RejectionGroup[]
  /** 2 — deals out of scope, grouped by stage. Information, not a defect. */
  outOfScopeByStage: StageGroup[]
  /** 3 — a MRR and a CSM, but no effective payment date anywhere. */
  neverBilled: Array<{ accountId: string; accountName: string; csmId: string; mrr: number }>
  /**
   * 4 — exits after churn. Those exited on the phase alone carry no counted
   * churn deal: the NRR never booked the loss, the deal is missing from the CRM.
   */
  churnExits: Array<ChurnExit & { month: string }>
  /** 5 — kept despite a churn: downsells to be re-labelled `Downsell`. */
  churnVetoes: Array<ChurnVeto & { month: string }>
  /** 6 — invisible for lack of history. A data limit, not a calculation choice. */
  truncatedHistory: Array<{ accountId: string; accountName: string; earliest: string | null; month: string }>
  /** Manual corrections applied, refused, or aiming at nothing (spec §10). */
  overrides: {
    applied: LoadedOverride[]
    refused: Array<{ override: Partial<DealOverride>; problem: string }>
    orphaned: DealOverride[]
  }
  /** Headline counters, for the audit banner. */
  summary: {
    anomalyCount: number
    anomalyAmount: number
    outOfScopeCount: number
    neverBilledCount: number
    churnExitCount: number
    /** Exits with no counted churn deal — the loss the NRR never saw. */
    churnExitsWithoutDealCount: number
    churnVetoCount: number
    truncatedCount: number
    ghostMrrRemoved: number
  }
}

export function stageLabel(stage: string, labels: Record<string, string>): string {
  return labels[stage] ?? stage
}

export function groupRejections(
  rejected: RejectedMovement[],
  labels: Record<string, string>
): { byReason: RejectionGroup[]; byStage: StageGroup[] } {
  const reasonMap = new Map<RejectionReason, RejectionGroup>()
  const stageMap = new Map<string, StageGroup>()

  for (const entry of rejected) {
    const deal = toDiagnosticDeal(entry)

    if (entry.reason === "stage_out_of_scope") {
      const existing = stageMap.get(entry.stage) ?? {
        stage: entry.stage,
        label: stageLabel(entry.stage, labels),
        count: 0,
        totalAmount: 0,
        deals: [],
      }
      existing.count += 1
      existing.totalAmount += deal.amount
      existing.deals.push(deal)
      stageMap.set(entry.stage, existing)
      continue
    }

    const existing = reasonMap.get(entry.reason) ?? {
      reason: entry.reason,
      label: REJECTION_LABELS[entry.reason],
      count: 0,
      totalAmount: 0,
      deals: [],
    }
    existing.count += 1
    existing.totalAmount += deal.amount
    existing.deals.push(deal)
    reasonMap.set(entry.reason, existing)
  }

  const byReason = Array.from(reasonMap.values()).sort((a, b) => b.count - a.count)
  const byStage = Array.from(stageMap.values()).sort((a, b) => b.count - a.count)

  return { byReason, byStage }
}

function toDiagnosticDeal(entry: RejectedMovement): DiagnosticDeal {
  const m = entry.movement
  return {
    id: m.id,
    name: m.name,
    type: m.type,
    amount: m.amount,
    accountName: m.accountName,
    paymentDate: m.paymentDate,
    operationDate: m.operationDate,
    stage: m.stage,
    eligibility: m.eligibility,
  }
}
