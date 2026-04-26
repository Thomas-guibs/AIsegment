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
        // MRR de référence:
        // = sum of hs_mrr from paid deals (date_de_paiement < month start, Closed Won/Paiement reçu)
        // MINUS deals where the company has a churn deal with the SAME hs_mrr amount
        // (matching amount = company has fully churned that contract)

        // Step 1: Get all paid deals before this month
        const paidDeals = csmDeals.filter((d) =>
          d.paymentDate &&
          d.paymentDate < monthStartStr &&
          CLOSED_WON_STAGES.includes(d.stage) &&
          d.mrr > 0
        )

        // Step 2: Get all churn deals (any time, to match against paid deals)
        const churnDealsAll = csmDeals.filter((d) =>
          d.attribution === ATTRIBUTION.CHURN
        )

        // Step 3: For each paid deal, check if there's a churn deal
        // from the same company with the same hs_mrr amount
        let mrrReference = 0
        let companiesInPortfolio = 0
        const seenCompanies = new Set<string>()

        for (const deal of paidDeals) {
          const dealCompany = deal.name.split(" - ")[0].trim().toLowerCase()
          const dealMrr = Math.round(deal.mrr * 100) // Compare in cents to avoid float issues

          // Check if a churn deal exists for the same company with matching MRR
          const hasMatchingChurn = churnDealsAll.some((churn) => {
            const churnCompany = churn.name.split(" - ")[0].trim().toLowerCase()
            const churnMrrAbs = Math.round(Math.abs(churn.mrr) * 100)
            // Same company + same MRR amount = this contract was churned
            return (churnCompany.includes(dealCompany) || dealCompany.includes(churnCompany)) &&
                   churnMrrAbs === dealMrr
          })

          if (hasMatchingChurn) continue

          mrrReference += deal.mrr
          if (!seenCompanies.has(dealCompany)) {
            seenCompanies.add(dealCompany)
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
          // For movements (upsell/churn/downsell), use `amount` (the delta),
          // NOT `hs_mrr` (which is the total contract MRR).
          // Example: a renewal with hs_mrr=1304 but amount=144 → the upsell is 144.
          const dealAmount = Math.abs(deal.amount)

          // UPSELL: keyed on payment date (date_de_paiement)
          if (deal.attribution === ATTRIBUTION.UPSELL && CLOSED_WON_STAGES.includes(deal.stage)) {
            if (!deal.paymentDate) continue
            if (deal.paymentDate < monthStartStr || deal.paymentDate >= monthEndStr) continue
            if (dealAmount === 0) continue
            upsellMrr += dealAmount
            upsellDeals.push({ id: deal.id, name: deal.name, mrr: dealAmount, date: deal.paymentDate })
          }
          // CHURN: keyed on operation date + must be eligible
          else if (deal.attribution === ATTRIBUTION.CHURN && deal.eligible) {
            if (!deal.operationDate) continue
            if (deal.operationDate < monthStartStr || deal.operationDate >= monthEndStr) continue
            if (dealAmount === 0) continue
            churnMrr += dealAmount
            churnDeals.push({ id: deal.id, name: deal.name, mrr: dealAmount, date: deal.operationDate })
          }
          // DOWNSELL: keyed on operation date + must be eligible
          else if (deal.attribution === ATTRIBUTION.DOWNSELL && deal.eligible) {
            if (!deal.operationDate) continue
            if (deal.operationDate < monthStartStr || deal.operationDate >= monthEndStr) continue
            if (dealAmount === 0) continue
            downsellMrr += dealAmount
            downsellDeals.push({ id: deal.id, name: deal.name, mrr: dealAmount, date: deal.operationDate })
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
