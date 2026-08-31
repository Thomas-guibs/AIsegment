export const dynamic = "force-dynamic"
export const maxDuration = 300

import { NextRequest, NextResponse } from "next/server"
import { format, addDays, startOfMonth, subMonths } from "date-fns"

import { computeMetrics } from "@/lib/engine"
import { configFromParams } from "@/lib/engine/config"
import { fetchRenewalDeals, fetchCustomerDeals } from "@/lib/hubspot/deals"
import { CSM_TEAM, type StageCategory } from "@/lib/constants"
import type { DashboardKpis, KpiValue } from "@/lib/types"
import { formatDelta } from "@/lib/utils"

/**
 * Headline KPIs, read from the metrics engine so the dashboard, the trends view
 * and any payout audit agree on the same numbers. The month in progress is
 * compared against the previous **complete** month.
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const csmId = params.get("csmId") ?? undefined
    const config = configFromParams(params)

    const [metrics, renewalDeals, customerDeals] = await Promise.all([
      computeMetrics({
        monthsBack: 2,
        csmIds: csmId ? [csmId] : CSM_TEAM.map((c) => c.id),
        config,
      }),
      fetchRenewalDeals(
        format(new Date(), "yyyy-MM-dd"),
        format(addDays(new Date(), 30), "yyyy-MM-dd"),
        csmId
      ),
      fetchCustomerDeals(csmId),
    ])

    const currentKey = format(startOfMonth(new Date()), "yyyy-MM")
    const previousKey = format(startOfMonth(subMonths(new Date(), 1)), "yyyy-MM")

    const current = metrics.global.months.find((m) => m.month === currentKey)
    const previous = metrics.global.months.find((m) => m.month === previousKey)

    const zero = {
      startingMrr: 0, upsell: 0, downsell: 0, churn: 0, net: 0,
      endingMrr: 0, nrr: null as number | null, accountCount: 0,
    }
    const now = current ?? zero
    const prev = previous ?? zero

    // 1. MRR under management — read point-in-time at the 1st, not the live sum.
    const mrrDelta = formatDelta(now.startingMrr, prev.startingMrr)
    const mrrUnderManagement: KpiValue = {
      value: now.startingMrr,
      previousValue: prev.startingMrr,
      delta: mrrDelta.delta,
      deltaDirection: mrrDelta.direction,
      label: "MRR sous gestion",
      format: "currency",
    }

    // 2. NRR. An absent NRR (empty portfolio) shows as 0 rather than a fake 100 %.
    const nrrDelta = formatDelta(now.nrr ?? 0, prev.nrr ?? 0)
    const nrr: KpiValue = {
      value: now.nrr ?? 0,
      previousValue: prev.nrr ?? 0,
      delta: nrrDelta.delta,
      deltaDirection: nrrDelta.direction,
      label: "NRR",
      format: "percent",
    }

    // 3. Churn rate, in MRR terms — a €5 000 churn is not one €50 churn.
    const churnRateValue = now.startingMrr > 0 ? (now.churn / now.startingMrr) * 100 : 0
    const prevChurnRate = prev.startingMrr > 0 ? (prev.churn / prev.startingMrr) * 100 : 0
    const churnDelta = formatDelta(churnRateValue, prevChurnRate)
    const churnRate: KpiValue = {
      value: churnRateValue,
      previousValue: prevChurnRate,
      delta: churnDelta.delta,
      // For churn, down is good.
      deltaDirection:
        churnDelta.direction === "up" ? "down" : churnDelta.direction === "down" ? "up" : "flat",
      label: "Taux de churn (MRR)",
      format: "percent",
    }

    // 4. Upsell of the month.
    const upsellDelta = formatDelta(now.upsell, prev.upsell)
    const upsellRevenue: KpiValue = {
      value: now.upsell,
      previousValue: prev.upsell,
      delta: upsellDelta.delta,
      deltaDirection: upsellDelta.direction,
      label: "Upsell du mois",
      format: "currency",
    }

    // 5. Deals in flight, by stage category.
    const SALES_STAGE_CATEGORY: Record<string, StageCategory> = {
      qualifiedtobuy: "onboarding",
      presentationscheduled: "onboarding",
      contractsent: "active",
      closedwon: "active",
      "878353129": "active",
      closedlost: "active", // "Closed won" — the labels are inverted in this portal
      "143474109": "active",
      "1246247145": "active",
      "124302781": "churned",
      "124302782": "at_risk",
      "1220133077": "churned",
    }

    const breakdown: Record<StageCategory, number> = {
      onboarding: 0, active: 0, at_risk: 0, churned: 0, disqualified: 0,
    }
    let activeCount = 0
    for (const deal of customerDeals) {
      const category = SALES_STAGE_CATEGORY[deal.stage]
      if (!category) continue
      breakdown[category]++
      if (category !== "churned") activeCount++
    }

    const activeDeals: KpiValue & { breakdown: Record<StageCategory, number> } = {
      value: activeCount,
      previousValue: activeCount,
      delta: 0,
      deltaDirection: "flat",
      label: "Deals en cours",
      format: "number",
      breakdown,
    }

    // 6. Renewals in the next 30 days.
    const renewals30d: KpiValue = {
      value: renewalDeals.length,
      previousValue: 0,
      delta: 0,
      deltaDirection: renewalDeals.length > 5 ? "down" : "flat",
      label: "Renewals à 30j",
      format: "number",
    }

    const kpis: DashboardKpis & { diagnostics: typeof metrics.diagnostics.summary } = {
      mrrUnderManagement,
      nrr,
      churnRate,
      upsellRevenue,
      activeDeals,
      renewals30d,
      diagnostics: metrics.diagnostics.summary,
    }

    return NextResponse.json(kpis)
  } catch (error) {
    console.error("KPIs API error:", error)
    return NextResponse.json(
      { error: "Failed to fetch KPIs", details: String(error) },
      { status: 500 }
    )
  }
}
