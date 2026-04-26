export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { hubspotSearch } from "@/lib/hubspot/client"
import { fetchCustomerCompanies } from "@/lib/hubspot/companies"
import type { HubSpotDeal } from "@/lib/types"
import { DEAL_PROPERTIES, CSM_TEAM, SALES_STAGES, ATTRIBUTION } from "@/lib/constants"
import { parseNumber } from "@/lib/utils"
import { startOfMonth, addMonths, format } from "date-fns"

const CLOSED_WON_STAGES: string[] = [SALES_STAGES.CLOSED_WON, SALES_STAGES.PAIEMENT_RECU]

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

// Extract company name from deal name (deals are usually "Company - Deal type")
const getCompanyFromDeal = (dealName: string): string =>
  dealName.split(" - ")[0].trim().toLowerCase()

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const now = new Date()
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10)
    const quarter = parseInt(searchParams.get("quarter") ?? String(Math.ceil((now.getMonth() + 1) / 3)), 10)

    const quarterStart = new Date(year, (quarter - 1) * 3, 1)
    const months = [0, 1, 2].map((i) => {
      const d = addMonths(quarterStart, i)
      return {
        start: startOfMonth(d),
        key: format(d, "yyyy-MM"),
        label: format(d, "MMM yy"),
      }
    })

    // Fetch all deals with payment dates or attributions
    const allDeals = await hubspotSearch<HubSpotDeal>("deals", {
      filterGroups: [
        { filters: [{ propertyName: "date_de_paiement", operator: "HAS_PROPERTY" }] },
        { filters: [{ propertyName: "attribution", operator: "IN", values: [ATTRIBUTION.UPSELL, ATTRIBUTION.CHURN, ATTRIBUTION.DOWNSELL] }] },
      ],
      properties: [...DEAL_PROPERTIES],
    }, `commission_deals_${year}_Q${quarter}`)

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

    // Fetch all companies for CSM assignment
    const allCompanies = await fetchCustomerCompanies()

    // Build commissions per CSM
    const csmCommissions: CsmCommission[] = COMMISSION_CSMS.map((csm) => {
      // Companies assigned to this CSM (via proprietaire_de_l_entreprise__csm_)
      const csmCompanies = allCompanies.filter((c) => c.ownerId === csm.id)
      const csmCompanyNames = new Set(csmCompanies.map((c) => c.name.toLowerCase()))

      // Match deals to CSM's companies by name (not by deal owner)
      // A deal belongs to this CSM if its company name matches one of their companies
      const csmDeals = deals.filter((d) => {
        const dealCompany = getCompanyFromDeal(d.name)
        return csmCompanyNames.has(dealCompany) ||
          Array.from(csmCompanyNames).some((cn) => cn.includes(dealCompany) || dealCompany.includes(cn))
      })

      // ================================================================
      // Group deals by company name for MRR reference calculation
      // ================================================================
      // For each company: sum all hs_mrr from paid transactions
      // Then check if a churn deal exists with hs_mrr = total of the company
      // If churn amount = company total → company fully churned
      // ================================================================
      const companyDeals = new Map<string, typeof csmDeals>()
      for (const deal of csmDeals) {
        const companyKey = getCompanyFromDeal(deal.name)
        if (!companyDeals.has(companyKey)) companyDeals.set(companyKey, [])
        companyDeals.get(companyKey)!.push(deal)
      }

      const monthResults: CommissionMonth[] = months.map((month) => {
        const monthStartStr = format(month.start, "yyyy-MM-dd")
        const monthEndStr = format(addMonths(month.start, 1), "yyyy-MM-dd")

        // ================================================================
        // MRR de référence = for each company of the CSM:
        //   1. Sum all hs_mrr from paid deals (date_de_paiement exists, Closed Won/Paiement reçu)
        //   2. Check if a churn deal exists where hs_mrr = total of all paid deals
        //      AND churn operation_date < month start
        //   3. If yes → company fully churned → exclude from MRR ref for this month
        //   4. If no → company's total hs_mrr counts
        // ================================================================
        let mrrReference = 0
        let companiesInPortfolio = 0

        for (const companyKey of Array.from(companyDeals.keys())) {
          const compDeals = companyDeals.get(companyKey)!
          // Total hs_mrr from paid transactions for this company
          const paidDeals = compDeals.filter((d) =>
            d.paymentDate &&
            d.paymentDate < monthStartStr &&
            CLOSED_WON_STAGES.includes(d.stage) &&
            d.mrr > 0
          )
          if (paidDeals.length === 0) continue

          const companyTotalMrr = paidDeals.reduce((sum, d) => sum + d.mrr, 0)
          const companyTotalMrrCents = Math.round(companyTotalMrr * 100)

          // Check if a churn deal matches the total (company fully churned)
          // AND the churn operation_date is BEFORE this month start
          const churnDealsForCompany = compDeals.filter((d) =>
            d.attribution === ATTRIBUTION.CHURN &&
            d.operationDate &&
            d.operationDate < monthStartStr
          )

          const churnTotalMrrCents = churnDealsForCompany.reduce(
            (sum, d) => sum + Math.round(Math.abs(d.mrr) * 100), 0
          )

          // If churn total >= company paid total → fully churned → exclude
          if (churnTotalMrrCents >= companyTotalMrrCents && churnDealsForCompany.length > 0) {
            continue
          }

          mrrReference += companyTotalMrr
          companiesInPortfolio++
        }

        // ================================================================
        // Monthly movements
        // UPSELL: date_de_paiement in month, amount (delta), Closed Won stage
        // CHURN/DOWNSELL: date_de_prise_en_compte in month, deal_eligibility = true, amount
        // ================================================================
        const upsellDeals: CommissionMonth["upsellDeals"] = []
        const churnDeals: CommissionMonth["churnDeals"] = []
        const downsellDeals: CommissionMonth["downsellDeals"] = []

        let upsellMrr = 0
        let churnMrr = 0
        let downsellMrr = 0

        for (const deal of csmDeals) {
          const dealAmount = Math.abs(deal.amount)

          if (deal.attribution === ATTRIBUTION.UPSELL && CLOSED_WON_STAGES.includes(deal.stage)) {
            if (!deal.paymentDate) continue
            if (deal.paymentDate < monthStartStr || deal.paymentDate >= monthEndStr) continue
            if (dealAmount === 0) continue
            upsellMrr += dealAmount
            upsellDeals.push({ id: deal.id, name: deal.name, mrr: dealAmount, date: deal.paymentDate })
          } else if (deal.attribution === ATTRIBUTION.CHURN && deal.eligible) {
            if (!deal.operationDate) continue
            if (deal.operationDate < monthStartStr || deal.operationDate >= monthEndStr) continue
            if (dealAmount === 0) continue
            churnMrr += dealAmount
            churnDeals.push({ id: deal.id, name: deal.name, mrr: dealAmount, date: deal.operationDate })
          } else if (deal.attribution === ATTRIBUTION.DOWNSELL && deal.eligible) {
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
