import { NextRequest, NextResponse } from "next/server"
import { fetchCustomerCompanies, getTotalCustomerMrr } from "@/lib/hubspot/companies"
import { fetchCsmMovements, fetchRenewalDeals } from "@/lib/hubspot/deals"
import { ATTRIBUTION, ACTIVE_STAGE_IDS, CUSTOMER_STAGE_CATEGORIES, type StageCategory } from "@/lib/constants"
import type { DashboardKpis, KpiValue } from "@/lib/types"
import { getDateRange, formatDelta } from "@/lib/utils"
import type { PeriodFilter } from "@/lib/constants"
import { format, addDays, startOfMonth, endOfMonth, subMonths } from "date-fns"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const period = (searchParams.get("period") ?? "this_month") as PeriodFilter
    const csmId = searchParams.get("csmId") ?? undefined
    const dateRange = getDateRange(period)

    const dateFrom = format(dateRange.from, "yyyy-MM-dd")
    const dateTo = format(dateRange.to, "yyyy-MM-dd")
    const prevFrom = format(dateRange.previousFrom, "yyyy-MM-dd")
    const prevTo = format(dateRange.previousTo, "yyyy-MM-dd")

    // Parallel fetch all data
    const [
      companies,
      currentMovements,
      previousMovements,
      renewalDeals,
    ] = await Promise.all([
      fetchCustomerCompanies(csmId),
      fetchCsmMovements(dateFrom, dateTo, csmId),
      fetchCsmMovements(prevFrom, prevTo, csmId),
      fetchRenewalDeals(
        format(new Date(), "yyyy-MM-dd"),
        format(addDays(new Date(), 30), "yyyy-MM-dd"),
        csmId
      ),
    ])

    // 1. MRR Under Management
    const totalMrr = companies.reduce((sum, c) => sum + c.mrr, 0)
    // Approximate previous MRR (current - net movements)
    const currentNetMovement = currentMovements.reduce((sum, d) => {
      if (d.attribution === ATTRIBUTION.UPSELL) return sum + d.amount
      if (d.attribution === ATTRIBUTION.CHURN) return sum - d.amount
      if (d.attribution === ATTRIBUTION.DOWNSELL) return sum - d.amount
      return sum
    }, 0)
    const previousMrr = totalMrr - currentNetMovement
    const mrrDelta = formatDelta(totalMrr, previousMrr)

    const mrrUnderManagement: KpiValue = {
      value: totalMrr,
      previousValue: previousMrr,
      delta: mrrDelta.delta,
      deltaDirection: mrrDelta.direction,
      label: "MRR Under Management",
      format: "currency",
    }

    // 2. NRR
    const startMrr = previousMrr > 0 ? previousMrr : totalMrr
    const upsellAmount = currentMovements
      .filter((d) => d.attribution === ATTRIBUTION.UPSELL)
      .reduce((sum, d) => sum + d.amount, 0)
    const churnAmount = currentMovements
      .filter((d) => d.attribution === ATTRIBUTION.CHURN)
      .reduce((sum, d) => sum + d.amount, 0)
    const downsellAmount = currentMovements
      .filter((d) => d.attribution === ATTRIBUTION.DOWNSELL)
      .reduce((sum, d) => sum + d.amount, 0)

    const nrrValue = startMrr > 0
      ? ((startMrr + upsellAmount - churnAmount - downsellAmount) / startMrr) * 100
      : 100

    const prevUpsell = previousMovements
      .filter((d) => d.attribution === ATTRIBUTION.UPSELL)
      .reduce((sum, d) => sum + d.amount, 0)
    const prevChurn = previousMovements
      .filter((d) => d.attribution === ATTRIBUTION.CHURN)
      .reduce((sum, d) => sum + d.amount, 0)
    const prevDownsell = previousMovements
      .filter((d) => d.attribution === ATTRIBUTION.DOWNSELL)
      .reduce((sum, d) => sum + d.amount, 0)

    // For previous NRR, approximate the MRR before previous period
    const prevStartMrr = previousMrr > 0 ? previousMrr - (prevUpsell - prevChurn - prevDownsell) : startMrr
    const prevNrr = prevStartMrr > 0
      ? ((prevStartMrr + prevUpsell - prevChurn - prevDownsell) / prevStartMrr) * 100
      : 100
    const nrrDelta = formatDelta(nrrValue, prevNrr)

    const nrr: KpiValue = {
      value: nrrValue,
      previousValue: prevNrr,
      delta: nrrDelta.delta,
      deltaDirection: nrrDelta.direction,
      label: "NRR",
      format: "percent",
    }

    // 3. Churn Rate
    const churnDeals = currentMovements.filter((d) => d.attribution === ATTRIBUTION.CHURN)
    const totalClientsStart = companies.length
    const churnRateValue = totalClientsStart > 0
      ? (churnDeals.length / totalClientsStart) * 100
      : 0
    const prevChurnDeals = previousMovements.filter((d) => d.attribution === ATTRIBUTION.CHURN)
    const prevChurnRate = totalClientsStart > 0
      ? (prevChurnDeals.length / totalClientsStart) * 100
      : 0
    const churnDelta = formatDelta(churnRateValue, prevChurnRate)

    const churnRate: KpiValue = {
      value: churnRateValue,
      previousValue: prevChurnRate,
      delta: churnDelta.delta,
      // For churn, down is good
      deltaDirection: churnDelta.direction === "up" ? "down" : churnDelta.direction === "down" ? "up" : "flat",
      label: "Churn Rate",
      format: "percent",
    }

    // 4. Upsell Revenue
    const upsellDeals = currentMovements.filter((d) => d.attribution === ATTRIBUTION.UPSELL)
    const upsellTotal = upsellDeals.reduce((sum, d) => sum + d.amount, 0)
    const upsellDelta = formatDelta(upsellTotal, prevUpsell)

    const upsellRevenue: KpiValue = {
      value: upsellTotal,
      previousValue: prevUpsell,
      delta: upsellDelta.delta,
      deltaDirection: upsellDelta.direction,
      label: "Upsell Revenue",
      format: "currency",
    }

    // 5. Active Deals (in Customers Stage pipeline, active stages)
    // We need to fetch deals from the customer pipeline for this
    const { fetchCustomerDeals } = await import("@/lib/hubspot/deals")
    const customerDeals = await fetchCustomerDeals(csmId)
    const activeDeals = customerDeals.filter((d) => ACTIVE_STAGE_IDS.includes(d.stage))

    const breakdown: Record<StageCategory, number> = {
      onboarding: 0,
      active: 0,
      at_risk: 0,
      churned: 0,
      disqualified: 0,
    }
    for (const deal of activeDeals) {
      const cat = CUSTOMER_STAGE_CATEGORIES[deal.stage]
      if (cat) breakdown[cat]++
    }

    const activeDealsKpi: KpiValue & { breakdown: Record<StageCategory, number> } = {
      value: activeDeals.length,
      previousValue: activeDeals.length, // No easy way to get previous without historical data
      delta: 0,
      deltaDirection: "flat",
      label: "Deals en cours",
      format: "number",
      breakdown,
    }

    // 6. Renewals in 30 days
    const renewals30d: KpiValue = {
      value: renewalDeals.length,
      previousValue: 0,
      delta: 0,
      deltaDirection: renewalDeals.length > 10 ? "down" : renewalDeals.length > 5 ? "down" : "flat",
      label: "Renewals à 30j",
      format: "number",
    }

    const kpis: DashboardKpis = {
      mrrUnderManagement,
      nrr,
      churnRate,
      upsellRevenue,
      activeDeals: activeDealsKpi,
      renewals30d,
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
