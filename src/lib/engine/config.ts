// =============================================================================
// Metrics engine — configuration (spec §12)
// Every arbitrable rule is an option. Defaults reproduce the reference spec.
// =============================================================================

/** How a quarterly NRR aggregates its monthly components (spec §6). */
export type QuarterlyNrrMethod = "weighted" | "mean" | "compound"

/** How a movement is attached to a CSM (spec §5, "Attribution à un CSM"). */
export type MovementAttribution = "owner_at_month_start" | "owner_at_event" | "deal_owner"

/** Movement types carrying a MRR delta. */
export type MovementType = "upsell" | "downsell" | "churn"

export interface MetricsConfig {
  /** Aggregation of the quarterly NRR. */
  quarterlyNrrMethod: QuarterlyNrrMethod
  /** Attaching a movement to a CSM. */
  movementAttribution: MovementAttribution
  /** Entry threshold into the portfolio: mrr_at(T) must be strictly above it. */
  minMrrUnderManagement: number
  /** Require a first billing strictly before the 1st of the month. */
  requirePaymentBeforeMonth: boolean
  /** Drop churned accounts out of the portfolio the month after they leave. */
  excludeChurnedAccounts: boolean
  /** `phase_du_client` values meaning "gone". */
  churnedCustomerStages: string[]
  /** `phase_du_client` values that veto the exit when the loss is partial. */
  activeCustomerStages: string[]
  /** Carry the oldest known value back to the origin of time. */
  backfillHistory: boolean
  /** Deal stages retained, per movement type. */
  allowedStages: Record<MovementType, string[]>
}

// -----------------------------------------------------------------------------
// NOTE — `deal_eligibility` is deliberately NOT a filter (see docs/IMPLEMENTATION.md).
// Every deal counts, whatever its eligibility. The property is still read into
// the model so re-enabling it later is a small change, but nothing acts on it.
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Stage allowlists (spec §5, "Stages retenus")
// ⚠️ In this portal internal ids do not match displayed labels:
//    closedlost → "Closed won" · closedwon → "Offre envoyé (70 %)"
// -----------------------------------------------------------------------------

/** "Closed won" — yes, the internal id really is `closedlost`. */
export const STAGE_CLOSED_WON = "closedlost"
/** "Paiement reçu". */
export const STAGE_PAIEMENT_RECU = "143474109"
/** "Churn & Downsell" — the won stage of a loss. */
export const STAGE_CHURN_DOWNSELL = "1220133077"

export const DEFAULT_ALLOWED_STAGES: Record<MovementType, string[]> = {
  upsell: [STAGE_CLOSED_WON, STAGE_PAIEMENT_RECU],
  downsell: [STAGE_CHURN_DOWNSELL, STAGE_CLOSED_WON, STAGE_PAIEMENT_RECU],
  churn: [STAGE_CHURN_DOWNSELL, STAGE_CLOSED_WON, STAGE_PAIEMENT_RECU],
}

export const DEFAULT_CONFIG: MetricsConfig = {
  quarterlyNrrMethod: "weighted",
  movementAttribution: "owner_at_month_start",
  minMrrUnderManagement: 0,
  requirePaymentBeforeMonth: true,
  excludeChurnedAccounts: true,
  churnedCustomerStages: ["churn"],
  activeCustomerStages: ["activated", "run"],
  backfillHistory: false,
  allowedStages: DEFAULT_ALLOWED_STAGES,
}

export function resolveConfig(overrides: Partial<MetricsConfig> = {}): MetricsConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    allowedStages: { ...DEFAULT_ALLOWED_STAGES, ...(overrides.allowedStages ?? {}) },
  }
}

const NRR_METHODS: QuarterlyNrrMethod[] = ["weighted", "mean", "compound"]
const ATTRIBUTION_MODES: MovementAttribution[] = ["owner_at_month_start", "owner_at_event", "deal_owner"]

function pick<T extends string>(raw: string | null, allowed: T[]): T | undefined {
  return raw && (allowed as string[]).includes(raw) ? (raw as T) : undefined
}

function bool(raw: string | null): boolean | undefined {
  if (raw === "true" || raw === "1") return true
  if (raw === "false" || raw === "0") return false
  return undefined
}

/** Read a config out of a query string; unknown or malformed values fall back to the default. */
export function configFromParams(params: URLSearchParams): MetricsConfig {
  const overrides: Partial<MetricsConfig> = {}

  const nrrMethod = pick(params.get("nrrMethod"), NRR_METHODS)
  if (nrrMethod) overrides.quarterlyNrrMethod = nrrMethod

  const attribution = pick(params.get("attribution"), ATTRIBUTION_MODES)
  if (attribution) overrides.movementAttribution = attribution

  const excludeChurned = bool(params.get("excludeChurnedAccounts"))
  if (excludeChurned !== undefined) overrides.excludeChurnedAccounts = excludeChurned

  const requirePayment = bool(params.get("requirePaymentBeforeMonth"))
  if (requirePayment !== undefined) overrides.requirePaymentBeforeMonth = requirePayment

  const backfill = bool(params.get("backfillHistory"))
  if (backfill !== undefined) overrides.backfillHistory = backfill

  const minMrr = Number(params.get("minMrr"))
  if (Number.isFinite(minMrr) && minMrr >= 0) overrides.minMrrUnderManagement = minMrr

  return resolveConfig(overrides)
}
