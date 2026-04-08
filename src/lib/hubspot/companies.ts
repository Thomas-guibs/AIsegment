import { hubspotSearch } from "./client"
import type { HubSpotCompany, Company } from "../types"
import { COMPANY_PROPERTIES, CSM_TEAM_IDS, ACTIVE_CUSTOMER_STAGES } from "../constants"
import { parseNumber } from "../utils"

function transformCompany(raw: HubSpotCompany): Company {
  return {
    id: raw.id,
    name: raw.properties.name ?? "",
    mrr: parseNumber(raw.properties.total_revenue),
    plan: raw.properties.plan ?? null,
    ownerId: raw.properties.hubspot_owner_id ?? null,
    lifecycleStage: raw.properties.lifecyclestage ?? null,
    customerStage: raw.properties.phase_du_client ?? null,
    numDeals: parseNumber(raw.properties.num_associated_deals),
  }
}

// Fetch active customer companies managed by CSM team.
// Filter: phase_du_client IN [Signed, Engaged, Onboarding, Activated, Run]
//         AND hubspot_owner_id IN CSM_TEAM
export async function fetchCustomerCompanies(ownerId?: string): Promise<Company[]> {
  const filterGroups = [
    {
      filters: [
        { propertyName: "phase_du_client", operator: "IN" as const, values: [...ACTIVE_CUSTOMER_STAGES] },
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
