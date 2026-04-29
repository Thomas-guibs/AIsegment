// Persistent storage for enrichment results — Supabase (Postgres).
// Each enrichment costs ~$0.30, so we never want to recompute one already done.
//
// Required table (run once in Supabase SQL editor):
//
//   create table if not exists upsell_enrichments (
//     company_id     text primary key,
//     parent_name    text not null,
//     parent_mrr     numeric not null default 0,
//     parent_csm_id  text,
//     signals        jsonb not null,
//     enriched_at    timestamptz not null default now()
//   );
//   create index if not exists upsell_enrichments_enriched_at_idx
//     on upsell_enrichments (enriched_at desc);
//
// Env vars (auto-injected when Supabase is connected via Vercel Storage):
//   SUPABASE_URL              — eg. https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — service role key (bypasses RLS, server-side only)

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { UpsellSignals } from "../types"

export interface StoredEnrichment {
  companyId: string
  parentName: string
  parentMrr: number
  parentCsmId: string | null
  signals: UpsellSignals
  enrichedAt: string  // ISO timestamp
}

const TABLE = "upsell_enrichments"

let _client: SupabaseClient | null = null

function getClient(): SupabaseClient | null {
  if (_client) return _client
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY
  if (!url || !key) return null
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _client
}

export function dbConfigured(): boolean {
  return getClient() !== null
}

// Map DB row → typed StoredEnrichment
interface DbRow {
  company_id: string
  parent_name: string
  parent_mrr: number | string
  parent_csm_id: string | null
  signals: UpsellSignals
  enriched_at: string
}

function fromRow(row: DbRow): StoredEnrichment {
  return {
    companyId: row.company_id,
    parentName: row.parent_name,
    parentMrr: typeof row.parent_mrr === "string" ? parseFloat(row.parent_mrr) : row.parent_mrr,
    parentCsmId: row.parent_csm_id,
    signals: row.signals,
    enrichedAt: row.enriched_at,
  }
}

export async function saveEnrichment(record: StoredEnrichment): Promise<void> {
  const client = getClient()
  if (!client) {
    console.warn(`[storage] Supabase not configured, skipping save for ${record.companyId}`)
    return
  }
  const { error } = await client.from(TABLE).upsert({
    company_id: record.companyId,
    parent_name: record.parentName,
    parent_mrr: record.parentMrr,
    parent_csm_id: record.parentCsmId,
    signals: record.signals,
    enriched_at: record.enrichedAt,
  }, { onConflict: "company_id" })
  if (error) throw new Error(`Supabase upsert failed: ${error.message}`)
}

export async function getEnrichment(companyId: string): Promise<StoredEnrichment | null> {
  const client = getClient()
  if (!client) return null
  const { data, error } = await client
    .from(TABLE)
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle()
  if (error) {
    console.warn(`[storage] getEnrichment(${companyId}) failed: ${error.message}`)
    return null
  }
  return data ? fromRow(data as DbRow) : null
}

export async function isEnriched(companyId: string): Promise<boolean> {
  const client = getClient()
  if (!client) return false
  const { count, error } = await client
    .from(TABLE)
    .select("company_id", { count: "exact", head: true })
    .eq("company_id", companyId)
  if (error) return false
  return (count ?? 0) > 0
}

export async function listEnrichmentIds(): Promise<string[]> {
  const client = getClient()
  if (!client) return []
  const { data, error } = await client
    .from(TABLE)
    .select("company_id")
    .order("enriched_at", { ascending: false })
  if (error) {
    console.warn(`[storage] listEnrichmentIds failed: ${error.message}`)
    return []
  }
  return (data ?? []).map((r) => r.company_id as string)
}

export async function listEnrichments(): Promise<StoredEnrichment[]> {
  const client = getClient()
  if (!client) return []
  const { data, error } = await client
    .from(TABLE)
    .select("*")
    .order("enriched_at", { ascending: false })
  if (error) {
    console.warn(`[storage] listEnrichments failed: ${error.message}`)
    return []
  }
  return (data as DbRow[] | null ?? []).map(fromRow)
}
