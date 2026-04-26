export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { hubspotSearch } from "@/lib/hubspot/client"
import { fetchCustomerCompanies } from "@/lib/hubspot/companies"
import type { HubSpotDeal } from "@/lib/types"
import { DEAL_PROPERTIES, CSM_TEAM, SALES_STAGES, ATTRIBUTION } from "@/lib/constants"
import { parseNumber, parseDate } from "@/lib/utils"
import { startOfMonth, startOfQuarter, endOfQuarter, addMonths, format } from "date-fns"

const CLOSED_WON_STAGES: string[] = [SALES_STAGES.CLOSED_WON, SALES_STAGES.PAIEMENT_RECU]

// Only 4 active CSMs get commissions
const COMMISSION_CSMS = CSM_TEAM.filter(
  (c) => c.id !== "1949410186" && c.id !== "44919918"
)

interface CommissionMonth {
  month: string
  label: string
  mrrReference: number
  companiesInPortfolio: number
  upsellMrr: number
  downsellMrr: number
  churnMrr: number
  nrrMrr: number
  nrrPercent: number
  upsellDeals: Array<{ id: string; name: string; mrr: number; date: string | null }>
  churnDeals: Array<{ id: string; name: string; mrr: number; date: string | null }>
  downsellDeals: Array<{ id: string; name: string; mrr: number; date: string | null }>
}

interface CsmCommission {
  csmId: string
  csmName: string
  initials: string
  color: string
  months: CommissionMonth[]
  quarterlyNrr: number
  avgMrrReference: number
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const now = new Date()
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10)
    const quarter = parseInt(searchParams.get("quarter") ?? String(Math.ceil((now.getMonth() + 1) / 3)), 10)

    // Calculate the 3 months of the quarter
    const quarterStart = new Date(year, (quarter - 1) * 3, 1)
    const months = [0, 1, 2].map((i) => {
      const d = addMonths(quarterStart, i)
      return {
        start: startOfMonth(d),
        key: format(d, "yyyy-MM"),
        label: format(d, "MMM yy"),
      }
    })

    // Fetch all deals with payment dates and attributions (cached)
    const allDeals = await hubspotSearch<HubSpotDeal>("deals", {
      filterGroups: [
        { filters: [{ propertyName: "date_de_paiement", operator: "HAS_PROPERTY" }] },
        { filters: [{ propertyName: "attribution", operator: "IN", values: [ATTRIBUTION.UPSELL, ATTRIBUTION.CHURN, ATTRIBUTION.DOWNSELL] }] },
      ],
      properties: [...DEAL_PROPERTIES],
    }, `commission_deals_${year}_Q${quarter}`)

    // Parse deals
    const deals = allDeals.map((raw) => ({
      id: raw.id,
      name: raw.properties.dealname ?? "",
      mrr: parseNumber(raw.properties.hs_mrr),
      amount: parseNumber(raw.properties.amount),
      attribution: raw.properties.attribution ?? null,
      paymentDate: raw.properties.date_de_paiement?.slice(0, 10) ?? null,
      operationDate: raw.properties.date_de_prise_en_compte?.slice(0, 10) ?? null,
      stage: raw.properties.dealstage ?? "",
      ownerId: raw.properties.hubspot_owner_id ?? null,
      eligible: raw.properties.deal_eligibility === "true",
    }))

    // Fetch all companies (for MRR reference)
    const allCompanies = await fetchCustomerCompanies()

    // Build commissions per CSM
    const csmCommissions: CsmCommission[] = COMMISSION_CSMS.map((csm) => {
      const csmCompanies = allCompanies.filter((c) => c.ownerId === csm.id)
      const csmDeals = deals.filter((d) => d.ownerId === csm.id)

      const monthResults: CommissionMonth[] = months.map((month) => {
        const monthStartStr = format(month.start, "yyyy-MM-dd")
        const monthEndStr = format(addMonths(month.start, 1), "yyyy-MM-dd")

        // MRR de référence:
        // Companies that have at least 1 deal with payment_date < monthStart
        // AND don't have a churn deal with operation_date < monthStart
        const companiesWithPayment = new Set<string>()
        // MRR de référence = sum of hs_mrr from deals:
        //   - with date_de_paiement < month start (paid before the month)
        //   - in Closed Won / Paiement reçu stage
        //   - with hs_mrr > 0 (exclude renewals at 0)
        //   - NOT from companies that have an eligible churn with operation_date < month start

        // Step 1: identify churned company names (eligible churns before this month)
        const churnedCompanyNames = new Set<string>()
        for (const deal of csmDeals) {
          if (deal.attribution === ATTRIBUTION.CHURN && deal.eligible &&
              deal.operationDate && deal.operationDate < monthStartStr) {
            // Extract company name from deal name (deals often named "Company - Type")
            churnedCompanyNames.add(deal.name.toLowerCase())
          }
        }

        // Step 2: sum hs_mrr from paid deals, excluding churned companies
        let mrrReference = 0
        let companiesInPortfolio = 0
        const seenCompanies = new Set<string>()

        // Get paid deals with MRR > 0 before this month
        const paidDeals = csmDeals.filter((d) =>
          d.paymentDate &&
          d.paymentDate < monthStartStr &&
          CLOSED_WON_STAGES.includes(d.stage) &&
          d.mrr > 0
        )

        for (const deal of paidDeals) {
          // Check if this deal's company has churned
          const dealLower = deal.name.toLowerCase()
          const isChurned = Array.from(churnedCompanyNames).some(
            (churnName) => {
              const churnCompany = churnName.split(" - ")[0].trim()
              const dealCompany = dealLower.split(" - ")[0].trim()
              return churnCompany.includes(dealCompany) || dealCompany.includes(churnCompany)
            }
          )
          if (isChurned) continue

          mrrReference += deal.mrr
          const companyKey = deal.name.split(" - ")[0].trim().toLowerCase()
          if (!seenCompanies.has(companyKey)) {
            seenCompanies.add(companyKey)
            companiesInPortfolio++
          }
        }

        // Monthly movements
        // UPSELL: uses date_de_paiement (payment date) as the reference date
        // CHURN/DOWNSELL: uses date_de_prise_en_compte (operation date) + deal_eligibility must be "true"
        const upsellDeals: CommissionMonth["upsellDeals"] = []
        const churnDeals: CommissionMonth["churnDeals"] = []
        const downsellDeals: CommissionMonth["downsellDeals"] = []

        let upsellMrr = 0
        let churnMrr = 0
        let downsellMrr = 0

        for (const deal of csmDeals) {
          const dealMrr = deal.mrr || Math.abs(deal.amount)

          // UPSELL: keyed on payment date (date_de_paiement)
          if (deal.attribution === ATTRIBUTION.UPSELL && CLOSED_WON_STAGES.includes(deal.stage)) {
            if (!deal.paymentDate) continue
            if (deal.paymentDate < monthStartStr || deal.paymentDate >= monthEndStr) continue
            upsellMrr += dealMrr
            upsellDeals.push({ id: deal.id, name: deal.name, mrr: dealMrr, date: deal.paymentDate })
          }
          // CHURN: keyed on operation date + must be eligible
          else if (deal.attribution === ATTRIBUTION.CHURN && deal.eligible) {
            if (!deal.operationDate) continue
            if (deal.operationDate < monthStartStr || deal.operationDate >= monthEndStr) continue
            churnMrr += Math.abs(dealMrr)
            churnDeals.push({ id: deal.id, name: deal.name, mrr: Math.abs(dealMrr), date: deal.operationDate })
          }
          // DOWNSELL: keyed on operation date + must be eligible
          else if (deal.attribution === ATTRIBUTION.DOWNSELL && deal.eligible) {
            if (!deal.operationDate) continue
            if (deal.operationDate < monthStartStr || deal.operationDate >= monthEndStr) continue
            downsellMrr += Math.abs(dealMrr)
            downsellDeals.push({ id: deal.id, name: deal.name, mrr: Math.abs(dealMrr), date: deal.operationDate })
          }
        }

        const nrrMrr = mrrReference + upsellMrr - downsellMrr - churnMrr
        const nrrPercent = mrrReference > 0 ? (nrrMrr / mrrReference) * 100 : 100

        return {
          month: month.key,
          label: month.label,
          mrrReference: Math.round(mrrReference * 100) / 100,
          companiesInPortfolio,
          upsellMrr: Math.round(upsellMrr * 100) / 100,
          downsellMrr: Math.round(downsellMrr * 100) / 100,
          churnMrr: Math.round(churnMrr * 100) / 100,
          nrrMrr: Math.round(nrrMrr * 100) / 100,
          nrrPercent: Math.round(nrrPercent * 100) / 100,
          upsellDeals,
          churnDeals,
          downsellDeals,
        }
      })

      const quarterlyNrr = monthResults.length > 0
        ? Math.round((monthResults.reduce((sum, m) => sum + m.nrrPercent, 0) / monthResults.length) * 100) / 100
        : 100

      const avgMrrReference = monthResults.length > 0
        ? Math.round(monthResults.reduce((sum, m) => sum + m.mrrReference, 0) / monthResults.length)
        : 0

      return {
        csmId: csm.id,
        csmName: csm.name,
        initials: csm.initials,
        color: csm.color,
        months: monthResults,
        quarterlyNrr,
        avgMrrReference,
      }
    })

    return NextResponse.json({
      year,
      quarter,
      quarterLabel: `Q${quarter} ${year}`,
      csms: csmCommissions,
    })
  } catch (error) {
    console.error("Commissions API error:", error)
    return NextResponse.json({ error: "Failed to compute commissions", details: String(error) }, { status: 500 })
  }
}
