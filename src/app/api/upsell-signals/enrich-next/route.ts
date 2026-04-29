export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextRequest, NextResponse } from "next/server"
import { fetchCustomerCompanies } from "@/lib/hubspot/companies"
import { enrichCompanyWithDebug } from "@/lib/enrichment"
import { listEnrichmentIds } from "@/lib/enrichment/storage"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const csmId: string | null = typeof body.csmId === "string" && body.csmId.length > 0 ? body.csmId : null

    const [customers, enrichedIds] = await Promise.all([
      fetchCustomerCompanies(),
      listEnrichmentIds(),
    ])
    const enrichedSet = new Set(enrichedIds)

    // Build scope: customers in CSM (if filtered), with a domain, not yet enriched
    let candidates = customers.filter((c) => c.domain && !enrichedSet.has(c.id))
    if (csmId) candidates = candidates.filter((c) => c.ownerId === csmId)

    if (candidates.length === 0) {
      return NextResponse.json({
        done: true,
        message: csmId
          ? "Tous les comptes de ce CSM sont enrichis"
          : "Tous les comptes sont enrichis",
        totalEnriched: enrichedIds.length,
      })
    }

    // Pick highest MRR not yet enriched
    candidates.sort((a, b) => b.mrr - a.mrr)
    const target = candidates[0]

    // Build domain map for sibling-brand → existing-client matching
    const domainMap = new Map<string, { id: string; name: string }>()
    for (const c of customers) {
      if (c.domain) domainMap.set(c.domain.toLowerCase(), { id: c.id, name: c.name })
    }

    const { signals } = await enrichCompanyWithDebug(
      target.id,
      target.domain!,
      target.name,
      target.mrr,
      target.plan,
      domainMap,
      target.ownerId,
    )

    if (!signals) {
      return NextResponse.json({
        done: false,
        error: "Enrichment failed",
        enrichedCompanyId: target.id,
        name: target.name,
        remaining: candidates.length - 1,
        totalEnriched: enrichedIds.length,
      }, { status: 500 })
    }

    const siblings = signals.siblingBrands.filter((s) => !s.excluded)
    const hotCount = siblings.filter((s) => (s.icpScore ?? 0) >= 70).length

    return NextResponse.json({
      done: false,
      enrichedCompanyId: target.id,
      name: target.name,
      mrr: target.mrr,
      signalsCount: siblings.length,
      hotCount,
      remaining: candidates.length - 1,
      totalEnriched: enrichedIds.length + 1,
    })
  } catch (error) {
    console.error("enrich-next error:", error)
    return NextResponse.json({ error: "Enrichment failed", details: String(error).slice(0, 500) }, { status: 500 })
  }
}
