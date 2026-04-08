import { NextRequest, NextResponse } from "next/server"
import { fetchCustomerDeals, fetchNewDealsThisWeek, enrichDealsWithCompanies } from "@/lib/hubspot/deals"
import {
  CUSTOMER_STAGE_CATEGORIES,
  CUSTOMER_STAGE_LABELS,
  STAGE_CATEGORY_LABELS,
  STAGE_CATEGORY_COLORS,
  ATTRIBUTION,
  type StageCategory,
} from "@/lib/constants"
import type { PipelineFunnelStep, StageAging } from "@/lib/types"
import { differenceInDays } from "date-fns"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const csmId = searchParams.get("csmId") ?? undefined

    // Parallel fetch
    const [allDeals, newUpsellDeals, newChurnDeals] = await Promise.all([
      fetchCustomerDeals(csmId),
      fetchNewDealsThisWeek(ATTRIBUTION.UPSELL),
      fetchNewDealsThisWeek(ATTRIBUTION.CHURN),
    ])

    // Enrich new deals with company names
    const [enrichedUpsell, enrichedChurn] = await Promise.all([
      enrichDealsWithCompanies(newUpsellDeals),
      enrichDealsWithCompanies(newChurnDeals),
    ])

    // Build funnel steps grouped by category
    const categoryOrder: StageCategory[] = ["onboarding", "active", "at_risk", "churned"]
    const categoryCounts: Record<StageCategory, { count: number; mrr: number }> = {
      onboarding: { count: 0, mrr: 0 },
      active: { count: 0, mrr: 0 },
      at_risk: { count: 0, mrr: 0 },
      churned: { count: 0, mrr: 0 },
      disqualified: { count: 0, mrr: 0 },
    }

    for (const deal of allDeals) {
      const category = CUSTOMER_STAGE_CATEGORIES[deal.stage]
      if (category) {
        categoryCounts[category].count++
        categoryCounts[category].mrr += deal.mrr
      }
    }

    const funnel: PipelineFunnelStep[] = categoryOrder.map((cat, i) => ({
      category: cat,
      label: STAGE_CATEGORY_LABELS[cat],
      dealCount: categoryCounts[cat].count,
      totalMrr: categoryCounts[cat].mrr,
      conversionRate:
        i > 0 && categoryCounts[categoryOrder[i - 1]].count > 0
          ? (categoryCounts[cat].count / categoryCounts[categoryOrder[i - 1]].count) * 100
          : null,
      color: STAGE_CATEGORY_COLORS[cat],
    }))

    // Stage aging analysis
    const stageAging: StageAging[] = []
    const stageGroups: Record<string, number[]> = {}

    for (const deal of allDeals) {
      if (!stageGroups[deal.stage]) stageGroups[deal.stage] = []
      const daysInStage = deal.lastModified
        ? differenceInDays(new Date(), new Date(deal.lastModified))
        : 0
      stageGroups[deal.stage].push(daysInStage)
    }

    for (const [stageId, days] of Object.entries(stageGroups)) {
      const avgDays = days.reduce((a, b) => a + b, 0) / days.length
      stageAging.push({
        stageId,
        stageLabel: CUSTOMER_STAGE_LABELS[stageId] ?? stageId,
        avgDays: Math.round(avgDays),
        dealCount: days.length,
        isOverThreshold: avgDays > 30,
      })
    }

    // Sort aging by avgDays DESC
    stageAging.sort((a, b) => b.avgDays - a.avgDays)

    // All deals enriched with company names for the table
    const enrichedDeals = await enrichDealsWithCompanies(allDeals)

    return NextResponse.json({
      funnel,
      stageAging,
      newUpsellDeals: enrichedUpsell,
      newChurnDeals: enrichedChurn,
      deals: enrichedDeals,
      totalDeals: allDeals.length,
    })
  } catch (error) {
    console.error("Pipeline API error:", error)
    return NextResponse.json(
      { error: "Failed to fetch pipeline data", details: String(error) },
      { status: 500 }
    )
  }
}
