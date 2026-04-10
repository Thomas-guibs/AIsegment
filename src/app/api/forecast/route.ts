export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { hubspotSearch } from "@/lib/hubspot/client"
import type { HubSpotDeal } from "@/lib/types"
import { DEAL_PROPERTIES, ATTRIBUTION, CSM_TEAM, SALES_STAGES } from "@/lib/constants"
import { parseNumber } from "@/lib/utils"
import { startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, addMonths, addQuarters, format } from "date-fns"

const WON_STAGES: string[] = [SALES_STAGES.CLOSED_WON, SALES_STAGES.PAIEMENT_RECU]
const LOST_STAGES: string[] = [SALES_STAGES.CLOSED_LOST, SALES_STAGES.CHURN_DOWNSELL]

const ACTIVE_CSMS = CSM_TEAM.filter(
  (c) => c.id !== "1949410186" && c.id !== "44919918"
)

interface ForecastDeal {
  id: string
  name: string
  amount: number
  mrr: number
  attribution: string | null
  expectedDate: string | null
  closeDate: string | null
  operationDate: string | null
  renewalDate: string | null
  stage: string
  probability: number
  ownerId: string | null
  status: "won" | "open" | "lost"
  type: "upsell" | "churn" | "renewal"
}

interface PeriodBucket {
  key: string
  label: string
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

const transformDeal = (raw: HubSpotDeal, type: ForecastDeal["type"]): ForecastDeal => {
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
    renewalDate: raw.properties.renewall_date ?? null,
    stage,
    probability: parseNumber(raw.properties.hs_deal_stage_probability),
    ownerId: raw.properties.hubspot_owner_id ?? null,
    status: isWon ? "won" : isLost ? "lost" : "open",
    type,
  }
}

const getForecastDate = (deal: ForecastDeal): string | null => {
  if (deal.type === "renewal") {
    return deal.renewalDate?.slice(0, 10) ?? deal.operationDate?.slice(0, 10) ?? deal.closeDate?.slice(0, 10) ?? null
  }
  if (deal.type === "upsell") {
    return deal.expectedDate?.slice(0, 10) ?? deal.closeDate?.slice(0, 10) ?? null
  }
  return deal.operationDate?.slice(0, 10) ?? deal.closeDate?.slice(0, 10) ?? null
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const mode = (searchParams.get("mode") ?? "quarter") as "month" | "quarter"
    const periodsCount = parseInt(searchParams.get("periods") ?? "8", 10)

    const now = new Date()
    const periods: { start: Date; end: Date; key: string; label: string }[] = []
    const pastPeriods = 2

    for (let i = -pastPeriods; i < periodsCount - pastPeriods; i++) {
      if (mode === "month") {
        const d = addMonths(now, i)
        const start = startOfMonth(d)
        const end = endOfMonth(d)
        periods.push({ start, end, key: format(start, "yyyy-MM"), label: format(start, "MMM yy") })
      } else {
        const d = addQuarters(now, i)
        const start = startOfQuarter(d)
        const end = endOfQuarter(d)
        const q = Math.ceil((start.getMonth() + 1) / 3)
        periods.push({ start, end, key: `${format(start, "yyyy")}-Q${q}`, label: `Q${q} ${format(start, "yyyy")}` })
      }
    }

    // Fetch all deals in parallel — no company enrichment to stay within timeout
    const [upsellRaw, churnRaw, renewalRaw] = await Promise.all([
      hubspotSearch<HubSpotDeal>("deals", {
        filterGroups: [
          { filters: [{ propertyName: "attribution", operator: "EQ", value: ATTRIBUTION.UPSELL }] },
        ],
        properties: [...DEAL_PROPERTIES],
      }, "forecast_upsell"),
      hubspotSearch<HubSpotDeal>("deals", {
        filterGroups: [
          { filters: [{ propertyName: "attribution", operator: "EQ", value: ATTRIBUTION.CHURN }] },
          { filters: [{ propertyName: "attribution", operator: "EQ", value: ATTRIBUTION.DOWNSELL }] },
        ],
        properties: [...DEAL_PROPERTIES],
      }, "forecast_churn"),
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

    // Assign to period
    const assignToPeriod = (deal: ForecastDeal): string | null => {
      const dateStr = getForecastDate(deal)
      if (!dateStr) return null
      if (mode === "month") return dateStr.slice(0, 7)
      const d = new Date(dateStr)
      const q = Math.ceil((d.getMonth() + 1) / 3)
      return `${d.getFullYear()}-Q${q}`
    }

    // Build buckets
    const buildBuckets = (upsell: ForecastDeal[], churn: ForecastDeal[], renewal: ForecastDeal[]): PeriodBucket[] => {
      return periods.map((period) => {
        const bucket: PeriodBucket = {
          key: period.key,
          label: period.label,
          upsell: { won: 0, open: 0, lost: 0, deals: [] },
          churn: { won: 0, open: 0, lost: 0, deals: [] },
          renewal: { won: 0, open: 0, lost: 0, deals: [] },
        }

        for (const deal of upsell) {
          if (assignToPeriod(deal) === period.key) {
            bucket.upsell[deal.status] += Math.abs(deal.amount)
            bucket.upsell.deals.push(deal)
          }
        }
        for (const deal of churn) {
          if (assignToPeriod(deal) === period.key) {
            bucket.churn[deal.status] += Math.abs(deal.amount)
            bucket.churn.deals.push(deal)
          }
        }
        for (const deal of renewal) {
          if (assignToPeriod(deal) === period.key) {
            bucket.renewal[deal.status] += Math.abs(deal.amount)
            bucket.renewal.deals.push(deal)
          }
        }

        return bucket
      })
    }

    const globalBuckets = buildBuckets(upsellDeals, churnDeals, renewalDeals)

    const csmForecasts: CsmForecast[] = ACTIVE_CSMS.map((csm) => ({
      csmId: csm.id,
      csmName: csm.name,
      color: csm.color,
      periods: buildBuckets(
        upsellDeals.filter((d) => d.ownerId === csm.id),
        churnDeals.filter((d) => d.ownerId === csm.id),
        renewalDeals.filter((d) => d.ownerId === csm.id),
      ),
    }))

    const chartData = globalBuckets.map((b) => ({
      label: b.label,
      upsellWon: b.upsell.won,
      upsellOpen: b.upsell.open,
      churnWon: b.churn.won,
      churnOpen: b.churn.open,
      renewalWon: b.renewal.won,
      renewalOpen: b.renewal.open,
    }))

    return NextResponse.json({
      global: globalBuckets,
      perCsm: csmForecasts,
      chartData,
      periods: periods.map((p) => ({ key: p.key, label: p.label })),
      totals: { upsell: upsellDeals.length, churn: churnDeals.length, renewal: renewalDeals.length },
    })
  } catch (error) {
    console.error("Forecast API error:", error)
    return NextResponse.json(
      { error: "Failed to compute forecast", details: String(error) },
      { status: 500 }
    )
  }
}
