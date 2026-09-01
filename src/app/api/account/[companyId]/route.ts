export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { fetchCompanyById, fetchCompanyDeals } from "@/lib/hubspot/companies"
import { hubspotFetch } from "@/lib/hubspot/client"
import { fetchIntercomTickets, countOpenTickets } from "@/lib/intercom/client"
import { fetchMeetingsForCompany } from "@/lib/google/calendar"
import { calculateHealthScore } from "@/lib/scoring/health"
import { getCachedEnrichment } from "@/lib/enrichment"
import type { Deal, AccountDetail } from "@/lib/types"
import { DEAL_PROPERTIES, CSM_TEAM } from "@/lib/constants"
import { parseNumber, parseDate } from "@/lib/utils"

// CSM calendar IDs (primary email = calendar ID for Google Calendar)
const CSM_CALENDAR_IDS = CSM_TEAM
  .filter((c) => c.id !== "1949410186" && c.id !== "44919918")
  .map((c) => c.id) // Placeholder — will need real email addresses

export async function GET(
  request: NextRequest,
  { params }: { params: { companyId: string } }
) {
  try {
    const { companyId } = params

    // 1. Fetch company from HubSpot
    const company = await fetchCompanyById(companyId)
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 })
    }

    // 2. Fetch deals, tickets, meetings in parallel
    const [dealIds, tickets, meetings] = await Promise.all([
      fetchCompanyDeals(companyId),
      fetchIntercomTickets(company.name, company.domain),
      fetchMeetingsForCompany(
        company.name,
        company.domain,
        CSM_CALENDAR_IDS,
      ),
    ])

    // 3. Fetch deal details
    let deals: Deal[] = []
    if (dealIds.length > 0) {
      try {
        const batchSize = Math.min(dealIds.length, 100)
        const response = await hubspotFetch<{
          results: Array<{ id: string; properties: Record<string, string | null> }>
        }>("/crm/v3/objects/deals/batch/read", {
          method: "POST",
          body: {
            inputs: dealIds.slice(0, batchSize).map((id) => ({ id })),
            properties: [...DEAL_PROPERTIES],
          },
        })

        deals = response.results.map((r) => ({
          id: r.id,
          name: r.properties.dealname ?? "",
          amount: parseNumber(r.properties.amount),
          mrr: parseNumber(r.properties.hs_mrr),
          arr: parseNumber(r.properties.hs_arr),
          acv: parseNumber(r.properties.hs_acv),
          attribution: r.properties.attribution ?? null,
          renewalDate: parseDate(r.properties.renewall_date),
          renewalStrategy: r.properties.renewall_strategy ?? null,
          operationDate: parseDate(r.properties.date_de_prise_en_compte),
          paymentDate: parseDate(r.properties.date_de_paiement),
          closeDate: parseDate(r.properties.closedate),
          stage: r.properties.dealstage ?? "",
          pipeline: r.properties.pipeline ?? "",
          ownerId: r.properties.hubspot_owner_id ?? null,
          createdAt: parseDate(r.properties.createdate),
          lastModified: parseDate(r.properties.hs_lastmodifieddate),
          companyId,
          companyName: company.name,
        }))

        // Sort by most recent first
        deals.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      } catch {
        // Continue without deals
      }
    }

    // 4. Calculate health score
    const openTicketCount = tickets.filter((t) => t.state === "open").length
    // Approximate days since last activity from deal or meeting dates
    const lastDealDate = deals[0]?.lastModified ?? deals[0]?.createdAt
    const lastMeetingDate = meetings[0]?.start
    const mostRecentActivity = [lastDealDate, lastMeetingDate]
      .filter(Boolean)
      .sort()
      .reverse()[0]
    const daysSinceLastActivity = mostRecentActivity
      ? Math.floor((Date.now() - new Date(mostRecentActivity).getTime()) / (1000 * 60 * 60 * 24))
      : null

    const healthScore = calculateHealthScore(company, openTicketCount, daysSinceLastActivity)

    // Inject cached upsell signals if available
    const upsellSignals = getCachedEnrichment(companyId)
    if (upsellSignals) company.upsellSignals = upsellSignals

    const accountDetail: AccountDetail = {
      company,
      healthScore,
      deals,
      tickets,
      meetings,
    }

    return NextResponse.json(accountDetail)
  } catch (error) {
    console.error("Account API error:", error)
    return NextResponse.json(
      { error: "Failed to fetch account", details: String(error) },
      { status: 500 }
    )
  }
}
