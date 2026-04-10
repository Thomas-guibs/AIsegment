export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { hubspotSearch } from "@/lib/hubspot/client"
import { enrichDealsWithCompanies } from "@/lib/hubspot/deals"
import type { HubSpotDeal } from "@/lib/types"
import { DEAL_PROPERTIES, ATTRIBUTION, CSM_TEAM, SALES_STAGES } from "@/lib/constants"
import { parseNumber, parseDate } from "@/lib/utils"
import { startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, addMonths, addQuarters, format } from "date-fns"

// Won stages — deals already closed
const WON_STAGES: string[] = [SALES_STAGES.CLOSED_WON, SALES_STAGES.PAIEMENT_RECU]
const LOST_STAGES: string[] = [SALES_STAGES.CLOSED_LOST, SALES_STAGES.CHURN_DOWNSELL]

// Active CSMs
const ACTIVE_CSMS = CSM_TEAM.filter(
  (c) => c.id !== "1949410186" && c.id !== "44919918"
)

interface ForecastDeal {
  id: string
  name: string
  amount: number
  mrr: number
  attribution: string | null
  expectedDate: string | null  // expected_closing_date or renewall_date
  closeDate: string | null
  operationDate: string | null
  stage: string
  probability: number
  ownerId: string | null
  companyName?: string
  companyId?: string
  status: "won" | "open" | "lost"
  type: "upsell" | "churn" | "renewal"
}

interface PeriodBucket {
  key: string          // "2026-04" or "2026-Q2"
  label: string        // "Avr 26" or "Q2 2026"
  upsell: { won: number; open: number; lost: number; deals: ForecastDeal[] }
  churn: { won: number; open: number; lost: number; deals: ForecastDeal[] }
  renewal: { won: number; open: number; lost: number; deals: ForecastDeal[] }
}

interface CsmForecast {
  csmId: string
  csmName: string
  color: string
  periods: PeriodBucket[]
}

function transformDeal(raw: HubSpotDeal, type: ForecastDeal["type"]): ForecastDeal {
  const stage = raw.properties.dealstage ?? ""
  const isWon = WON_STAGES.includes(stage)
  const isLost = LOST_STAGES.includes(stage)

  return {
    id: raw.id,
    name: raw.properties.dealname ?? "",
    amount: parseNumber(raw.properties.amount),
    mrr: parseNumber(raw.properties.hs_mrr),
    attribution: raw.properties.attribution ?? null,
    expectedDate: raw.properties.expected_closing_date ?? null,
    closeDate: raw.properties.closedate ?? null,
    operationDate: raw.properties.date_de_prise_en_compte ?? null,
    stage,
    probability: parseNumber(raw.properties.hs_deal_stage_probability),
    ownerId: raw.properties.hubspot_owner_id ?? null,
    status: isWon ? "won" : isLost ? "lost" : "open",
    type,
  }
}

// Get the forecast date for a deal (the date it's expected to close/renew)
function getForecastDate(deal: ForecastDeal): string | null {
  if (deal.type === "renewal") {
    return deal.operationDate?.slice(0, 10) ?? deal.closeDate?.slice(0, 10) ?? null
  }
  // Upsell: expected_closing_date, fallback to closedate
  if (deal.type === "upsell") {
    return deal.expectedDate?.slice(0, 10) ?? deal.closeDate?.slice(0, 10) ?? null
  }
  // Churn: operation date, fallback to closedate
  return deal.operationDate?.slice(0, 10) ?? deal.closeDate?.slice(0, 10) ?? null
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const mode = (searchParams.get("mode") ?? "month") as "month" | "quarter"
    const periodsCount = parseInt(searchParams.get("periods") ?? "6", 10)

    // Build period buckets (past + future)
    const now = new Date()
    const periods: { start: Date; end: Date; key: string; label: string }[] = []

    // 2 periods back + current + periodsCount-3 forward
    const pastPeriods = 2
    const futurePeriods = periodsCount - pastPeriods - 1

    for (let i = -pastPeriods; i <= futurePeriods; i++) {
      if (mode === "month") {
        const d = addMonths(now, i)
        const start = startOfMonth(d)
        const end = endOfMonth(d)
        periods.push({
          start, end,
          key: format(start, "yyyy-MM"),
          label: format(start, "MMM yy"),
        })
      } else {
        const d = addQuarters(now, i)
        const start = startOfQuarter(d)
        const end = endOfQuarter(d)
        const q = Math.ceil((start.getMonth() + 1) / 3)
        periods.push({
          start, end,
          key: `${format(start, "yyyy")}-Q${q}`,
          label: `Q${q} ${format(start, "yyyy")}`,
        })
      }
    }

    // Fetch all deals in parallel
    const [upsellRaw, churnRaw, renewalRaw] = await Promise.all([
      // Upsell deals with expected_closing_date OR in active stages
      hubspotSearch<HubSpotDeal>("deals", {
        filterGroups: [
          { filters: [{ propertyName: "attribution", operator: "EQ", value: ATTRIBUTION.UPSELL }] },
        ],
        properties: [...DEAL_PROPERTIES],
      }, "forecast_upsell"),
      // Churn + Downsell deals
      hubspotSearch<HubSpotDeal>("deals", {
        filterGroups: [
          { filters: [{ propertyName: "attribution", operator: "EQ", value: ATTRIBUTION.CHURN }] },
          { filters: [{ propertyName: "attribution", operator: "EQ", value: ATTRIBUTION.DOWNSELL }] },
        ],
        properties: [...DEAL_PROPERTIES],
      }, "forecast_churn"),
      // Renewal deals
      hubspotSearch<HubSpotDeal>("deals", {
        filterGroups: [
          { filters: [{ propertyName: "renewall_date", operator: "HAS_PROPERTY" }] },
        ],
        properties: [...DEAL_PROPERTIES],
      }, "forecast_renewal"),
    ])

    const upsellDeals = upsellRaw.map((r) => transformDeal(r, "upsell"))
    const churnDeals = churnRaw.map((r) => transformDeal(r, "churn"))
    const renewalDeals = renewalRaw.map((r) => transformDeal(r, "renewal"))

    // Enrich with company names
    const allRaw = [...upsellRaw, ...churnRaw, ...renewalRaw]
    const allDeals = [...upsellDeals, ...churnDeals, ...renewalDeals]
    // Best-effort company enrichment via the existing function
    const enriched = await enrichDealsWithCompanies(allDeals.map((d) => ({
      ...d,
      arr: 0, acv: 0, renewalDate: d.expectedDate, pipeline: "", createdAt: null, lastModified: null,
    })))
    for (let i = 0; i < allDeals.length && i < enriched.length; i++) {
      allDeals[i].companyName = enriched[i].companyName
      allDeals[i].companyId = enriched[i].companyId
    }

    // Helper: assign a deal to a period bucket
    const assignToPeriod = (deal: ForecastDeal): string | null => {
      const dateStr = getForecastDate(deal)
      if (!dateStr) return null

      if (mode === "month") {
        return dateStr.slice(0, 7) // "2026-04"
      } else {
        const d = new Date(dateStr)
        const q = Math.ceil((d.getMonth() + 1) / 3)
        return `${d.getFullYear()}-Q${q}`
      }
    }

    // Build global buckets
    const buildBuckets = (deals: { upsell: ForecastDeal[]; churn: ForecastDeal[]; renewal: ForecastDeal[] }): PeriodBucket[] => {
      return periods.map((period) => {
        const bucket: PeriodBucket = {
          key: period.key,
          label: period.label,
          upsell: { won: 0, open: 0, lost: 0, deals: [] },
          churn: { won: 0, open: 0, lost: 0, deals: [] },
          renewal: { won: 0, open: 0, lost: 0, deals: [] },
        }

        for (const deal of deals.upsell) {
          if (assignToPeriod(deal) === period.key) {
            bucket.upsell[deal.status === "won" ? "won" : deal.status === "lost" ? "lost" : "open"] += Math.abs(deal.amount)
            bucket.upsell.deals.push(deal)
          }
        }
        for (const deal of deals.churn) {
          if (assignToPeriod(deal) === period.key) {
            bucket.churn[deal.status === "won" ? "won" : deal.status === "lost" ? "lost" : "open"] += Math.abs(deal.amount)
            bucket.churn.deals.push(deal)
          }
        }
        for (const deal of deals.renewal) {
          if (assignToPeriod(deal) === period.key) {
            bucket.renewal[deal.status === "won" ? "won" : deal.status === "lost" ? "lost" : "open"] += Math.abs(deal.amount)
            bucket.renewal.deals.push(deal)
          }
        }

        return bucket
      })
    }

    const globalBuckets = buildBuckets({ upsell: upsellDeals, churn: churnDeals, renewal: renewalDeals })

    // Per-CSM forecast
    const csmForecasts: CsmForecast[] = ACTIVE_CSMS.map((csm) => ({
      csmId: csm.id,
      csmName: csm.name,
      color: csm.color,
      periods: buildBuckets({
        upsell: upsellDeals.filter((d) => d.ownerId === csm.id),
        churn: churnDeals.filter((d) => d.ownerId === csm.id),
        renewal: renewalDeals.filter((d) => d.ownerId === csm.id),
      }),
    }))

    // Chart data
    const chartData = globalBuckets.map((b) => ({
      label: b.label,
      upsellWon: b.upsell.won,
      upsellOpen: b.upsell.open,
      churnWon: b.churn.won,
      churnOpen: b.churn.open,
      renewalWon: b.renewal.won,
      renewalOpen: b.renewal.open,
      upsellCount: b.upsell.deals.length,
      churnCount: b.churn.deals.length,
      renewalCount: b.renewal.deals.length,
    }))

    return NextResponse.json({
      global: globalBuckets,
      perCsm: csmForecasts,
      chartData,
      periods: periods.map((p) => ({ key: p.key, label: p.label })),
      totals: {
        upsell: upsellDeals.length,
        churn: churnDeals.length,
        renewal: renewalDeals.length,
      },
    })
  } catch (error) {
    console.error("Forecast API error:", error)
    return NextResponse.json(
      { error: "Failed to compute forecast", details: String(error) },
      { status: 500 }
    )
  }
}
