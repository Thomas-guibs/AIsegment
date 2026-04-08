import { hubspotSearch } from "./client"
import type { HubSpotCompany, Company } from "../types"
import { COMPANY_PROPERTIES, CSM_TEAM_IDS } from "../constants"
import { parseNumber } from "../utils"

function transformCompany(raw: HubSpotCompany): Company {
  return {
    id: raw.id,
    name: raw.properties.name ?? "",
    mrr: parseNumber(raw.properties.mrr),
    plan: raw.properties.plan ?? null,
    ownerId: raw.properties.hubspot_owner_id ?? null,
    lifecycleStage: raw.properties.lifecyclestage ?? null,
    numDeals: parseNumber(raw.properties.num_associated_deals),
  }
}

// Fetch all customer companies managed by CSM team
export async function fetchCustomerCompanies(ownerId?: string): Promise<Company[]> {
  const ownerFilter = ownerId
    ? [{ propertyName: "hubspot_owner_id", operator: "EQ" as const, value: ownerId }]
    : CSM_TEAM_IDS.map((id) => ({
        propertyName: "hubspot_owner_id",
        operator: "EQ" as const,
        value: id,
      }))

  // If filtering by all CSMs, we need separate filter groups (OR logic)
  const filterGroups = ownerId
    ? [
        {
          filters: [
            { propertyName: "lifecyclestage", operator: "EQ" as const, value: "customer" },
            { propertyName: "hubspot_owner_id", operator: "EQ" as const, value: ownerId },
          ],
        },
      ]
    : CSM_TEAM_IDS.map((id) => ({
        filters: [
          { propertyName: "lifecyclestage", operator: "EQ" as const, value: "customer" },
          { propertyName: "hubspot_owner_id", operator: "EQ" as const, value: id },
        ],
      }))

  const cacheKey = `customer_companies_${ownerId ?? "all"}`
  const raw = await hubspotSearch<HubSpotCompany>("companies", {
    filterGroups,
    properties: [...COMPANY_PROPERTIES],
    sorts: [{ propertyName: "mrr", direction: "DESCENDING" }],
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
