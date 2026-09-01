export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextRequest, NextResponse } from "next/server"
import { fetchCompanyById, fetchCustomerCompanies } from "@/lib/hubspot/companies"
import { enrichCompanyWithDebug } from "@/lib/enrichment"

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

    const customers = await fetchCustomerCompanies().catch(() => [])
    const domainMap = new Map<string, { id: string; name: string }>()
    for (const c of customers) {
      if (c.domain) domainMap.set(c.domain.toLowerCase(), { id: c.id, name: c.name })
    }

    const { signals, debug } = await enrichCompanyWithDebug(
      companyId, company.domain, company.name,
      company.mrr, company.plan, domainMap, company.ownerId,
    )

    if (!signals) {
      return NextResponse.json({
        error: "Could not extract signals from website",
        debug,
      }, { status: 500 })
    }

    return NextResponse.json({ success: true, signals, debug })
  } catch (error) {
    console.error("Enrich API error:", error)
    return NextResponse.json({ error: "Enrichment failed", details: String(error).slice(0, 500) }, { status: 500 })
  }
}
