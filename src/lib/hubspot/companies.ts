import { hubspotSearch } from "./client"
import type { HubSpotCompany, Company } from "../types"
import { COMPANY_PROPERTIES, CSM_TEAM_IDS, ACTIVE_CUSTOMER_STAGES } from "../constants"
import { parseNumber } from "../utils"

function transformCompany(raw: HubSpotCompany): Company {
  // CSM owner = proprietaire_de_l_entreprise__csm_ (dedicated CSM field)
  // Falls back to hubspot_owner_id if CSM field is not set
  const csmOwner = raw.properties.proprietaire_de_l_entreprise__csm_
  return {
    id: raw.id,
    name: raw.properties.name ?? "",
    mrr: parseNumber(raw.properties.total_revenue),
    plan: raw.properties.plan ?? null,
    ownerId: csmOwner ?? raw.properties.hubspot_owner_id ?? null,
    lifecycleStage: raw.properties.lifecyclestage ?? null,
    customerStage: raw.properties.phase_du_client ?? null,
    numDeals: parseNumber(raw.properties.num_associated_deals),
  }
}

// Fetch active customer companies.
// Filter: phase_du_client IN [Signed, Engaged, Onboarding, Activated, Run]
// When ownerId is provided, filter by proprietaire_de_l_entreprise__csm_ (CSM owner).
// When no ownerId, fetch ALL active companies for total MRR.
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
