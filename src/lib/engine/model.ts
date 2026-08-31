// =============================================================================
// Normalized model (spec §13, step 2)
//
// The snapshot freezes HubSpot; the calculation replays it offline. Nothing
// below reaches the network — which is what makes a past payout auditable and
// the reference cases of §11 testable.
// =============================================================================

import type { Timeline } from "./timeline"
import type { MovementType } from "./config"

/** A client company, with its three historised properties. */
export interface Account {
  id: string
  name: string
  /** MRR history — `total_revenue`. Never reset when a client leaves (spec §4). */
  mrr: Timeline<number>
  /** Owning CSM history — `proprietaire_de_l_entreprise__csm_`. */
  csm: Timeline<string>
  /** Customer phase history — `phase_du_client`, lower-cased. */
  phase: Timeline<string>
  /**
   * Oldest *effective payment date* across the account's deals, all attributions
   * confounded. The company-level `date_de_paiement` holds the **last** payment,
   * so it cannot be used here (spec §3, condition 4).
   */
  firstPaymentDate: string | null
  /** Current values, for display only — never for calculation. */
  currentMrr: number
  currentCsm: string | null
  currentPhase: string | null
}

/** A deal carrying a MRR movement. */
export interface Movement {
  id: string
  name: string
  type: MovementType
  /** Absolute value of `amount`, the MRR delta. `hs_mrr` is unusable (spec §5). */
  amount: number
  /** Raw signed `amount`, kept so a diagnostic can show what the CRM holds. */
  rawAmount: number
  /** `date_de_paiement` — effective payment date. Dates an upsell. */
  paymentDate: string | null
  /** `date_de_prise_en_compte` — operation date. Dates a churn or a downsell. */
  operationDate: string | null
  /** `deal_eligibility`: true / false / null when never filled in. */
  eligibility: boolean | null
  stage: string
  /** Deal owner, the last-resort attribution fallback. */
  dealOwnerId: string | null
  accountId: string | null
  accountName: string | null
}

export interface Snapshot {
  /** When the extraction ran — an audit anchor. */
  capturedAt: string
  accounts: Account[]
  movements: Movement[]
  /** Accounts indexed by id, for the movement → account lookups. */
  accountsById: Map<string, Account>
}

/** The reference date of a movement, per its type (spec §5). */
export function referenceDate(movement: Movement): string | null {
  return movement.type === "upsell" ? movement.paymentDate : movement.operationDate
}

/** `YYYY-MM` of the month a movement attaches to, or null when undatable. */
export function movementMonth(movement: Movement): string | null {
  return referenceDate(movement)?.slice(0, 7) ?? null
}
