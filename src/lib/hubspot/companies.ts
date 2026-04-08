import { hubspotSearch } from "./client"
import type { HubSpotCompany, Company } from "../types"
import { COMPANY_PROPERTIES, CSM_TEAM_IDS } from "../constants"
import { parseNumber } from "../utils"

function transformCompany(raw: HubSpotCompany): Company {
  // Use mrr_csm (CSM-managed MRR) as the primary MRR field.
  // Fall back to mrr_total, then mrr if mrr_csm is not set.
  const mrr =
    parseNumber(raw.properties.mrr_csm) ||
    parseNumber(raw.properties.mrr_total) ||
    parseNumber(raw.properties.mrr)
  return {
    id: raw.id,
    name: raw.properties.name ?? "",
    mrr,
    plan: raw.properties.plan ?? null,
    ownerId: raw.properties.hubspot_owner_id ?? null,
    lifecycleStage: raw.properties.lifecyclestage ?? null,
    numDeals: parseNumber(raw.properties.num_associated_deals),
  }
}

// Fetch all customer companies managed by CSM team
// Uses IN operator to stay within HubSpot's 5 filter group limit
export async function fetchCustomerCompanies(ownerId?: string): Promise<Company[]> {
  const filterGroups = [
    {
      filters: [
        { propertyName: "lifecyclestage", operator: "EQ" as const, value: "customer" },
        ...(ownerId
          ? [{ propertyName: "hubspot_owner_id", operator: "EQ" as const, value: ownerId }]
          : [{ propertyName: "hubspot_owner_id", operator: "IN" as const, values: CSM_TEAM_IDS }]
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
