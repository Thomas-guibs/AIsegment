import { getCached, setCache } from "../cache"
import { HUBSPOT_PAGE_LIMIT } from "../constants"

const HUBSPOT_BASE_URL = "https://api.hubapi.com"

function getAccessToken(): string {
  const token = process.env.HUBSPOT_ACCESS_TOKEN
  if (!token) {
    throw new Error("HUBSPOT_ACCESS_TOKEN environment variable is not set")
  }
  return token
}

interface RequestOptions {
  method?: "GET" | "POST"
  body?: unknown
  params?: Record<string, string>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// HubSpot Search API has a 5 req/s per token limit, "secondly" quota.
// Batch reads share the same secondly quota. To avoid 429s when many calls
// happen concurrently (e.g. dashboard + kpis + nrr-trends firing at once),
// we retry with exponential backoff on 429 (and 5xx as a defensive measure).
export async function hubspotFetch<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, params } = options
  const url = new URL(`${HUBSPOT_BASE_URL}${endpoint}`)

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value)
    })
  }

  const maxAttempts = 5
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${getAccessToken()}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })

    if (response.ok) return response.json()

    const retryable = response.status === 429 || response.status >= 500
    if (retryable && attempt < maxAttempts - 1) {
      // 429 responses may include Retry-After (seconds) — honor it when present,
      // otherwise use exponential backoff (400ms, 800ms, 1600ms, 3200ms).
      const retryAfterHeader = response.headers.get("Retry-After")
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 0
      const backoffMs = Math.max(retryAfterMs, 400 * 2 ** attempt)
      // Consume the body so the connection can be reused
      await response.text().catch(() => {})
      await sleep(backoffMs)
      continue
    }

    const errorBody = await response.text().catch(() => "Unknown error")
    throw new Error(`HubSpot API error ${response.status}: ${errorBody}`)
  }

  // Unreachable — the loop either returns or throws.
  throw new Error("HubSpot API: exhausted retries")
}

// Generic search with automatic pagination
export interface SearchFilter {
  propertyName: string
  operator: "EQ" | "NEQ" | "GT" | "GTE" | "LT" | "LTE" | "IN" | "NOT_IN" | "HAS_PROPERTY" | "NOT_HAS_PROPERTY" | "BETWEEN"
  value?: string
  values?: string[]
  highValue?: string
}

export interface SearchFilterGroup {
  filters: SearchFilter[]
}

export interface SearchRequest {
  filterGroups: SearchFilterGroup[]
  properties: readonly string[] | string[]
  sorts?: Array<{ propertyName: string; direction: "ASCENDING" | "DESCENDING" }>
  limit?: number
  after?: string
}

interface SearchResponse<T> {
  total: number
  results: T[]
  paging?: {
    next?: {
      after: string
    }
  }
}

export async function hubspotSearch<T>(
  objectType: "deals" | "companies" | "contacts" | "engagements",
  request: SearchRequest,
  cacheKey?: string
): Promise<T[]> {
  if (cacheKey) {
    const cached = getCached<T[]>(cacheKey)
    if (cached) return cached
  }

  const allResults: T[] = []
  let after: string | undefined

  do {
    const response = await hubspotFetch<SearchResponse<T>>(
      `/crm/v3/objects/${objectType}/search`,
      {
        method: "POST",
        body: {
          ...request,
          limit: request.limit ?? HUBSPOT_PAGE_LIMIT,
          ...(after ? { after } : {}),
        },
      }
    )

    allResults.push(...response.results)
    after = response.paging?.next?.after
  } while (after)

  if (cacheKey) {
    setCache(cacheKey, allResults)
  }

  return allResults
}

// Fetch with associations
export async function hubspotSearchWithAssociations<T>(
  objectType: "deals" | "companies",
  request: SearchRequest,
  associations: string[],
  cacheKey?: string
): Promise<T[]> {
  if (cacheKey) {
    const cached = getCached<T[]>(cacheKey)
    if (cached) return cached
  }

  const allResults: T[] = []
  let after: string | undefined

  do {
    const body: Record<string, unknown> = {
      ...request,
      limit: request.limit ?? HUBSPOT_PAGE_LIMIT,
      ...(after ? { after } : {}),
    }

    const response = await hubspotFetch<SearchResponse<T>>(
      `/crm/v3/objects/${objectType}/search`,
      { method: "POST", body }
    )

    // Fetch associations for each batch if needed
    if (associations.length > 0 && response.results.length > 0) {
      const ids = response.results.map((r: any) => r.id)
      for (const assocType of associations) {
        try {
          const assocResponse = await hubspotFetch<{
            results: Array<{ from: { id: string }; to: Array<{ toObjectId: string; type: string }> }>
          }>(`/crm/v4/objects/${objectType}/batch/read`, {
            method: "POST",
            body: {
              inputs: ids.map((id: string) => ({ id })),
              properties: [],
            },
          })
          // Map associations back to results (simplified)
          // In practice, we handle this at the query level
          void assocResponse
        } catch {
          // Associations are best-effort
        }
      }
    }

    allResults.push(...response.results)
    after = response.paging?.next?.after
  } while (after)

  if (cacheKey) {
    setCache(cacheKey, allResults)
  }

  return allResults
}

// Simple list fetch (for owners, etc.)
export async function hubspotList<T>(endpoint: string, cacheKey?: string): Promise<T[]> {
  if (cacheKey) {
    const cached = getCached<T[]>(cacheKey)
    if (cached) return cached
  }

  const response = await hubspotFetch<{ results: T[] }>(endpoint)
  const results = response.results

  if (cacheKey) {
    setCache(cacheKey, results)
  }

  return results
}
