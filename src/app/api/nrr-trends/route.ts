export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { fetchCustomerCompanies } from "@/lib/hubspot/companies"
import { fetchAttributionDeals } from "@/lib/hubspot/deals"
import type { Deal } from "@/lib/types"
import { ATTRIBUTION, CSM_TEAM } from "@/lib/constants"
import {
  startOfMonth,
  subMonths,
  endOfMonth,
  format,
} from "date-fns"

// Acquisition attributions = new business that brought a company to the CSM
const ACQUISITION_ATTRIBUTIONS = [
  ATTRIBUTION.PARTNERS,
  ATTRIBUTION.HUNT,
  ATTRIBUTION.INBOUND,
  ATTRIBUTION.PAID,
  ATTRIBUTION.EVENT,
  ATTRIBUTION.PLG,
]

interface NrrMonthData {
  month: string        // "2026-01"
  monthLabel: string   // "Jan 2026"
  startingMrr: number
  upsell: number
  churn: number
  downsell: number
  newBusiness: number  // MRR from new acquisitions (to subtract from starting)
  nrr: number          // percentage
}

interface CsmNrrTrend {
  csmId: string
  csmName: string
  color: string
  months: NrrMonthData[]
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const monthsBack = parseInt(searchParams.get("months") ?? "6", 10)

    const now = new Date()
    const months: { start: Date; end: Date; key: string; label: string }[] = []

    for (let i = monthsBack - 1; i >= 0; i--) {
      const monthDate = subMonths(now, i)
      const start = startOfMonth(monthDate)
      const end = endOfMonth(monthDate)
      months.push({
        start,
        end,
        key: format(start, "yyyy-MM"),
        label: format(start, "MMM yy"),
      })
    }

    const globalDateFrom = format(months[0].start, "yyyy-MM-dd")
    const globalDateTo = format(months[months.length - 1].end, "yyyy-MM-dd")

    // Fetch all data in parallel
    const [companies, allMovements, allAcquisitions] = await Promise.all([
      // Current portfolio per CSM
      fetchCustomerCompanies(),
      // All Upsell/Churn/Downsell deals in the period
      fetchAttributionDeals(
        [ATTRIBUTION.UPSELL, ATTRIBUTION.CHURN, ATTRIBUTION.DOWNSELL],
        globalDateFrom,
        globalDateTo
      ),
      // All acquisition deals in the period (new business)
      fetchAttributionDeals(
        ACQUISITION_ATTRIBUTIONS,
        globalDateFrom,
        globalDateTo
      ),
    ])

    const getDealDate = (d: Deal): string | null =>
      d.operationDate?.slice(0, 10) ?? d.closeDate?.slice(0, 10) ?? d.createdAt?.slice(0, 10) ?? null

    const getMonthKey = (dateStr: string): string => dateStr.slice(0, 7)

    // Build NRR for each CSM
    const csmTrends: CsmNrrTrend[] = []

    for (const csm of CSM_TEAM) {
      // Current MRR for this CSM (companies where proprietaire_de_l_entreprise__csm_ = csm.id)
      const csmCompanies = companies.filter((c) => c.ownerId === csm.id)
      const currentMrr = csmCompanies.reduce((sum, c) => sum + c.mrr, 0)

      // Deals owned by this CSM
      const csmMovements = allMovements.filter((d) => d.ownerId === csm.id)
      const csmAcquisitions = allAcquisitions.filter((d) => d.ownerId === csm.id)

      // Group movements by month
      const monthlyUpsell: Record<string, number> = {}
      const monthlyChurn: Record<string, number> = {}
      const monthlyDownsell: Record<string, number> = {}
      const monthlyNewBiz: Record<string, number> = {}

      for (const deal of csmMovements) {
        const dateStr = getDealDate(deal)
        if (!dateStr) continue
        const mk = getMonthKey(dateStr)

        if (deal.attribution === ATTRIBUTION.UPSELL) {
          monthlyUpsell[mk] = (monthlyUpsell[mk] ?? 0) + Math.abs(deal.amount)
        } else if (deal.attribution === ATTRIBUTION.CHURN) {
          monthlyChurn[mk] = (monthlyChurn[mk] ?? 0) + Math.abs(deal.amount)
        } else if (deal.attribution === ATTRIBUTION.DOWNSELL) {
          monthlyDownsell[mk] = (monthlyDownsell[mk] ?? 0) + Math.abs(deal.amount)
        }
      }

      for (const deal of csmAcquisitions) {
        const dateStr = getDealDate(deal)
        if (!dateStr) continue
        const mk = getMonthKey(dateStr)
        monthlyNewBiz[mk] = (monthlyNewBiz[mk] ?? 0) + Math.abs(deal.amount)
      }

      // Calculate starting MRR for each month by working backwards from current MRR.
      // Starting MRR of month M = current MRR
      //   - sum of upsells from M to now (they increased MRR)
      //   + sum of churns from M to now (they decreased MRR, so add back)
      //   + sum of downsells from M to now (they decreased MRR, so add back)
      //   - sum of new business from M to now (they added new MRR)
      const monthData: NrrMonthData[] = []

      for (let i = 0; i < months.length; i++) {
        const month = months[i]
        const mk = month.key

        const upsell = monthlyUpsell[mk] ?? 0
        const churn = monthlyChurn[mk] ?? 0
        const downsell = monthlyDownsell[mk] ?? 0
        const newBiz = monthlyNewBiz[mk] ?? 0

        // Sum of all net changes AFTER this month (from month i+1 to end)
        let futureUpsell = 0
        let futureChurn = 0
        let futureDownsell = 0
        let futureNewBiz = 0

        for (let j = i; j < months.length; j++) {
          const fmk = months[j].key
          futureUpsell += monthlyUpsell[fmk] ?? 0
          futureChurn += monthlyChurn[fmk] ?? 0
          futureDownsell += monthlyDownsell[fmk] ?? 0
          futureNewBiz += monthlyNewBiz[fmk] ?? 0
        }

        // Starting MRR = current MRR - future upsells + future churns + future downsells - future new biz
        const startingMrr = currentMrr - futureUpsell + futureChurn + futureDownsell - futureNewBiz

        // NRR = (starting + upsell - churn - downsell) / starting * 100
        const nrr = startingMrr > 0
          ? ((startingMrr + upsell - churn - downsell) / startingMrr) * 100
          : 100

        monthData.push({
          month: mk,
          monthLabel: month.label,
          startingMrr,
          upsell,
          churn,
          downsell,
          newBusiness: newBiz,
          nrr: Math.round(nrr * 100) / 100,
        })
      }

      csmTrends.push({
        csmId: csm.id,
        csmName: csm.name,
        color: csm.color,
        months: monthData,
      })
    }

    // Also compute global NRR (all companies, not just CSM team)
    const totalCurrentMrr = companies.reduce((sum, c) => sum + c.mrr, 0)
    const globalMonthData: NrrMonthData[] = []

    const gMonthlyUpsell: Record<string, number> = {}
    const gMonthlyChurn: Record<string, number> = {}
    const gMonthlyDownsell: Record<string, number> = {}
    const gMonthlyNewBiz: Record<string, number> = {}

    for (const deal of allMovements) {
      const dateStr = getDealDate(deal)
      if (!dateStr) continue
      const mk = getMonthKey(dateStr)
      if (deal.attribution === ATTRIBUTION.UPSELL) gMonthlyUpsell[mk] = (gMonthlyUpsell[mk] ?? 0) + Math.abs(deal.amount)
      else if (deal.attribution === ATTRIBUTION.CHURN) gMonthlyChurn[mk] = (gMonthlyChurn[mk] ?? 0) + Math.abs(deal.amount)
      else if (deal.attribution === ATTRIBUTION.DOWNSELL) gMonthlyDownsell[mk] = (gMonthlyDownsell[mk] ?? 0) + Math.abs(deal.amount)
    }
    for (const deal of allAcquisitions) {
      const dateStr = getDealDate(deal)
      if (!dateStr) continue
      const mk = getMonthKey(dateStr)
      gMonthlyNewBiz[mk] = (gMonthlyNewBiz[mk] ?? 0) + Math.abs(deal.amount)
    }

    for (let i = 0; i < months.length; i++) {
      const month = months[i]
      const mk = month.key
      const upsell = gMonthlyUpsell[mk] ?? 0
      const churn = gMonthlyChurn[mk] ?? 0
      const downsell = gMonthlyDownsell[mk] ?? 0
      const newBiz = gMonthlyNewBiz[mk] ?? 0

      let futureUpsell = 0, futureChurn = 0, futureDownsell = 0, futureNewBiz = 0
      for (let j = i; j < months.length; j++) {
        const fmk = months[j].key
        futureUpsell += gMonthlyUpsell[fmk] ?? 0
        futureChurn += gMonthlyChurn[fmk] ?? 0
        futureDownsell += gMonthlyDownsell[fmk] ?? 0
        futureNewBiz += gMonthlyNewBiz[fmk] ?? 0
      }

      const startingMrr = totalCurrentMrr - futureUpsell + futureChurn + futureDownsell - futureNewBiz
      const nrr = startingMrr > 0
        ? ((startingMrr + upsell - churn - downsell) / startingMrr) * 100
        : 100

      globalMonthData.push({
        month: mk,
        monthLabel: month.label,
        startingMrr,
        upsell,
        churn,
        downsell,
        newBusiness: newBiz,
        nrr: Math.round(nrr * 100) / 100,
      })
    }

    // Build chart-ready data: each row = { month, monthLabel, Global, Farah, Antoine, ... }
    const chartData = months.map((month, i) => {
      const row: Record<string, unknown> = {
        month: month.key,
        monthLabel: month.label,
        Global: globalMonthData[i].nrr,
      }
      for (const csm of csmTrends) {
        row[csm.csmName.split(" ")[0]] = csm.months[i].nrr
      }
      return row
    })

    return NextResponse.json({
      chartData,
      global: globalMonthData,
      perCsm: csmTrends,
      months: months.map((m) => ({ key: m.key, label: m.label })),
    })
  } catch (error) {
    console.error("NRR Trends API error:", error)
    return NextResponse.json(
      { error: "Failed to compute NRR trends", details: String(error) },
      { status: 500 }
    )
  }
}
