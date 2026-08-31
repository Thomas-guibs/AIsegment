export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { fetchCustomerCompanies } from "@/lib/hubspot/companies"
import { fetchAttributionDeals } from "@/lib/hubspot/deals"
import type { Deal } from "@/lib/types"
import { ATTRIBUTION, CSM_TEAM, isRetainedMovement, movementDate } from "@/lib/constants"
import {
  startOfMonth,
  subMonths,
  endOfMonth,
  format,
} from "date-fns"

// Acquisition attributions = new business
const ACQUISITION_ATTRIBUTIONS = [
  ATTRIBUTION.PARTNERS,
  ATTRIBUTION.HUNT,
  ATTRIBUTION.INBOUND,
  ATTRIBUTION.PAID,
  ATTRIBUTION.EVENT,
  ATTRIBUTION.PLG,
]

// CSMs to include in the analysis (exclude backup/inactive)
const ACTIVE_CSMS = CSM_TEAM.filter(
  (c) => c.id !== "1949410186" && c.id !== "44919918" // Exclude Antoine Rivaud & Thomas Prouveur
)

interface DealDetail {
  id: string
  name: string
  amount: number
  attribution: string
  companyName?: string
  ownerId: string | null
  operationDate: string | null
  stage: string
}

interface NrrMonthData {
  month: string
  monthLabel: string
  startingMrr: number
  upsell: number
  churn: number
  downsell: number
  newBusiness: number
  // Per spec §6: null when MRR_début ≤ 0 (a starting-empty portfolio isn't a portfolio
  // that lost everything — the NRR is simply not computable).
  nrr: number | null
  deals: DealDetail[] // individual deals for this month
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
      fetchCustomerCompanies(),
      fetchAttributionDeals(
        [ATTRIBUTION.UPSELL, ATTRIBUTION.CHURN, ATTRIBUTION.DOWNSELL],
        globalDateFrom,
        globalDateTo
      ),
      fetchAttributionDeals(
        ACQUISITION_ATTRIBUTIONS,
        globalDateFrom,
        globalDateTo
      ),
    ])

    // --- Filters (spec §5) ---
    // A retained movement passes stage + reference-date + non-zero amount filters.
    // Reference date differs by type:
    //   - Upsell:   date_de_paiement    (the money is only acquired when received)
    //   - Churn:    date_de_prise_en_compte
    //   - Downsell: date_de_prise_en_compte
    const monthOf = (d: Deal): string | null => movementDate(d)?.slice(0, 7) ?? null

    const toDealDetail = (d: Deal): DealDetail => ({
      id: d.id,
      name: d.name,
      amount: d.amount,
      attribution: d.attribution ?? "",
      companyName: d.companyName,
      ownerId: d.ownerId,
      operationDate: d.operationDate,
      stage: d.stage,
    })

    // --- Per-CSM NRR ---
    const csmTrends: CsmNrrTrend[] = []

    for (const csm of ACTIVE_CSMS) {
      const csmCompanies = companies.filter((c) => c.ownerId === csm.id)
      const currentMrr = csmCompanies.reduce((sum, c) => sum + c.mrr, 0)

      const csmMovements = allMovements.filter((d) => d.ownerId === csm.id)
      const csmAcquisitions = allAcquisitions.filter((d) => d.ownerId === csm.id)

      // Group by month
      const monthlyUpsell: Record<string, number> = {}
      const monthlyChurn: Record<string, number> = {}
      const monthlyDownsell: Record<string, number> = {}
      const monthlyNewBiz: Record<string, number> = {}
      const monthlyDeals: Record<string, DealDetail[]> = {}

      for (const deal of csmMovements) {
        if (!isRetainedMovement(deal)) continue
        const mk = monthOf(deal)
        if (!mk) continue
        if (!monthlyDeals[mk]) monthlyDeals[mk] = []
        const amt = Math.abs(deal.amount)

        if (deal.attribution === ATTRIBUTION.UPSELL) {
          monthlyUpsell[mk] = (monthlyUpsell[mk] ?? 0) + amt
        } else if (deal.attribution === ATTRIBUTION.CHURN) {
          monthlyChurn[mk] = (monthlyChurn[mk] ?? 0) + amt
        } else if (deal.attribution === ATTRIBUTION.DOWNSELL) {
          monthlyDownsell[mk] = (monthlyDownsell[mk] ?? 0) + amt
        }
        monthlyDeals[mk].push(toDealDetail(deal))
      }

      for (const deal of csmAcquisitions) {
        const mk = deal.operationDate?.slice(0, 7) ?? null
        if (!mk) continue
        monthlyNewBiz[mk] = (monthlyNewBiz[mk] ?? 0) + Math.abs(deal.amount)
      }

      // Calculate starting MRR per month (working backwards from current)
      const monthData: NrrMonthData[] = []

      for (let i = 0; i < months.length; i++) {
        const month = months[i]
        const mk = month.key

        const upsell = monthlyUpsell[mk] ?? 0
        const churn = monthlyChurn[mk] ?? 0
        const downsell = monthlyDownsell[mk] ?? 0
        const newBiz = monthlyNewBiz[mk] ?? 0

        let futureUpsell = 0, futureChurn = 0, futureDownsell = 0, futureNewBiz = 0
        for (let j = i; j < months.length; j++) {
          const fmk = months[j].key
          futureUpsell += monthlyUpsell[fmk] ?? 0
          futureChurn += monthlyChurn[fmk] ?? 0
          futureDownsell += monthlyDownsell[fmk] ?? 0
          futureNewBiz += monthlyNewBiz[fmk] ?? 0
        }

        const startingMrr = currentMrr - futureUpsell + futureChurn + futureDownsell - futureNewBiz
        // Spec §6: NRR = MRR_fin / MRR_début. Not computable when MRR_début ≤ 0.
        const nrr = startingMrr > 0
          ? Math.round(((startingMrr + upsell - churn - downsell) / startingMrr) * 10000) / 100
          : null

        monthData.push({
          month: mk,
          monthLabel: month.label,
          startingMrr: Math.round(startingMrr * 100) / 100,
          upsell: Math.round(upsell * 100) / 100,
          churn: Math.round(churn * 100) / 100,
          downsell: Math.round(downsell * 100) / 100,
          newBusiness: Math.round(newBiz * 100) / 100,
          nrr,
          deals: monthlyDeals[mk] ?? [],
        })
      }

      csmTrends.push({
        csmId: csm.id,
        csmName: csm.name,
        color: csm.color,
        months: monthData,
      })
    }

    // --- Global NRR ---
    const totalCurrentMrr = companies.reduce((sum, c) => sum + c.mrr, 0)
    const globalMonthData: NrrMonthData[] = []

    const gMonthlyUpsell: Record<string, number> = {}
    const gMonthlyChurn: Record<string, number> = {}
    const gMonthlyDownsell: Record<string, number> = {}
    const gMonthlyNewBiz: Record<string, number> = {}
    const gMonthlyDeals: Record<string, DealDetail[]> = {}

    for (const deal of allMovements) {
      if (!isRetainedMovement(deal)) continue
      const mk = monthOf(deal)
      if (!mk) continue
      if (!gMonthlyDeals[mk]) gMonthlyDeals[mk] = []
      const amt = Math.abs(deal.amount)

      if (deal.attribution === ATTRIBUTION.UPSELL) {
        gMonthlyUpsell[mk] = (gMonthlyUpsell[mk] ?? 0) + amt
      } else if (deal.attribution === ATTRIBUTION.CHURN) {
        gMonthlyChurn[mk] = (gMonthlyChurn[mk] ?? 0) + amt
      } else if (deal.attribution === ATTRIBUTION.DOWNSELL) {
        gMonthlyDownsell[mk] = (gMonthlyDownsell[mk] ?? 0) + amt
      }
      gMonthlyDeals[mk].push(toDealDetail(deal))
    }
    for (const deal of allAcquisitions) {
      const mk = deal.operationDate?.slice(0, 7) ?? null
      if (!mk) continue
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
        ? Math.round(((startingMrr + upsell - churn - downsell) / startingMrr) * 10000) / 100
        : null

      globalMonthData.push({
        month: mk,
        monthLabel: month.label,
        startingMrr: Math.round(startingMrr * 100) / 100,
        upsell: Math.round(upsell * 100) / 100,
        churn: Math.round(churn * 100) / 100,
        downsell: Math.round(downsell * 100) / 100,
        newBusiness: Math.round(newBiz * 100) / 100,
        nrr,
        deals: gMonthlyDeals[mk] ?? [],
      })
    }

    // Chart-ready data
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
