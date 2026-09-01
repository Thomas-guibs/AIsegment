// =============================================================================
// Point-in-time property reading — HubSpot property history
//
// Spec §2 warnings applied:
//   - HubSpot returns history NEWEST → OLDEST. We re-sort ASCENDING here so
//     valueAt() reads left-to-right and returns the last value at or before T.
//   - History can be truncated: if it doesn't reach T, valueAt() returns
//     undefined (the caller must decide whether to skip or backfill).
// =============================================================================

import { hubspotFetch } from "./client"
import { getCached, setCache } from "../cache"

export interface HistoryEntry<V> {
  timestamp: string // ISO 8601
  value: V
}

export interface CompanyHistory {
  id: string
  name: string
  domain: string | null
  mrr: HistoryEntry<number>[]        // sorted ASC
  csm: HistoryEntry<string | null>[]  // sorted ASC
  phase: HistoryEntry<string | null>[] // sorted ASC
}

// Returns the value where the last timestamp ≤ t. History MUST be sorted ASC.
export function valueAt<V>(history: HistoryEntry<V>[], t: string): V | undefined {
  let result: V | undefined
  for (const entry of history) {
    if (entry.timestamp <= t) result = entry.value
    else break // sorted ASC, no need to look further
  }
  return result
}

interface HubSpotPropertyHistoryItem {
  value: string | null
  timestamp: string
  sourceType?: string
}

interface HubSpotBatchReadResult {
  results: Array<{
    id: string
    properties: Record<string, string | null>
    propertiesWithHistory?: Record<string, HubSpotPropertyHistoryItem[]>
  }>
}

const HISTORY_PROPERTIES = [
  "total_revenue",
  "proprietaire_de_l_entreprise__csm_",
  "phase_du_client",
] as const

// Fetch company property history by IDs.
export async function fetchCompanyHistoryBatch(
  companyIds: string[]
): Promise<Map<string, CompanyHistory>> {
  const map = new Map<string, CompanyHistory>()
  if (companyIds.length === 0) return map

  const cacheKey = `company_history_${companyIds.slice().sort().join(",").slice(0, 200)}_${companyIds.length}`
  const cached = getCached<Array<[string, CompanyHistory]>>(cacheKey)
  if (cached) {
    return new Map(cached)
  }

  // HubSpot caps batch reads with propertiesWithHistory at 50 (not 100 like regular reads).
  const batchSize = 50
  for (let i = 0; i < companyIds.length; i += batchSize) {
    const batch = companyIds.slice(i, i + batchSize)
    const response = await hubspotFetch<HubSpotBatchReadResult>(
      "/crm/v3/objects/companies/batch/read",
      {
        method: "POST",
        body: {
          inputs: batch.map((id) => ({ id })),
          properties: ["name", "domain"],
          propertiesWithHistory: [...HISTORY_PROPERTIES],
        },
      }
    )

    for (const r of response.results) {
      const history = r.propertiesWithHistory ?? {}

      const mrr = (history["total_revenue"] ?? [])
        .map((h) => ({ timestamp: h.timestamp, value: h.value ? Number(h.value) || 0 : 0 }))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))

      const csm = (history["proprietaire_de_l_entreprise__csm_"] ?? [])
        .map((h) => ({ timestamp: h.timestamp, value: h.value || null }))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))

      const phase = (history["phase_du_client"] ?? [])
        .map((h) => ({ timestamp: h.timestamp, value: h.value || null }))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))

      map.set(r.id, {
        id: r.id,
        name: r.properties.name ?? "",
        domain: r.properties.domain ?? null,
        mrr,
        csm,
        phase,
      })
    }
  }

  setCache(cacheKey, Array.from(map.entries()))
  return map
}
