import { hubspotSearch } from "./client"
import type { HubSpotEngagement, Engagement } from "../types"

const ENGAGEMENT_PROPERTIES = [
  "hs_engagement_type",
  "hs_timestamp",
  "hubspot_owner_id",
  "hs_body_preview",
]

function transformEngagement(raw: HubSpotEngagement): Engagement {
  return {
    id: raw.id,
    type: raw.properties.hs_engagement_type ?? "UNKNOWN",
    timestamp: raw.properties.hs_timestamp ?? "",
    ownerId: raw.properties.hubspot_owner_id ?? null,
    preview: raw.properties.hs_body_preview ?? null,
  }
}

// Fetch engagements (calls, emails, meetings) for a time range
export async function fetchEngagements(
  dateFrom: string,
  dateTo: string,
  ownerId?: string
): Promise<Engagement[]> {
  const types = ["CALL", "EMAIL", "MEETING"]

  const filterGroups = types.map((type) => ({
    filters: [
      { propertyName: "hs_engagement_type", operator: "EQ" as const, value: type },
      { propertyName: "hs_timestamp", operator: "GTE" as const, value: dateFrom },
      { propertyName: "hs_timestamp", operator: "LTE" as const, value: dateTo },
      ...(ownerId
        ? [{ propertyName: "hubspot_owner_id", operator: "EQ" as const, value: ownerId }]
        : []),
    ],
  }))

  const cacheKey = `engagements_${dateFrom}_${dateTo}_${ownerId ?? "all"}`

  try {
    const raw = await hubspotSearch<HubSpotEngagement>("engagements", {
      filterGroups,
      properties: ENGAGEMENT_PROPERTIES,
      sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
    }, cacheKey)

    return raw.map(transformEngagement)
  } catch {
    // Engagements API may not be available with all scopes
    return []
  }
}

// Count engagements by owner
export async function countEngagementsByOwner(
  dateFrom: string,
  dateTo: string
): Promise<Record<string, number>> {
  const engagements = await fetchEngagements(dateFrom, dateTo)
  const counts: Record<string, number> = {}

  for (const e of engagements) {
    if (e.ownerId) {
      counts[e.ownerId] = (counts[e.ownerId] ?? 0) + 1
    }
  }

  return counts
}
