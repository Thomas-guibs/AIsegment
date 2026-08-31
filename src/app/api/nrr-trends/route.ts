export const dynamic = "force-dynamic"

// =============================================================================
// NRR Trends — spec CALCUL.md §3 §4 §5 §6
//
// Point-in-time reading. For each month M:
//   T = 1st of M at 00:00 UTC
//   MRR_début(csm, M) = Σ mrr_at(T) sur companies passant les 5 conditions §3
//                       et non sorties §4
//   Mouvements(csm, M) = Σ retained movements dont movementDate ∈ M,
//                        attribués au CSM propriétaire à T (owner_at_month_start §5)
//   NRR(csm, M) = (MRR_début + upsell − churn − downsell) / MRR_début  (§6)
//   NRR(csm, quarter) = weighted formula (§6)
// =============================================================================

import { NextRequest, NextResponse } from "next/server"
import { fetchCustomerCompanies } from "@/lib/hubspot/companies"
import { fetchAttributionDeals, enrichDealsWithCompanies } from "@/lib/hubspot/deals"
import { fetchCompanyHistoryBatch } from "@/lib/hubspot/history"
import {
  ATTRIBUTION,
  CSM_TEAM,
  isRetainedMovement,
  movementDate,
} from "@/lib/constants"
import {
  earliestPaymentByCompany,
  dealsByCompany,
  mrrUnderManagement,
  ownerAtMonthStart,
  monthlyNrr,
  weightedQuarterlyNrr,
  firstOfMonthUTC,
} from "@/lib/analytics/portfolio"
import {
  startOfMonth,
  subMonths,
  endOfMonth,
  format,
  getQuarter,
} from "date-fns"

const ACQUISITION_ATTRIBUTIONS = [
  ATTRIBUTION.PARTNERS,
  ATTRIBUTION.HUNT,
  ATTRIBUTION.INBOUND,
  ATTRIBUTION.PAID,
  ATTRIBUTION.EVENT,
  ATTRIBUTION.PLG,
]

const ACTIVE_CSMS = CSM_TEAM.filter(
  (c) => c.id !== "1949410186" && c.id !== "44919918" // Exclude Antoine Rivaud & Thomas Prouveur
)

interface DealDetail {
  id: string
  name: string
  amount: number
  attribution: string
  companyName?: string
  ownerId: string | null       // deal-level owner
  attributedCsm: string | null // spec §5 owner_at_month_start
  operationDate: string | null
  paymentDate: string | null
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
  nrr: number | null   // null when MRR_début ≤ 0
  deals: DealDetail[]
}

interface QuarterlyNrr {
  quarterLabel: string
  months: string[]
  nrr: number | null
}

interface CsmNrrTrend {
  csmId: string
  csmName: string
  color: string
  months: NrrMonthData[]
  quarters: QuarterlyNrr[]
}

export async function GET(request: NextRequest) {
  try {
    const monthsBack = parseInt(
      request.nextUrl.searchParams.get("months") ?? "6",
      10
    )

    const now = new Date()
    const months: {
      start: Date
      end: Date
      key: string
      label: string
      tIso: string
    }[] = []
    for (let i = monthsBack - 1; i >= 0; i--) {
      const monthDate = subMonths(now, i)
      const start = startOfMonth(monthDate)
      const end = endOfMonth(monthDate)
      months.push({
        start,
        end,
        key: format(start, "yyyy-MM"),
        label: format(start, "MMM yy"),
        tIso: firstOfMonthUTC(start.getFullYear(), start.getMonth() + 1),
      })
    }

    // Wide window for earliest-payment discovery (covers historical first bills)
    const wideFrom = "2010-01-01"
    const wideTo = format(now, "yyyy-MM-dd")

    // Fetch — companies + all deals in the sales pipeline that carry a payment
    // or a movement. We fetch ALL attributions (movements + acquisitions) on a
    // very wide window so earliest-payment lookup has the first bill.
    const [activeCompanies, allAttributedDealsRaw] = await Promise.all([
      fetchCustomerCompanies(),
      fetchAttributionDeals(
        [
          ATTRIBUTION.UPSELL,
          ATTRIBUTION.CHURN,
          ATTRIBUTION.DOWNSELL,
          ...ACQUISITION_ATTRIBUTIONS,
        ],
        wideFrom,
        wideTo
      ),
    ])
    const allDeals = await enrichDealsWithCompanies(allAttributedDealsRaw)

    // Enrich with company IDs the deals reference (some may not be in
    // activeCompanies — e.g. churned accounts still relevant for history).
    const companyIdSet = new Set<string>()
    for (const c of activeCompanies) companyIdSet.add(c.id)
    for (const d of allDeals) if (d.companyId) companyIdSet.add(d.companyId)

    // Fetch point-in-time history for every relevant company
    const historyMap = await fetchCompanyHistoryBatch(Array.from(companyIdSet))
    const historyList = Array.from(historyMap.values())

    // Derived maps for §3 condition 4 and §4 exit signal
    const earliestPayment = earliestPaymentByCompany(allDeals)
    const companyDealsMap = dealsByCompany(allDeals)

    // -------------------------------------------------------------------------
    // MRR under management per (CSM, month) — spec §3 §4
    // -------------------------------------------------------------------------
    const mrrByCsmMonth = new Map<string, Map<string, number>>()
    // key format: `${csmId}::${monthKey}` → mrr
    for (const m of months) {
      const contribs = mrrUnderManagement(
        historyList,
        earliestPayment,
        companyDealsMap,
        m.tIso
      )
      for (const c of contribs) {
        if (!mrrByCsmMonth.has(c.csm)) mrrByCsmMonth.set(c.csm, new Map())
        const csmMap = mrrByCsmMonth.get(c.csm)!
        csmMap.set(m.key, (csmMap.get(m.key) ?? 0) + c.mrr)
      }
    }

    // Global MRR under management per month
    const globalMrrByMonth = new Map<string, number>()
    for (const m of months) {
      let total = 0
      mrrByCsmMonth.forEach((csmMap) => {
        total += csmMap.get(m.key) ?? 0
      })
      globalMrrByMonth.set(m.key, total)
    }

    // -------------------------------------------------------------------------
    // Movements per (CSM, month) with owner_at_month_start attribution — spec §5
    // -------------------------------------------------------------------------
    interface Bucket {
      upsell: number
      churn: number
      downsell: number
      newBusiness: number
      deals: DealDetail[]
    }
    const emptyBucket = (): Bucket => ({
      upsell: 0,
      churn: 0,
      downsell: 0,
      newBusiness: 0,
      deals: [],
    })

    const monthKeys = new Set(months.map((m) => m.key))
    const perCsmMovements = new Map<string, Map<string, Bucket>>()
    const globalMovements = new Map<string, Bucket>()
    for (const m of months) globalMovements.set(m.key, emptyBucket())

    for (const deal of allDeals) {
      const isAcquisition =
        !!deal.attribution && (ACQUISITION_ATTRIBUTIONS as readonly string[]).includes(deal.attribution)
      const isMovement = isRetainedMovement(deal)
      if (!isAcquisition && !isMovement) continue

      // Bucket month key: movementDate for movements, operationDate for acquisitions
      let refDate: string | null
      if (isMovement) {
        refDate = movementDate(deal) ?? null
      } else {
        refDate = deal.operationDate ?? null
      }
      if (!refDate) continue
      const mk = refDate.slice(0, 7)
      if (!monthKeys.has(mk)) continue

      // Spec §5 attribution: owner_at_month_start (same rule for movements + new biz)
      const csm = ownerAtMonthStart(
        deal,
        deal.companyId ? historyMap.get(deal.companyId) : undefined
      )

      const amt = Math.abs(deal.amount)
      const detail: DealDetail = {
        id: deal.id,
        name: deal.name,
        amount: deal.amount,
        attribution: deal.attribution ?? "",
        companyName: deal.companyName,
        ownerId: deal.ownerId,
        attributedCsm: csm,
        operationDate: deal.operationDate,
        paymentDate: deal.paymentDate,
        stage: deal.stage,
      }

      // Global
      const gb = globalMovements.get(mk)!
      if (isMovement) {
        if (deal.attribution === ATTRIBUTION.UPSELL) gb.upsell += amt
        else if (deal.attribution === ATTRIBUTION.CHURN) gb.churn += amt
        else if (deal.attribution === ATTRIBUTION.DOWNSELL) gb.downsell += amt
      } else {
        gb.newBusiness += amt
      }
      gb.deals.push(detail)

      // Per-CSM
      if (csm) {
        if (!perCsmMovements.has(csm)) perCsmMovements.set(csm, new Map())
        const csmMap = perCsmMovements.get(csm)!
        if (!csmMap.has(mk)) csmMap.set(mk, emptyBucket())
        const b = csmMap.get(mk)!
        if (isMovement) {
          if (deal.attribution === ATTRIBUTION.UPSELL) b.upsell += amt
          else if (deal.attribution === ATTRIBUTION.CHURN) b.churn += amt
          else if (deal.attribution === ATTRIBUTION.DOWNSELL) b.downsell += amt
        } else {
          b.newBusiness += amt
        }
        b.deals.push(detail)
      }
    }

    // -------------------------------------------------------------------------
    // Assemble per-CSM series
    // -------------------------------------------------------------------------
    const csmTrends: CsmNrrTrend[] = []
    for (const csm of ACTIVE_CSMS) {
      const bucketsForCsm = perCsmMovements.get(csm.id)
      const mrrMap = mrrByCsmMonth.get(csm.id)
      const monthData: NrrMonthData[] = months.map((m) => {
        const b = bucketsForCsm?.get(m.key) ?? emptyBucket()
        const startingMrr = mrrMap?.get(m.key) ?? 0
        return {
          month: m.key,
          monthLabel: m.label,
          startingMrr: round2(startingMrr),
          upsell: round2(b.upsell),
          churn: round2(b.churn),
          downsell: round2(b.downsell),
          newBusiness: round2(b.newBusiness),
          nrr: roundOrNull(monthlyNrr(startingMrr, b.upsell, b.churn, b.downsell)),
          deals: b.deals,
        }
      })

      csmTrends.push({
        csmId: csm.id,
        csmName: csm.name,
        color: csm.color,
        months: monthData,
        quarters: buildQuarters(monthData),
      })
    }

    // -------------------------------------------------------------------------
    // Assemble global series
    // -------------------------------------------------------------------------
    const globalMonthData: NrrMonthData[] = months.map((m) => {
      const b = globalMovements.get(m.key)!
      const startingMrr = globalMrrByMonth.get(m.key) ?? 0
      return {
        month: m.key,
        monthLabel: m.label,
        startingMrr: round2(startingMrr),
        upsell: round2(b.upsell),
        churn: round2(b.churn),
        downsell: round2(b.downsell),
        newBusiness: round2(b.newBusiness),
        nrr: roundOrNull(monthlyNrr(startingMrr, b.upsell, b.churn, b.downsell)),
        deals: b.deals,
      }
    })
    const globalQuarters = buildQuarters(globalMonthData)

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
      globalQuarters,
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

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function roundOrNull(n: number | null): number | null {
  if (n === null) return null
  return Math.round(n * 100) / 100
}

// Aggregate monthly metrics into calendar quarters and apply spec §6 weighted.
function buildQuarters(months: NrrMonthData[]): QuarterlyNrr[] {
  const byQuarter = new Map<string, NrrMonthData[]>()
  for (const m of months) {
    const [y, mm] = m.month.split("-").map(Number)
    const q = getQuarter(new Date(Date.UTC(y, mm - 1, 1)))
    const key = `${y}-Q${q}`
    if (!byQuarter.has(key)) byQuarter.set(key, [])
    byQuarter.get(key)!.push(m)
  }
  return Array.from(byQuarter.entries()).map(([label, ms]) => ({
    quarterLabel: label,
    months: ms.map((m) => m.month),
    nrr: roundOrNull(
      weightedQuarterlyNrr(
        ms.map((m) => ({
          startingMrr: m.startingMrr,
          upsell: m.upsell,
          churn: m.churn,
          downsell: m.downsell,
        }))
      )
    ),
  }))
}
