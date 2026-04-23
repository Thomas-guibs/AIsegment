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

    const allCustomers = await fetchCustomerCompanies()
    const domainMap = new Map<string, { id: string; name: string }>()
    for (const c of allCustomers) {
      if (c.domain) domainMap.set(c.domain.toLowerCase(), { id: c.id, name: c.name })
    }

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
    return NextResponse.json({ error: "Enrichment failed", details: String(error) }, { status: 500 })
  }
}
