// Persistent storage for enrichment results — Vercel KV (Upstash Redis)
// Each enrichment costs ~$0.30, so we never want to recompute one already done.
// KV survives redeploys (unlike the in-memory cache in cache.ts).

import { kv } from "@vercel/kv"
import type { UpsellSignals } from "../types"

export interface StoredEnrichment {
  companyId: string
  parentName: string
  parentMrr: number
  parentCsmId: string | null
  signals: UpsellSignals
  enrichedAt: string  // ISO timestamp
}

const TTL_SECONDS = 30 * 24 * 60 * 60  // 30 days
const INDEX_KEY = "enriched_index"
const KEY_PREFIX = "enrichment:"

function isKvConfigured(): boolean {
  return !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
}

export function kvConfigured(): boolean {
  return isKvConfigured()
}

// Save an enrichment record + add to the sorted index
export async function saveEnrichment(record: StoredEnrichment): Promise<void> {
  if (!isKvConfigured()) {
    console.warn(`[storage] KV not configured, skipping save for ${record.companyId}`)
    return
  }
  await kv.set(`${KEY_PREFIX}${record.companyId}`, record, { ex: TTL_SECONDS })
  await kv.zadd(INDEX_KEY, {
    score: Date.parse(record.enrichedAt),
    member: record.companyId,
  })
}

export async function getEnrichment(companyId: string): Promise<StoredEnrichment | null> {
  if (!isKvConfigured()) return null
  return await kv.get<StoredEnrichment>(`${KEY_PREFIX}${companyId}`)
}

export async function isEnriched(companyId: string): Promise<boolean> {
  if (!isKvConfigured()) return false
  return (await kv.exists(`${KEY_PREFIX}${companyId}`)) === 1
}

export async function listEnrichmentIds(): Promise<string[]> {
  if (!isKvConfigured()) return []
  return await kv.zrange<string[]>(INDEX_KEY, 0, -1, { rev: true })
}

export async function listEnrichments(): Promise<StoredEnrichment[]> {
  const ids = await listEnrichmentIds()
  if (ids.length === 0) return []
  const keys = ids.map((id) => `${KEY_PREFIX}${id}`)
  const records = await kv.mget<StoredEnrichment[]>(...keys)
  return records.filter((r): r is StoredEnrichment => r !== null)
}
