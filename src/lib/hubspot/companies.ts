import { hubspotSearch, hubspotFetch } from "./client"
import type { HubSpotCompany, Company } from "../types"
import { COMPANY_PROPERTIES, ACTIVE_CUSTOMER_STAGES } from "../constants"
import { parseNumber } from "../utils"

function transformCompany(raw: HubSpotCompany): Company {
  const csmOwner = raw.properties.proprietaire_de_l_entreprise__csm_
  return {
    id: raw.id,
    name: raw.properties.name ?? "",
    domain: raw.properties.domain ?? null,
    mrr: parseNumber(raw.properties.total_revenue),
    plan: raw.properties.plan ?? null,
    revenueTier: raw.properties.client_revenue_tiers ?? null,
    ownerId: csmOwner ?? raw.properties.hubspot_owner_id ?? null,
    lifecycleStage: raw.properties.lifecyclestage ?? null,
    customerStage: raw.properties.phase_du_client ?? null,
    numDeals: parseNumber(raw.properties.num_associated_deals),
    // Product data
    revenueLoyalty: parseNumber(raw.properties.revenue_loyalty),
    revenueReferral: parseNumber(raw.properties.revenue_referral),
    roi: parseNumber(raw.properties.roi),
    totalMissions: parseNumber(raw.properties.total_missions),
    totalOrders: parseNumber(raw.properties.total_orders),
    scoreLoyalty: parseNumber(raw.properties.score_loyalty),
    scoreReferral: parseNumber(raw.properties.score_referral),
    participationRate: parseNumber(raw.properties.participation_rate__loyalty_),
    rewardsConversionRate: parseNumber(raw.properties.rewards_conversion_rate__loyalty_),
    pointsUsageRate: parseNumber(raw.properties.points_usage_rate__loyalty_),
    referralConversionRate: parseNumber(raw.properties.referral_conversion_rate),
    newClientsRateReferral: parseNumber(raw.properties.new_clients_rate__referral_),
    totalAskedReferral: parseNumber(raw.properties.total_asked_referral),
    // CSM metadata
    isStrategic: raw.properties.compte_strategique === "true",
    accompagnement: raw.properties.cs_accompagnement ?? null,
    reasonChurn: raw.properties.reason_churn ?? null,
    customerSituation: raw.properties.customers_situation ?? null,
    upsellSignals: null, // populated via enrichment API, not from HubSpot
  }
}

// Fetch active customer companies
export async function fetchCustomerCompanies(ownerId?: string): Promise<Company[]> {
  const filterGroups = [
    {
      filters: [
        { propertyName: "phase_du_client", operator: "IN" as const, values: [...ACTIVE_CUSTOMER_STAGES] },
        ...(ownerId
          ? [{ propertyName: "proprietaire_de_l_entreprise__csm_", operator: "EQ" as const, value: ownerId }]
          : []
        ),
      ],
    },
  ]

  const cacheKey = `customer_companies_${ownerId ?? "all"}`
  const raw = await hubspotSearch<HubSpotCompany>("companies", {
    filterGroups,
    properties: [...COMPANY_PROPERTIES],
  }, cacheKey)

  return raw.map(transformCompany)
}

// Fetch a single company by ID with all properties
export async function fetchCompanyById(companyId: string): Promise<Company | null> {
  try {
    const raw = await hubspotFetch<HubSpotCompany>(
      `/crm/v3/objects/companies/${companyId}`,
      { params: { properties: [...COMPANY_PROPERTIES].join(",") } }
    )
    return transformCompany(raw)
  } catch {
    return null
  }
}

// Get associated deals for a company
export async function fetchCompanyDeals(companyId: string): Promise<string[]> {
  try {
    const response = await hubspotFetch<{
      results: Array<{ toObjectId: string }>
    }>(`/crm/v4/objects/companies/${companyId}/associations/deals`)
    return response.results.map((r) => r.toObjectId)
  } catch {
    return []
  }
}

// Get total MRR for customer companies
export async function getTotalCustomerMrr(ownerId?: string): Promise<number> {
  const companies = await fetchCustomerCompanies(ownerId)
  return companies.reduce((sum, c) => sum + c.mrr, 0)
}

// Get company count
export async function getCustomerCount(ownerId?: string): Promise<number> {
  const companies = await fetchCustomerCompanies(ownerId)
  return companies.length
}
