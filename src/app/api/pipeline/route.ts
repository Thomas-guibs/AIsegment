export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { hubspotSearch } from "@/lib/hubspot/client"
import { enrichDealsWithCompanies } from "@/lib/hubspot/deals"
import type { HubSpotDeal, Deal } from "@/lib/types"
import {
  DEAL_PROPERTIES,
  SALES_STAGES,
  SALES_STAGE_LABELS,
  CSM_TEAM,
  ATTRIBUTION,
} from "@/lib/constants"
import { parseNumber, parseDate } from "@/lib/utils"

// Sales pipeline stages in order (the "pipe")
const PIPE_STAGES = [
  { id: SALES_STAGES.DISCOVERY_CALL, label: "Discovery call", order: 1 },
  { id: SALES_STAGES.QUALIFIED_30, label: "Qualified (30%)", order: 2 },
  { id: SALES_STAGES.EVALUATE_50, label: "Evaluate (50%)", order: 3 },
  { id: SALES_STAGES.OFFRE_ENVOYEE_70, label: "Offre envoyee (70%)", order: 4 },
  { id: SALES_STAGES.GO_VERBAL_80, label: "Go verbal (80%)", order: 5 },
  { id: SALES_STAGES.CLOSED_WON, label: "Closed Won", order: 6 },
  { id: SALES_STAGES.PAIEMENT_RECU, label: "Paiement recu", order: 7 },
]

// Closed stages (for reference, not in the active pipe)
const WON_STAGES = [SALES_STAGES.CLOSED_WON, SALES_STAGES.PAIEMENT_RECU]
const LOST_STAGES = [SALES_STAGES.CLOSED_LOST, SALES_STAGES.CHURN_DOWNSELL]

// Active CSMs (exclude Antoine Rivaud & Thomas Prouveur)
const ACTIVE_CSMS = CSM_TEAM.filter(
  (c) => c.id !== "1949410186" && c.id !== "44919918"
)

function transformDeal(raw: HubSpotDeal): Deal {
  return {
    id: raw.id,
    name: raw.properties.dealname ?? "",
    amount: parseNumber(raw.properties.amount),
    mrr: parseNumber(raw.properties.hs_mrr),
    arr: parseNumber(raw.properties.hs_arr),
    acv: parseNumber(raw.properties.hs_acv),
    attribution: raw.properties.attribution ?? null,
    renewalDate: parseDate(raw.properties.renewall_date),
    operationDate: parseDate(raw.properties.date_de_prise_en_compte),
    closeDate: parseDate(raw.properties.closedate),
    stage: raw.properties.dealstage ?? "",
    pipeline: raw.properties.pipeline ?? "",
    ownerId: raw.properties.hubspot_owner_id ?? null,
    createdAt: parseDate(raw.properties.createdate),
    lastModified: parseDate(raw.properties.hs_lastmodifieddate),
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const csmId = searchParams.get("csmId") ?? undefined

    // Active pipe stage IDs
    const activePipeStageIds = PIPE_STAGES.map((s) => s.id)

    // Fetch renewal deals (have renewall_date) + upsell deals (attribution=Upsell)
    // that are in active pipeline stages
    const [renewalRaw, upsellRaw] = await Promise.all([
      hubspotSearch<HubSpotDeal>("deals", {
        filterGroups: [
          {
            filters: [
              { propertyName: "renewall_date", operator: "HAS_PROPERTY" },
              { propertyName: "dealstage", operator: "IN", values: activePipeStageIds },
              ...(csmId ? [{ propertyName: "hubspot_owner_id", operator: "EQ" as const, value: csmId }] : []),
            ],
          },
        ],
        properties: [...DEAL_PROPERTIES],
      }, `pipeline_renewals_${csmId ?? "all"}`),
      hubspotSearch<HubSpotDeal>("deals", {
        filterGroups: [
          {
            filters: [
              { propertyName: "attribution", operator: "EQ", value: ATTRIBUTION.UPSELL },
              { propertyName: "dealstage", operator: "IN", values: activePipeStageIds },
              ...(csmId ? [{ propertyName: "hubspot_owner_id", operator: "EQ" as const, value: csmId }] : []),
            ],
          },
        ],
        properties: [...DEAL_PROPERTIES],
      }, `pipeline_upsells_${csmId ?? "all"}`),
    ])

    // Deduplicate (a deal can be both renewal + upsell)
    const allDealsMap = new Map<string, Deal>()
    for (const raw of [...renewalRaw, ...upsellRaw]) {
      if (!allDealsMap.has(raw.id)) {
        allDealsMap.set(raw.id, transformDeal(raw))
      }
    }
    let allDeals = Array.from(allDealsMap.values())

    // Tag each deal as Renewal, Upsell, or both
    const renewalIds = new Set(renewalRaw.map((r) => r.id))
    const upsellIds = new Set(upsellRaw.map((r) => r.id))

    // Enrich with company names
    allDeals = await enrichDealsWithCompanies(allDeals)

    // Build per-CSM pipeline
    const csmPipelines = ACTIVE_CSMS.map((csm) => {
      const csmDeals = allDeals.filter((d) => d.ownerId === csm.id)

      const stages = PIPE_STAGES.map((stage) => {
        const stageDeals = csmDeals
          .filter((d) => d.stage === stage.id)
          .map((d) => ({
            ...d,
            dealType: renewalIds.has(d.id)
              ? (upsellIds.has(d.id) ? "renewal+upsell" : "renewal")
              : "upsell",
          }))
          .sort((a, b) => b.amount - a.amount)

        return {
          stageId: stage.id,
          stageLabel: stage.label,
          order: stage.order,
          deals: stageDeals,
          totalAmount: stageDeals.reduce((sum, d) => sum + d.amount, 0),
          totalMrr: stageDeals.reduce((sum, d) => sum + d.mrr, 0),
          count: stageDeals.length,
        }
      })

      const totalDeals = csmDeals.length
      const totalAmount = csmDeals.reduce((sum, d) => sum + d.amount, 0)
      const totalMrr = csmDeals.reduce((sum, d) => sum + d.mrr, 0)

      return {
        csmId: csm.id,
        csmName: csm.name,
        initials: csm.initials,
        color: csm.color,
        stages,
        totalDeals,
        totalAmount,
        totalMrr,
      }
    })

    // Global summary by stage
    const globalStages = PIPE_STAGES.map((stage) => {
      const stageDeals = allDeals.filter((d) => d.stage === stage.id)
      return {
        stageId: stage.id,
        stageLabel: stage.label,
        count: stageDeals.length,
        totalAmount: stageDeals.reduce((sum, d) => sum + d.amount, 0),
        totalMrr: stageDeals.reduce((sum, d) => sum + d.mrr, 0),
      }
    })

    return NextResponse.json({
      csmPipelines,
      globalStages,
      totalDeals: allDeals.length,
      totalAmount: allDeals.reduce((sum, d) => sum + d.amount, 0),
    })
  } catch (error) {
    console.error("Pipeline API error:", error)
    return NextResponse.json(
      { error: "Failed to fetch pipeline", details: String(error) },
      { status: 500 }
    )
  }
}
