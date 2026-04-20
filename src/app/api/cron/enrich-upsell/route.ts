export const dynamic = "force-dynamic"
export const maxDuration = 300 // 5 min max on Vercel Pro, 10s on free

import { NextRequest, NextResponse } from "next/server"
import { fetchCustomerCompanies } from "@/lib/hubspot/companies"
import { enrichCompany, writeEnrichmentToHubSpot } from "@/lib/enrichment"

const BATCH_SIZE = 10
const MIN_DAYS_BETWEEN_ENRICHMENT = 7

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  // Protect with Bearer token (Vercel Cron sends this automatically if configured)
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const companies = await fetchCustomerCompanies()

    // Build lookup map of domains for sibling cross-ref
    const domainMap = new Map<string, { id: string; name: string }>()
    for (const c of companies) {
      if (c.domain) domainMap.set(c.domain.toLowerCase(), { id: c.id, name: c.name })
    }

    // Filter companies that need enrichment
    const now = Date.now()
    const needsEnrichment = companies.filter((c) => {
      if (!c.domain) return false
      if (!c.upsellSignals?.enrichedAt) return true // Never enriched
      const age = now - new Date(c.upsellSignals.enrichedAt).getTime()
      return age > MIN_DAYS_BETWEEN_ENRICHMENT * 24 * 60 * 60 * 1000
    })

    const batch = needsEnrichment.slice(0, BATCH_SIZE)
    const results: Array<{ id: string; name: string; status: "success" | "error"; error?: string }> = []

    for (const company of batch) {
      try {
        const signals = await enrichCompany(
          company.id,
          company.domain!,
          company.name,
          company.mrr,
          company.plan,
          domainMap
        )
        if (signals) {
          await writeEnrichmentToHubSpot(company.id, signals)
          results.push({ id: company.id, name: company.name, status: "success" })
        } else {
          results.push({ id: company.id, name: company.name, status: "error", error: "No signals extracted" })
        }
      } catch (err) {
        results.push({ id: company.id, name: company.name, status: "error", error: String(err) })
      }
    }

    return NextResponse.json({
      total: companies.length,
      needsEnrichment: needsEnrichment.length,
      processed: batch.length,
      results,
    })
  } catch (error) {
    console.error("Enrich cron error:", error)
    return NextResponse.json({ error: "Cron failed", details: String(error) }, { status: 500 })
  }
}
