// =============================================================================
// Point-in-time property reading — HubSpot property history
//
// Spec §2 warnings applied:
//   - HubSpot returns history NEWEST → OLDEST. We re-sort ASCENDING here so
//     valueAt() reads left-to-right and returns the last value at or before T.
//   - History can be truncated: if it doesn't reach T, valueAt() returns
//     undefined. When history is entirely empty we fall back to the current
//     value (synthesized as a single entry anchored at hs_createdate).
// =============================================================================

import { hubspotFetch } from "./client"
import { getCached, setCache } from "../cache"
import { parseDate } from "../utils"

export interface HistoryEntry<V> {
  timestamp: string // ISO 8601
  value: V
}

export interface CompanyHistory {
  id: string
  name: string
  domain: string | null
  createdAt: string | null           // hs_createdate — used as fallback billing anchor
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

  // v3 — backfill_history=true + createdAt anchor. Bumped to invalidate
  // cached shape from the previous deploy.
  const cacheKey = `company_history_v3_${companyIds.slice().sort().join(",").slice(0, 200)}_${companyIds.length}`
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
          // Also request current values — used as a fallback when the property
          // has no history tracking on this HubSpot instance.
          properties: [
            "name",
            "domain",
            "hs_createdate",
            "hubspot_owner_id",
            ...HISTORY_PROPERTIES,
          ],
          propertiesWithHistory: [...HISTORY_PROPERTIES],
        },
      }
    )

    // Fallback anchor for synthetic history entries: company createdate or a
    // very old date. This ensures valueAt() at any T ≥ anchor returns the value.
    const FALLBACK_ANCHOR = "2000-01-01T00:00:00Z"

    // Backfill: if history entries exist but the earliest one is after
    // createdAt, prepend a synthetic entry at createdAt with the earliest
    // known value. Implements spec §12 `backfill_history: true` — makes
    // valueAt(T) return that earliest value for any T ≥ createdAt, so an
    // account whose CSM/MRR history HubSpot only started tracking recently
    // still shows the value it has always had.
    const backfill = <V>(
      hist: HistoryEntry<V>[],
      current: V | null,
      anchor: string
    ): HistoryEntry<V>[] => {
      if (hist.length === 0) {
        return current != null && current !== ""
          ? [{ timestamp: anchor, value: current }]
          : []
      }
      if (hist[0].timestamp > anchor) {
        return [{ timestamp: anchor, value: hist[0].value }, ...hist]
      }
      return hist
    }

    for (const r of response.results) {
      const history = r.propertiesWithHistory ?? {}
      const createdAtNorm = parseDate(r.properties.hs_createdate)
      const createdAt = createdAtNorm ?? FALLBACK_ANCHOR

      const isoTs = (h: HubSpotPropertyHistoryItem): string => parseDate(h.timestamp) ?? h.timestamp

      const mrrHist = (history["total_revenue"] ?? [])
        .map((h) => ({ timestamp: isoTs(h), value: h.value ? Number(h.value) || 0 : 0 }))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      const mrrCurrent = r.properties.total_revenue
        ? Number(r.properties.total_revenue) || 0
        : null
      const mrr = backfill(mrrHist, mrrCurrent, createdAt)

      const csmHist = (history["proprietaire_de_l_entreprise__csm_"] ?? [])
        .map((h) => ({ timestamp: isoTs(h), value: (h.value || null) as string | null }))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      // CSM history fallback:
      //   1. current value of proprietaire_de_l_entreprise__csm_ (custom field)
      //   2. hubspot_owner_id (some accounts only have the standard owner)
      const csmCurrent: string | null =
        r.properties.proprietaire_de_l_entreprise__csm_ ??
        r.properties.hubspot_owner_id ??
        null
      const csm = backfill(csmHist, csmCurrent, createdAt)

      const phaseHist = (history["phase_du_client"] ?? [])
        .map((h) => ({ timestamp: isoTs(h), value: (h.value || null) as string | null }))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      const phase = backfill(phaseHist, r.properties.phase_du_client ?? null, createdAt)

      map.set(r.id, {
        id: r.id,
        name: r.properties.name ?? "",
        domain: r.properties.domain ?? null,
        createdAt: createdAtNorm,
        mrr,
        csm,
        phase,
      })
    }
  }

  setCache(cacheKey, Array.from(map.entries()))
  return map
}
