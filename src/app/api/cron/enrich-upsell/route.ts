export const dynamic = "force-dynamic"
export const maxDuration = 300

import { NextRequest, NextResponse } from "next/server"
import { fetchCustomerCompanies } from "@/lib/hubspot/companies"
import { enrichCompany, getCachedEnrichment } from "@/lib/enrichment"

const BATCH_SIZE = 10

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const companies = await fetchCustomerCompanies()

    const domainMap = new Map<string, { id: string; name: string }>()
    for (const c of companies) {
      if (c.domain) domainMap.set(c.domain.toLowerCase(), { id: c.id, name: c.name })
    }

    // Filter companies that need enrichment (no cache hit = needs enrichment)
    const needsEnrichment = companies.filter((c) => {
      if (!c.domain) return false
      return !getCachedEnrichment(c.id)
    })

    const batch = needsEnrichment.slice(0, BATCH_SIZE)
    const results: Array<{ id: string; name: string; status: string; score?: number }> = []

    for (const company of batch) {
      try {
        const signals = await enrichCompany(
          company.id, company.domain!, company.name,
          company.mrr, company.plan, domainMap
        )
        results.push({
          id: company.id,
          name: company.name,
          status: signals ? "success" : "no_signals",
          score: signals?.score,
        })
      } catch (err) {
        results.push({ id: company.id, name: company.name, status: `error: ${String(err).slice(0, 100)}` })
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
