import { NextRequest, NextResponse } from "next/server"
import { fetchCustomerCompanies } from "@/lib/hubspot/companies"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const csmId = searchParams.get("csmId") ?? undefined

    const companies = await fetchCustomerCompanies(csmId)

    return NextResponse.json({ companies, total: companies.length })
  } catch (error) {
    console.error("Companies API error:", error)
    return NextResponse.json(
      { error: "Failed to fetch companies", details: String(error) },
      { status: 500 }
    )
  }
}
