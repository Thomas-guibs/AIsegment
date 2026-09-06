import { hubspotSearch, hubspotFetch, type SearchFilterGroup } from "./client"
import type { HubSpotDeal, Deal } from "../types"
import { PIPELINES, DEAL_PROPERTIES, CSM_TEAM_IDS, ATTRIBUTION, SALES_STAGES } from "../constants"
import { parseNumber, parseDate } from "../utils"
import { format } from "date-fns"

// Transform HubSpot deal to app Deal
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
    renewalStrategy: raw.properties.renewall_strategy ?? null,
    operationDate: parseDate(raw.properties.date_de_prise_en_compte),
    paymentDate: parseDate(raw.properties.date_de_paiement),
    closeDate: parseDate(raw.properties.closedate),
    stage: raw.properties.dealstage ?? "",
    pipeline: raw.properties.pipeline ?? "",
    ownerId: raw.properties.hubspot_owner_id ?? null,
    createdAt: parseDate(raw.properties.createdate),
    lastModified: parseDate(raw.properties.hs_lastmodifieddate),
    companyId: raw.associations?.companies?.results?.[0]?.id,
  }
}

// Fetch CSM-relevant deals from the Sales pipeline.
// Uses attribution IN [...] to stay within HubSpot's filter group limits.
export async function fetchCustomerDeals(ownerId?: string): Promise<Deal[]> {
  const filters: SearchFilterGroup[] = [
    {
      filters: [
        { propertyName: "pipeline", operator: "EQ", value: PIPELINES.SALES },
        { propertyName: "attribution", operator: "HAS_PROPERTY" },
        ...(ownerId ? [{ propertyName: "hubspot_owner_id", operator: "EQ" as const, value: ownerId }] : []),
      ],
    },
    {
      filters: [
        { propertyName: "pipeline", operator: "EQ", value: PIPELINES.SALES },
        { propertyName: "renewall_date", operator: "HAS_PROPERTY" },
        ...(ownerId ? [{ propertyName: "hubspot_owner_id", operator: "EQ" as const, value: ownerId }] : []),
      ],
    },
  ]

  const cacheKey = `customer_deals_${ownerId ?? "all"}`
  const raw = await hubspotSearch<HubSpotDeal>("deals", {
    filterGroups: filters,
    properties: [...DEAL_PROPERTIES],
    sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
  }, cacheKey)

  return raw.map(transformDeal)
}

// Fetch deals by attribution (Upsell, Churn, Downsell) within a date range.
export async function fetchAttributionDeals(
  attributions: string[],
  dateFrom: string,
  dateTo: string,
  ownerId?: string
): Promise<Deal[]> {
  const filters: SearchFilterGroup[] = [
    {
      filters: [
        { propertyName: "attribution", operator: "IN", values: attributions },
        ...(ownerId ? [{ propertyName: "hubspot_owner_id", operator: "EQ" as const, value: ownerId }] : []),
      ],
    },
  ]

  const cacheKey = `attribution_deals_${attributions.join("_")}_${ownerId ?? "all"}`
  const raw = await hubspotSearch<HubSpotDeal>("deals", {
    filterGroups: filters,
    properties: [...DEAL_PROPERTIES],
    sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
  }, cacheKey)

  const deals = raw.map(transformDeal)

  // Client-side date filtering
  return deals.filter((d) => {
    const opDate = d.operationDate ?? d.closeDate ?? d.createdAt
    if (!opDate) return false
    const date = opDate.slice(0, 10) // YYYY-MM-DD
    return date >= dateFrom && date <= dateTo
  })
}

// Fetch CSM-relevant deals (Upsell + Churn + Downsell) within a date range
export async function fetchCsmMovements(dateFrom: string, dateTo: string, ownerId?: string): Promise<Deal[]> {
  return fetchAttributionDeals(
    [ATTRIBUTION.UPSELL, ATTRIBUTION.CHURN, ATTRIBUTION.DOWNSELL],
    dateFrom,
    dateTo,
    ownerId
  )
}

// Fetch every deal in stage « Paiement reçu » (any attribution) — the source
// of truth for MRR sous gestion: Σ signed amount per « Client » company.
export async function fetchPaidDeals(): Promise<Deal[]> {
  const filters: SearchFilterGroup[] = [
    {
      filters: [
        { propertyName: "pipeline", operator: "EQ", value: PIPELINES.SALES },
        { propertyName: "dealstage", operator: "EQ", value: SALES_STAGES.PAIEMENT_RECU },
      ],
    },
  ]
  const raw = await hubspotSearch<HubSpotDeal>("deals", {
    filterGroups: filters,
    properties: [...DEAL_PROPERTIES],
    sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
  }, "paid_deals_all")
  return raw.map(transformDeal)
}

// Fetch deals with renewals in a date range.
export async function fetchRenewalDeals(dateFrom: string, dateTo: string, ownerId?: string): Promise<Deal[]> {
  const filters: SearchFilterGroup[] = [
    {
      filters: [
        { propertyName: "renewall_date", operator: "HAS_PROPERTY" },
        ...(ownerId ? [{ propertyName: "hubspot_owner_id", operator: "EQ" as const, value: ownerId }] : []),
      ],
    },
  ]

  const cacheKey = `renewal_deals_${ownerId ?? "all"}`
  const raw = await hubspotSearch<HubSpotDeal>("deals", {
    filterGroups: filters,
    properties: [...DEAL_PROPERTIES],
    sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
  }, cacheKey)

  const deals = raw.map(transformDeal)

  return deals
    .filter((d) => {
      if (!d.renewalDate) return false
      const date = d.renewalDate.slice(0, 10)
      return date >= dateFrom && date <= dateTo
    })
    .sort((a, b) => (a.renewalDate ?? "").localeCompare(b.renewalDate ?? ""))
}

// Fetch deals created this week with specific attribution
export async function fetchNewDealsThisWeek(attribution: string): Promise<Deal[]> {
  const now = new Date()
  const startOfWeek = new Date(now)
  startOfWeek.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1))
  startOfWeek.setHours(0, 0, 0, 0)

  const filters: SearchFilterGroup[] = [
    {
      filters: [
        { propertyName: "attribution", operator: "EQ", value: attribution },
        { propertyName: "createdate", operator: "GTE", value: startOfWeek.getTime().toString() },
      ],
    },
  ]

  const cacheKey = `new_deals_week_${attribution}`
  const raw = await hubspotSearch<HubSpotDeal>("deals", {
    filterGroups: filters,
    properties: [...DEAL_PROPERTIES],
    sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
  }, cacheKey)

  return raw.map(transformDeal)
}

// Get company names, tiers and countries for a list of deal IDs (via associations)
export async function enrichDealsWithCompanies(deals: Deal[]): Promise<Deal[]> {
  if (deals.length === 0) return deals

  const dealIds = deals.map((d) => d.id)
  const batchSize = 100

  for (let i = 0; i < dealIds.length; i += batchSize) {
    const batch = dealIds.slice(i, i + batchSize)
    try {
      // v4 associations API returns ids as NUMBERS (from.id and toObjectId).
      // Every downstream map (companyMeta, historyMap, dealsByCompany) is
      // keyed by string ids from v3 endpoints — normalize with String() or
      // no lookup ever matches and every deal silently loses its company.
      const response = await hubspotFetch<{
        results: Array<{
          from: { id: string | number }
          to: Array<{ toObjectId: string | number }>
        }>
      }>("/crm/v4/associations/deals/companies/batch/read", {
        method: "POST",
        body: { inputs: batch.map((id) => ({ id })) },
      })

      const companyIds = new Set<string>()
      const dealToCompany = new Map<string, string>()

      for (const result of response.results) {
        if (result.to?.[0]) {
          const companyId = String(result.to[0].toObjectId)
          dealToCompany.set(String(result.from.id), companyId)
          companyIds.add(companyId)
        }
      }

      if (companyIds.size > 0) {
        const companiesResponse = await hubspotFetch<{
          results: Array<{ id: string; properties: { name: string; client_revenue_tiers?: string; code_pays_region?: string } }>
        }>("/crm/v3/objects/companies/batch/read", {
          method: "POST",
          body: {
            inputs: Array.from(companyIds).map((id) => ({ id })),
            properties: ["name", "client_revenue_tiers", "code_pays_region"],
          },
        })

        const companyNames = new Map<string, string>()
        const companyTiers = new Map<string, string>()
        const companyCountries = new Map<string, string>()
        for (const company of companiesResponse.results) {
          const cid = String(company.id)
          companyNames.set(cid, company.properties.name)
          if (company.properties.client_revenue_tiers) {
            companyTiers.set(cid, company.properties.client_revenue_tiers)
          }
          if (company.properties.code_pays_region) {
            companyCountries.set(cid, company.properties.code_pays_region)
          }
        }

        for (const deal of deals) {
          const companyId = dealToCompany.get(deal.id)
          if (companyId) {
            deal.companyId = companyId
            deal.companyName = companyNames.get(companyId) ?? undefined
            deal.companyRevenueTier = companyTiers.get(companyId) ?? undefined
            deal.companyCountry = companyCountries.get(companyId) ?? undefined
          }
        }
      }
    } catch (err) {
      // Best effort — continue without company data, but never silently:
      // a failed association read empties every tier/country breakdown.
      console.error("enrichDealsWithCompanies: association batch failed", err)
    }
  }

  return deals
}
