export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { fetchRenewalDeals, enrichDealsWithCompanies } from "@/lib/hubspot/deals"
import { format, addDays, subMonths } from "date-fns"
import { daysFromNow } from "@/lib/utils"
import type { RenewalDeal, RenewalKpis } from "@/lib/types"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const csmId = searchParams.get("csmId") ?? undefined
    const days = parseInt(searchParams.get("days") ?? "90", 10)

    const today = new Date()
    const dateFrom = format(today, "yyyy-MM-dd")
    const dateTo = format(addDays(today, days), "yyyy-MM-dd")

    let deals = await fetchRenewalDeals(dateFrom, dateTo, csmId)
    deals = await enrichDealsWithCompanies(deals)

    // Transform to RenewalDeal with daysUntilRenewal
    const renewalDeals: RenewalDeal[] = deals.map((d) => ({
      ...d,
      daysUntilRenewal: d.renewalDate ? daysFromNow(d.renewalDate) : 999,
    }))

    // Calculate KPIs
    const thisMonthEnd = format(addDays(today, 30), "yyyy-MM-dd")
    const nextMonthEnd = format(addDays(today, 60), "yyyy-MM-dd")

    const thisMonthDeals = renewalDeals.filter((d) => d.daysUntilRenewal <= 30)
    const nextMonthDeals = renewalDeals.filter((d) => d.daysUntilRenewal > 30 && d.daysUntilRenewal <= 60)

    const kpis: RenewalKpis = {
      thisMonth: {
        count: thisMonthDeals.length,
        mrr: thisMonthDeals.reduce((sum, d) => sum + d.mrr, 0),
      },
      nextMonth: {
        count: nextMonthDeals.length,
        mrr: nextMonthDeals.reduce((sum, d) => sum + d.mrr, 0),
      },
      next90Days: {
        count: renewalDeals.length,
        mrr: renewalDeals.reduce((sum, d) => sum + d.mrr, 0),
      },
      renewalRate: 0, // Would need historical data to calculate properly
    }

    return NextResponse.json({ deals: renewalDeals, kpis })
  } catch (error) {
    console.error("Renewals API error:", error)
    return NextResponse.json(
      { error: "Failed to fetch renewals", details: String(error) },
      { status: 500 }
    )
  }
}
