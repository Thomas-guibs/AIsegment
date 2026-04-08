import { NextRequest, NextResponse } from "next/server"
import { fetchEngagements, countEngagementsByOwner } from "@/lib/hubspot/engagements"
import { getDateRange } from "@/lib/utils"
import type { PeriodFilter } from "@/lib/constants"
import { format } from "date-fns"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const period = (searchParams.get("period") ?? "this_month") as PeriodFilter
    const csmId = searchParams.get("csmId") ?? undefined

    const dateRange = getDateRange(period)
    const dateFrom = format(dateRange.from, "yyyy-MM-dd")
    const dateTo = format(dateRange.to, "yyyy-MM-dd")

    const [engagements, countsByOwner] = await Promise.all([
      fetchEngagements(dateFrom, dateTo, csmId),
      countEngagementsByOwner(dateFrom, dateTo),
    ])

    return NextResponse.json({
      engagements,
      countsByOwner,
      total: engagements.length,
    })
  } catch (error) {
    console.error("Activity API error:", error)
    return NextResponse.json(
      { error: "Failed to fetch activity", details: String(error) },
      { status: 500 }
    )
  }
}
