import { NextRequest, NextResponse } from "next/server"
import { fetchCsmMovements, enrichDealsWithCompanies } from "@/lib/hubspot/deals"
import { getDateRange } from "@/lib/utils"
import type { PeriodFilter } from "@/lib/constants"
import { format } from "date-fns"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const period = (searchParams.get("period") ?? "this_month") as PeriodFilter
    const csmId = searchParams.get("csmId") ?? undefined
    const limit = parseInt(searchParams.get("limit") ?? "20", 10)

    const dateRange = getDateRange(period)
    const dateFrom = format(dateRange.from, "yyyy-MM-dd")
    const dateTo = format(dateRange.to, "yyyy-MM-dd")

    let deals = await fetchCsmMovements(dateFrom, dateTo, csmId)

    // Enrich with company names
    deals = await enrichDealsWithCompanies(deals)

    // Limit results
    deals = deals.slice(0, limit)

    return NextResponse.json({ deals, total: deals.length })
  } catch (error) {
    console.error("Deals API error:", error)
    return NextResponse.json(
      { error: "Failed to fetch deals", details: String(error) },
      { status: 500 }
    )
  }
}
