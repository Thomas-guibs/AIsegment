// =============================================================================
// HubSpot property history (spec §2)
//
// `/crm/v3/objects/{type}/batch/read` accepts `propertiesWithHistory`, which is
// the only way to get a property's past values. Batches are capped at 100 ids,
// and asking for history is heavy — so we ask for the three properties the
// calculation actually needs, and nothing else.
// =============================================================================

import { hubspotFetch } from "./client"

export interface HistoryVersion {
  value: string | null
  timestamp: string
  sourceType?: string
}

export interface ObjectWithHistory {
  id: string
  properties: Record<string, string | null>
  propertiesWithHistory?: Record<string, HistoryVersion[]>
}

const BATCH_SIZE = 100
/** HubSpot rate-limits batch reads; a small concurrency keeps us well inside it. */
const CONCURRENCY = 4

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0

  async function worker() {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * Batch-read objects with the history of `historyProperties`.
 * Missing ids are skipped by HubSpot rather than erroring; a failed batch is
 * retried once, then yields an empty slice so one bad id cannot sink the run.
 */
export async function batchReadWithHistory(
  objectType: "companies" | "deals",
  ids: string[],
  properties: string[],
  historyProperties: string[]
): Promise<ObjectWithHistory[]> {
  if (ids.length === 0) return []

  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    batches.push(ids.slice(i, i + BATCH_SIZE))
  }

  const slices = await mapLimit(batches, CONCURRENCY, async (batch) => {
    const body = {
      inputs: batch.map((id) => ({ id })),
      properties,
      propertiesWithHistory: historyProperties,
    }
    try {
      const response = await hubspotFetch<{ results: ObjectWithHistory[] }>(
        `/crm/v3/objects/${objectType}/batch/read`,
        { method: "POST", body }
      )
      return response.results ?? []
    } catch {
      try {
        const retry = await hubspotFetch<{ results: ObjectWithHistory[] }>(
          `/crm/v3/objects/${objectType}/batch/read`,
          { method: "POST", body }
        )
        return retry.results ?? []
      } catch {
        return []
      }
    }
  })

  return slices.flat()
}

/**
 * Deal → company association, batched.
 * A deal carries at most one company for our purposes; extra associations are
 * ignored rather than fanned out, because a MRR movement belongs to one account.
 */
export async function fetchDealCompanyMap(dealIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (dealIds.length === 0) return map

  const batches: string[][] = []
  for (let i = 0; i < dealIds.length; i += BATCH_SIZE) {
    batches.push(dealIds.slice(i, i + BATCH_SIZE))
  }

  const slices = await mapLimit(batches, CONCURRENCY, async (batch) => {
    try {
      const response = await hubspotFetch<{
        results: Array<{ from: { id: string }; to: Array<{ toObjectId: string }> }>
      }>("/crm/v4/associations/deals/companies/batch/read", {
        method: "POST",
        body: { inputs: batch.map((id) => ({ id })) },
      })
      return response.results ?? []
    } catch {
      return []
    }
  })

  for (const result of slices.flat()) {
    const companyId = result.to?.[0]?.toObjectId
    if (companyId) map.set(result.from.id, String(companyId))
  }

  return map
}
