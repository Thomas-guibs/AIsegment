export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextRequest, NextResponse } from "next/server"
import { fetchCompanyById, fetchCustomerCompanies } from "@/lib/hubspot/companies"
import { enrichCompany } from "@/lib/enrichment"

export async function POST(
  _request: NextRequest,
  { params }: { params: { companyId: string } }
) {
  try {
    const { companyId } = params

    const company = await fetchCompanyById(companyId)
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 })
    }
    if (!company.domain) {
      return NextResponse.json({ error: "Company has no domain" }, { status: 400 })
    }

    // Fetch customer companies in parallel with enrichment start
    // Customer list is needed for sibling cross-reference only — cached so fast
    const customersPromise = fetchCustomerCompanies().catch(() => [])

    // Build domain map from customers (awaited when needed)
    const buildDomainMap = async () => {
      const customers = await customersPromise
      const map = new Map<string, { id: string; name: string }>()
      for (const c of customers) {
        if (c.domain) map.set(c.domain.toLowerCase(), { id: c.id, name: c.name })
      }
      return map
    }

    const domainMap = await buildDomainMap()

    const signals = await enrichCompany(
      companyId, company.domain, company.name,
      company.mrr, company.plan, domainMap
    )

    if (!signals) {
      return NextResponse.json({ error: "Could not extract signals from website" }, { status: 500 })
    }

    return NextResponse.json({ success: true, signals })
  } catch (error) {
    console.error("Enrich API error:", error)
    return NextResponse.json({ error: "Enrichment failed", details: String(error).slice(0, 500) }, { status: 500 })
  }
}
