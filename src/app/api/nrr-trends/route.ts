export const dynamic = "force-dynamic"
export const maxDuration = 300

import { NextRequest, NextResponse } from "next/server"
import { computeMetrics, type MetricsResult } from "@/lib/engine"
import { configFromParams } from "@/lib/engine/config"
import { CSM_TEAM } from "@/lib/constants"

/**
 * Adapter over the metrics engine, kept in the shape the dashboard already
 * consumes. New views should call `/api/metrics` directly — it carries the
 * diagnostics and the configuration this shape cannot express.
 */
function toLegacyShape(result: MetricsResult) {
  const movementsOf = (csmId: string | null, month: string) => {
    const source = csmId
      ? result.perCsm.find((c) => c.csmId === csmId)?.movements ?? []
      : result.perCsm.flatMap((c) => c.movements)
    return source
      .filter((m) => (m.referenceDate ?? "").slice(0, 7) === month)
      .map((m) => ({
        id: m.id,
        name: m.name,
        amount: m.amount,
        attribution: m.type,
        companyName: m.accountName ?? undefined,
        ownerId: m.csmId,
        operationDate: m.referenceDate,
        stage: m.stage,
      }))
  }

  const toMonths = (months: MetricsResult["global"]["months"], csmId: string | null) =>
    months.map((m) => ({
      month: m.month,
      monthLabel: m.monthLabel,
      startingMrr: m.startingMrr,
      upsell: m.upsell,
      churn: m.churn,
      downsell: m.downsell,
      newBusiness: 0, // out of the NRR by definition
      // Legacy consumers expect a number; an absent NRR reads as 100 % on an
      // empty portfolio rather than as a total loss.
      nrr: m.nrr ?? 100,
      nrrAvailable: m.nrr != null,
      deals: movementsOf(csmId, m.month),
    }))

  const perCsm = result.perCsm
    .filter((c) => c.months.some((m) => m.startingMrr > 0 || m.upsell > 0 || m.churn > 0 || m.downsell > 0))
    .map((c) => ({
      csmId: c.csmId,
      csmName: c.csmName,
      color: c.color,
      months: toMonths(c.months, c.csmId),
      aggregate: c.aggregate,
    }))

  const global = toMonths(result.global.months, null)

  const chartData = result.months.map((month, i) => {
    const row: Record<string, unknown> = {
      month: month.key,
      monthLabel: month.label,
      Global: global[i].nrr,
    }
    for (const csm of perCsm) {
      row[csm.csmName.split(" ")[0]] = csm.months[i].nrr
    }
    return row
  })

  return {
    chartData,
    global,
    perCsm,
    months: result.months,
    aggregate: result.global.aggregate,
    diagnostics: result.diagnostics.summary,
    capturedAt: result.capturedAt,
  }
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const monthsBack = Math.min(Math.max(parseInt(params.get("months") ?? "6", 10) || 6, 1), 24)

    const result = await computeMetrics({
      monthsBack,
      csmIds: CSM_TEAM.map((c) => c.id),
      config: configFromParams(params),
      snapshotOptions: { refresh: params.get("refresh") === "true" },
    })

    return NextResponse.json(toLegacyShape(result))
  } catch (error) {
    console.error("NRR Trends API error:", error)
    return NextResponse.json(
      { error: "Failed to compute NRR trends", details: String(error) },
      { status: 500 }
    )
  }
}
