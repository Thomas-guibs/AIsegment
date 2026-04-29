export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { listEnrichments } from "@/lib/enrichment/storage"
import { fetchCustomerCompanies } from "@/lib/hubspot/companies"
import { getCsmName, CSM_TEAM_IDS } from "@/lib/constants"

interface FlattenedSignal {
  parentCompanyId: string
  parentName: string
  parentMrr: number
  parentCsmId: string | null
  parentCsmName: string | null
  enrichedAt: string

  siblingName: string
  siblingSiren: string
  domain: string | null
  isClient: boolean
  isEcommerce: boolean
  platform: string | null
  fit: "strong" | "partial" | "none" | null
  icpScore: number
  icpSignals: string[]
  role: string | null
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const csmId = sp.get("csmId")
    const minScore = parseInt(sp.get("minScore") ?? "0", 10)
    const platform = sp.get("platform")
    const ecommerceOnly = sp.get("ecommerceOnly") === "true"

    const [stored, customers] = await Promise.all([
      listEnrichments(),
      fetchCustomerCompanies().catch(() => []),
    ])

    // Filter enrichments by CSM if requested
    const scopedEnrichments = csmId
      ? stored.filter((e) => e.parentCsmId === csmId)
      : stored

    // Flatten sibling brands across all enrichments (skip excluded)
    let signals: FlattenedSignal[] = []
    for (const enr of scopedEnrichments) {
      for (const sib of enr.signals.siblingBrands) {
        if (sib.excluded) continue
        signals.push({
          parentCompanyId: enr.companyId,
          parentName: enr.parentName,
          parentMrr: enr.parentMrr,
          parentCsmId: enr.parentCsmId,
          parentCsmName: enr.parentCsmId ? getCsmName(enr.parentCsmId) : null,
          enrichedAt: enr.enrichedAt,
          siblingName: sib.name,
          siblingSiren: sib.siren,
          domain: sib.domain ?? null,
          isClient: sib.isClient,
          isEcommerce: sib.isEcommerce ?? false,
          platform: sib.platform ?? null,
          fit: sib.fit ?? null,
          icpScore: sib.icpScore ?? 0,
          icpSignals: sib.icpSignals ?? [],
          role: sib.role ?? null,
        })
      }
    }

    // Apply user filters
    if (minScore > 0) signals = signals.filter((s) => s.icpScore >= minScore)
    if (platform) signals = signals.filter((s) => s.platform === platform)
    if (ecommerceOnly) signals = signals.filter((s) => s.isEcommerce)

    // Sort by ICP score descending, then by parent MRR descending
    signals.sort((a, b) => {
      if (b.icpScore !== a.icpScore) return b.icpScore - a.icpScore
      return b.parentMrr - a.parentMrr
    })

    // KPIs (computed BEFORE the user filters so the cards show portfolio totals)
    const allSignalsForKpis = scopedEnrichments
      .flatMap((e) => e.signals.siblingBrands.filter((s) => !s.excluded))

    const totalSignals = allSignalsForKpis.length
    const hot = allSignalsForKpis.filter((s) => (s.icpScore ?? 0) >= 70).length
    const warm = allSignalsForKpis.filter((s) => {
      const sc = s.icpScore ?? 0
      return sc >= 40 && sc < 70
    }).length
    const cold = allSignalsForKpis.filter((s) => (s.icpScore ?? 0) < 40).length
    const ecommerceConfirmed = allSignalsForKpis.filter((s) => s.isEcommerce).length

    // Pending count: customers in scope that haven't been enriched yet
    const enrichedIds = new Set(stored.map((s) => s.companyId))
    const scopedCustomers = csmId
      ? customers.filter((c) => c.ownerId === csmId)
      : customers
    const pendingCompanies = scopedCustomers.filter((c) => !enrichedIds.has(c.id) && c.domain).length
    const enrichedCompanies = scopedEnrichments.length

    return NextResponse.json({
      kpis: {
        totalSignals,
        hot,
        warm,
        cold,
        ecommerceConfirmed,
        enrichedCompanies,
        pendingCompanies,
      },
      signals: signals.slice(0, 200),
      availableCsms: CSM_TEAM_IDS,
    })
  } catch (error) {
    console.error("Upsell signals API error:", error)
    return NextResponse.json({ error: "Failed to load signals", details: String(error).slice(0, 500) }, { status: 500 })
  }
}
