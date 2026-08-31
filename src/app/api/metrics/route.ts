export const dynamic = "force-dynamic"
// The snapshot + history reads are heavier than a plain search; give them room.
export const maxDuration = 300

import { NextRequest, NextResponse } from "next/server"
import { computeMetrics } from "@/lib/engine"
import { configFromParams } from "@/lib/engine/config"
import { CSM_TEAM } from "@/lib/constants"

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const config = configFromParams(params)

    const monthsBack = Math.min(Math.max(parseInt(params.get("months") ?? "6", 10) || 6, 1), 24)
    const csmParam = params.get("csmId")
    const csmIds = csmParam ? [csmParam] : CSM_TEAM.map((c) => c.id)
    const refresh = params.get("refresh") === "true"

    const result = await computeMetrics({
      monthsBack,
      csmIds,
      config,
      snapshotOptions: { refresh, backfillHistory: config.backfillHistory },
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("Metrics API error:", error)
    return NextResponse.json(
      { error: "Failed to compute metrics", details: String(error) },
      { status: 500 }
    )
  }
}
