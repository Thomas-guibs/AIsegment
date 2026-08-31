// =============================================================================
// NRR (spec §6)
//
//   net(month)     = upsell − downsell − churn
//   MRR_end(month) = MRR_start + net            (excl. new business, by definition)
//   NRR(month)     = MRR_end / MRR_start
//
// Not computable when MRR_start <= 0: return an absent value, never 0 — an
// empty portfolio is not a portfolio that lost everything.
// =============================================================================

import type { QuarterlyNrrMethod } from "./config"

export interface MonthlyMetrics {
  month: string
  monthLabel: string
  startingMrr: number
  upsell: number
  downsell: number
  churn: number
  net: number
  endingMrr: number
  /** `null` when MRR_start <= 0 — absent, not zero. */
  nrr: number | null
  accountCount: number
}

export function computeMonthly(
  month: string,
  monthLabel: string,
  startingMrr: number,
  upsell: number,
  downsell: number,
  churn: number,
  accountCount: number
): MonthlyMetrics {
  const net = upsell - downsell - churn
  const endingMrr = startingMrr + net
  const nrr = startingMrr > 0 ? (endingMrr / startingMrr) * 100 : null

  return {
    month,
    monthLabel,
    startingMrr: round2(startingMrr),
    upsell: round2(upsell),
    downsell: round2(downsell),
    churn: round2(churn),
    net: round2(net),
    endingMrr: round2(endingMrr),
    nrr: nrr == null ? null : round2(nrr),
    accountCount,
  }
}

export interface AggregateNrr {
  /** `null` when no month of the period has a positive starting MRR. */
  nrr: number | null
  method: QuarterlyNrrMethod
  startingMrr: number
  upsell: number
  downsell: number
  churn: number
  net: number
  /** Months that actually fed the aggregate (starting MRR > 0). */
  monthsCounted: number
}

/**
 * Aggregate monthly NRRs over a period.
 *
 *   weighted  = (Σ MRR_start + Σ net) / Σ MRR_start   on months with MRR_start > 0
 *   mean      = arithmetic mean of the monthly NRRs
 *   compound  = product of the monthly NRRs
 *
 * `weighted` is the default: it weights each month by its starting MRR, which
 * is the portfolio's real NRR over the period. `mean` would give a €300k month
 * and a €30k month the same say; `compound` amplifies swings.
 */
export function aggregateNrr(
  months: MonthlyMetrics[],
  method: QuarterlyNrrMethod
): AggregateNrr {
  const counted = months.filter((m) => m.startingMrr > 0)

  const sums = months.reduce(
    (acc, m) => ({
      upsell: acc.upsell + m.upsell,
      downsell: acc.downsell + m.downsell,
      churn: acc.churn + m.churn,
    }),
    { upsell: 0, downsell: 0, churn: 0 }
  )

  const totalStarting = counted.reduce((sum, m) => sum + m.startingMrr, 0)
  const totalNet = counted.reduce((sum, m) => sum + m.net, 0)

  let nrr: number | null = null

  if (counted.length > 0) {
    switch (method) {
      case "mean": {
        const values = counted.map((m) => m.nrr).filter((v): v is number => v != null)
        nrr = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null
        break
      }
      case "compound": {
        const values = counted.map((m) => m.nrr).filter((v): v is number => v != null)
        nrr = values.length > 0 ? values.reduce((acc, v) => acc * (v / 100), 1) * 100 : null
        break
      }
      case "weighted":
      default:
        nrr = totalStarting > 0 ? ((totalStarting + totalNet) / totalStarting) * 100 : null
        break
    }
  }

  return {
    nrr: nrr == null ? null : round2(nrr),
    method,
    startingMrr: round2(totalStarting),
    upsell: round2(sums.upsell),
    downsell: round2(sums.downsell),
    churn: round2(sums.churn),
    net: round2(totalNet),
    monthsCounted: counted.length,
  }
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}
