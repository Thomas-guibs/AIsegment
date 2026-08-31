// =============================================================================
// MRR movements (spec §5)
//
// The order of evaluation matters, because it separates what is **out of
// scope** (normal) from what is a **data-entry anomaly** (to be corrected):
//
//   1. Stage filter        — a deal still being negotiated is not an anomaly.
//   2. Reference date      — absent → anomaly.
//   3. Month in range      — outside → ignored, silently.
//   4. Non-zero amount     — zero → anomaly.
//   5. CSM attribution     — unattributable → anomaly.
//
// `deal_eligibility` is NOT a filter: every deal counts, whatever its
// eligibility. Most churns in this CRM have it blank, and filtering on it
// dropped the majority of the churn from the NRR.
// =============================================================================

import { valueAt, firstValue } from "./timeline"
import { monthStart } from "./portfolio"
import { referenceDate, movementMonth, type Movement, type Snapshot } from "./model"
import type { MetricsConfig, MovementType } from "./config"
import type { DealOverride } from "./overrides"

/** Why a movement was set aside. Out-of-scope is information, not a defect. */
export type RejectionReason =
  | "stage_out_of_scope"
  | "missing_reference_date"
  | "zero_amount"
  | "unattributable"

export interface RetainedMovement {
  movement: Movement
  type: MovementType
  /** `YYYY-MM` the movement attaches to. */
  month: string
  /** Amount actually counted — an override can replace it. */
  amount: number
  /** CSM the movement is booked against. */
  csmId: string
  /** How that CSM was found, when it was not the nominal rule. */
  attributionFallback: "owner_at_month_start" | "first_csm_ever" | "deal_owner" | "owner_at_event" | null
  /** Set when a manual correction changed the amount or the attribution. */
  override?: DealOverride
}

export interface RejectedMovement {
  movement: Movement
  reason: RejectionReason
  /** Populated for `stage_out_of_scope`, so the pipeline view can group by stage. */
  stage: string
}

export interface MovementResult {
  retained: RetainedMovement[]
  rejected: RejectedMovement[]
}

/**
 * Attach a movement to a CSM.
 *
 * Default `owner_at_month_start`: the CSM owning the account on the 1st of the
 * movement's month — consistent with the MRR base, read at the same instant.
 * Successive fallbacks: first CSM ever recorded on the account, then the deal
 * owner, then unattributable — set aside and **reported**, never silently
 * absorbed.
 */
function attribute(
  movement: Movement,
  month: string,
  snapshot: Snapshot,
  config: MetricsConfig
): { csmId: string; fallback: RetainedMovement["attributionFallback"] } | null {
  const account = movement.accountId ? snapshot.accountsById.get(movement.accountId) : undefined

  if (config.movementAttribution === "deal_owner") {
    return movement.dealOwnerId ? { csmId: movement.dealOwnerId, fallback: "deal_owner" } : null
  }

  if (config.movementAttribution === "owner_at_event") {
    const eventDate = referenceDate(movement)
    if (account && eventDate) {
      const owner = valueAt(account.csm, `${eventDate}T23:59:59.999Z`)
      if (owner) return { csmId: owner, fallback: "owner_at_event" }
    }
  } else if (account) {
    const owner = valueAt(account.csm, monthStart(month).toISOString())
    if (owner) return { csmId: owner, fallback: null }
  }

  // Fallback 1 — the first CSM ever recorded on the account.
  if (account) {
    const first = firstValue(account.csm)
    if (first) return { csmId: first, fallback: "first_csm_ever" }
  }

  // Fallback 2 — the deal owner.
  if (movement.dealOwnerId) return { csmId: movement.dealOwnerId, fallback: "deal_owner" }

  // Fallback 3 — unattributable.
  return null
}

export interface MovementFilterOptions {
  /**
   * Months under analysis, as `YYYY-MM`. A movement outside is ignored quietly.
   * `null` lifts the restriction — needed to collect the churns that evict an
   * account, which reach back well before the analysed window.
   */
  months: Set<string> | null
  /** Manual corrections, indexed by deal id (spec §10). */
  overrides?: Map<string, DealOverride>
}

/** Run the §5 pipeline over every movement of the snapshot. */
export function filterMovements(
  snapshot: Snapshot,
  config: MetricsConfig,
  options: MovementFilterOptions
): MovementResult {
  const retained: RetainedMovement[] = []
  const rejected: RejectedMovement[] = []
  const overrides = options.overrides ?? new Map<string, DealOverride>()

  for (const movement of snapshot.movements) {
    // 1. Stage filter — out of scope, not an anomaly. Tested first so it does
    //    not pollute the data-quality report.
    const allowed = config.allowedStages[movement.type] ?? []
    if (!allowed.includes(movement.stage)) {
      rejected.push({ movement, reason: "stage_out_of_scope", stage: movement.stage })
      continue
    }

    // 2. Reference date present.
    const month = movementMonth(movement)
    if (!month) {
      rejected.push({ movement, reason: "missing_reference_date", stage: movement.stage })
      continue
    }

    // 3. Month inside the analysed period — ignored, nothing reported.
    if (options.months && !options.months.has(month)) continue

    const override = overrides.get(movement.id)

    // 4. Non-zero amount.
    const amount = override?.amount != null ? Math.abs(override.amount) : movement.amount
    if (amount === 0) {
      rejected.push({ movement, reason: "zero_amount", stage: movement.stage })
      continue
    }

    // 5. Attribution to a CSM.
    const overrideCsm = override?.csmId
    const attributed = overrideCsm
      ? { csmId: overrideCsm, fallback: null as RetainedMovement["attributionFallback"] }
      : attribute(movement, month, snapshot, config)

    if (!attributed) {
      rejected.push({ movement, reason: "unattributable", stage: movement.stage })
      continue
    }

    retained.push({
      movement,
      type: movement.type,
      month,
      amount,
      csmId: attributed.csmId,
      attributionFallback: attributed.fallback,
      ...(override ? { override } : {}),
    })
  }

  return { retained, rejected }
}

/**
 * The churns that evict an account (spec §4) — exactly those the pipeline kept,
 * so a churn that does not count against the NRR does not strip the MRR either.
 *
 * Feed this from an **unrestricted** pass (`months: null`): an account churned
 * before the analysed window must still be out of the portfolio inside it.
 */
export function countedChurns(result: MovementResult): Array<{
  accountId: string
  amount: number
  operationDate: string
}> {
  const churns: Array<{ accountId: string; amount: number; operationDate: string }> = []
  for (const entry of result.retained) {
    if (entry.type !== "churn") continue
    const accountId = entry.movement.accountId
    const operationDate = entry.movement.operationDate
    if (!accountId || !operationDate) continue
    churns.push({ accountId, amount: entry.amount, operationDate })
  }
  return churns
}
