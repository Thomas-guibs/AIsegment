// Shapes returned by `/api/metrics`, shared by the client views.
// Mirrors the engine's own types without pulling server code into the bundle.

export interface MonthlyMetrics {
  month: string
  monthLabel: string
  startingMrr: number
  upsell: number
  downsell: number
  churn: number
  net: number
  endingMrr: number
  /** `null` when the starting MRR is 0 — absent, not zero. */
  nrr: number | null
  accountCount: number
}

export interface AggregateNrr {
  nrr: number | null
  method: string
  startingMrr: number
  upsell: number
  downsell: number
  churn: number
  net: number
  monthsCounted: number
}

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
  /** As recorded in the CRM. Informational — it filters nothing. */
  eligibility: boolean | null
  csmId: string
  attributionFallback: string | null
  override?: { amount?: number; csmId?: string; reason: string; author: string }
}

export interface CsmMetrics {
  csmId: string
  csmName: string
  color: string
  months: MonthlyMetrics[]
  aggregate: AggregateNrr
  movements: MovementDetail[]
}

export interface DiagnosticDeal {
  id: string
  name: string
  type: string
  amount: number
  accountName: string | null
  paymentDate: string | null
  operationDate: string | null
  stage: string
  /** As recorded in the CRM. Informational — it filters nothing. */
  eligibility: boolean | null
}

export interface RejectionGroup {
  reason: string
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
  rejectedByReason: RejectionGroup[]
  outOfScopeByStage: StageGroup[]
  neverBilled: Array<{ accountId: string; accountName: string; csmId: string; mrr: number }>
  churnExits: Array<{
    accountId: string
    accountName: string
    csmId: string | null
    mrr: number
    phase: string | null
    via: "deal" | "phase" | "both"
    month: string
  }>
  churnVetoes: Array<{
    accountId: string
    accountName: string
    csmId: string | null
    mrr: number
    phase: string | null
    churnedAmount: number
    month: string
  }>
  truncatedHistory: Array<{
    accountId: string
    accountName: string
    earliest: string | null
    month: string
  }>
  overrides: {
    applied: Array<{
      dealId: string
      dealName: string | null
      amount?: number
      csmId?: string
      reason: string
      author: string
      originalAmount: number | null
      originalCsmId: string | null
    }>
    refused: Array<{ override: Record<string, unknown>; problem: string }>
    orphaned: Array<{ dealId: string; reason: string; author: string }>
  }
  summary: {
    anomalyCount: number
    anomalyAmount: number
    outOfScopeCount: number
    neverBilledCount: number
    churnExitCount: number
    churnExitsWithoutDealCount: number
    churnVetoCount: number
    truncatedCount: number
    ghostMrrRemoved: number
  }
}

export interface MetricsConfigShape {
  quarterlyNrrMethod: string
  movementAttribution: string
  minMrrUnderManagement: number
  requirePaymentBeforeMonth: boolean
  excludeChurnedAccounts: boolean
  backfillHistory: boolean
}

export interface MetricsResponse {
  capturedAt: string
  config: MetricsConfigShape
  months: Array<{ key: string; label: string }>
  global: { months: MonthlyMetrics[]; aggregate: AggregateNrr }
  perCsm: CsmMetrics[]
  diagnostics: Diagnostics
}

/** Format a possibly-absent NRR. An empty portfolio has no NRR, it is not at 0 %. */
export function formatNrr(value: number | null, decimals = 1): string {
  return value == null ? "n/a" : `${value.toFixed(decimals)} %`
}
