export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { fetchAttributionDeals, enrichDealsWithCompanies, fetchRenewalDeals } from "@/lib/hubspot/deals"
import { fetchCustomerCompanies } from "@/lib/hubspot/companies"
import { ATTRIBUTION, SALES_STAGES, CSM_TEAM, CHART_CSMS } from "@/lib/constants"
import { format, startOfMonth, subMonths, getQuarter, startOfQuarter, startOfWeek, addWeeks, addMonths } from "date-fns"
import type { Company } from "@/lib/types"

const TIER_FALLBACK = "Non défini"

// Match any value containing "risk" / "risque" (case-insensitive) so we tolerate
// HubSpot label variants like "At Risk", "À risque", "at_risk", "a_risque", etc.
function isAtRiskStrategy(strategy: string | null): boolean {
  if (!strategy) return false
  const s = strategy.toLowerCase()
  return s.includes("risk") || s.includes("risque")
}

function monthKey(d: Date) { return format(d, "yyyy-MM") }
function monthLabel(d: Date) { return format(d, "MMM yy") }
function quarterKey(d: Date) { return `${d.getFullYear()}-Q${getQuarter(d)}` }
function weekKey(d: Date) { return format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-'W'II") }
function weekLabel(d: Date) { return format(startOfWeek(d, { weekStartsOn: 1 }), "dd MMM") }

function csmShort(id: string | null): string {
  if (!id) return "Inconnu"
  const m = CSM_TEAM.find((c) => c.id === id)
  return m?.name.split(" ")[0] ?? "Inconnu"
}

function buildMonthBuckets(months: number) {
  const buckets: { key: string; label: string }[] = []
  const now = new Date()
  for (let i = months - 1; i >= 0; i--) {
    const d = startOfMonth(subMonths(now, i))
    buckets.push({ key: monthKey(d), label: monthLabel(d) })
  }
  return buckets
}

function buildQuarterBuckets(quarters: number) {
  const buckets: { key: string; label: string }[] = []
  const now = new Date()
  let cursor = startOfQuarter(now)
  for (let i = 0; i < quarters; i++) {
    buckets.unshift({ key: quarterKey(cursor), label: `Q${getQuarter(cursor)} ${cursor.getFullYear()}` })
    cursor = subMonths(cursor, 3)
  }
  return buckets
}

function buildWeekBuckets(weeks: number) {
  const buckets: { key: string; label: string }[] = []
  const now = new Date()
  let cursor = startOfWeek(now, { weekStartsOn: 1 })
  for (let i = 0; i < weeks; i++) {
    buckets.unshift({ key: weekKey(cursor), label: weekLabel(cursor) })
    cursor = addWeeks(cursor, -1)
  }
  return buckets
}

export async function GET(request: NextRequest) {
  try {
    const months = parseInt(request.nextUrl.searchParams.get("months") ?? "12", 10)
    const csmId = request.nextUrl.searchParams.get("csmId") ?? undefined

    const dateFrom = format(startOfMonth(subMonths(new Date(), months - 1)), "yyyy-MM-dd")
    const dateTo = format(new Date(), "yyyy-MM-dd")
    const wideFrom = format(startOfMonth(subMonths(new Date(), 24)), "yyyy-MM-dd")
    const forecastTo = format(addMonths(new Date(), 6), "yyyy-MM-dd")

    const [churnDeals, allCompaniesArr, allChurnDeals, upcomingRenewals] = await Promise.all([
      fetchAttributionDeals([ATTRIBUTION.CHURN], dateFrom, dateTo, csmId),
      fetchCustomerCompanies(),
      fetchAttributionDeals([ATTRIBUTION.CHURN], wideFrom, dateTo, csmId),
      fetchRenewalDeals(dateTo, forecastTo, csmId),
    ])
    const enriched = await enrichDealsWithCompanies(churnDeals)

    const companyTier = new Map<string, string>()
    for (const c of allCompaniesArr as Company[]) {
      companyTier.set(c.id, c.revenueTier ?? TIER_FALLBACK)
    }

    const monthBuckets = buildMonthBuckets(months)
    const quarterBuckets = buildQuarterBuckets(Math.ceil(months / 3))
    const weekBuckets = buildWeekBuckets(12)

    // === 1. Churn par mois / CSM ===
    const monthCsm: Record<string, Record<string, number>> = {}
    for (const b of monthBuckets) monthCsm[b.key] = {}
    for (const d of enriched) {
      const dt = d.closeDate ?? d.operationDate
      if (!dt) continue
      const k = dt.slice(0, 7)
      if (!monthCsm[k]) continue
      const csm = csmShort(d.ownerId)
      monthCsm[k][csm] = (monthCsm[k][csm] ?? 0) + d.amount
    }
    const byMonthCsm = monthBuckets.map((b) => ({ monthLabel: b.label, ...monthCsm[b.key] }))

    // === 2. Churn par trimestre / CSM ===
    const quarterCsm: Record<string, Record<string, number>> = {}
    for (const b of quarterBuckets) quarterCsm[b.key] = {}
    for (const d of enriched) {
      const dt = d.closeDate ?? d.operationDate
      if (!dt) continue
      const dateObj = new Date(dt)
      const k = quarterKey(dateObj)
      if (!quarterCsm[k]) continue
      const csm = csmShort(d.ownerId)
      quarterCsm[k][csm] = (quarterCsm[k][csm] ?? 0) + d.amount
    }
    const byQuarterCsm = quarterBuckets.map((b) => ({ quarterLabel: b.label, ...quarterCsm[b.key] }))

    // === 3. Churn par semaine / CSM ===
    const weekCsm: Record<string, Record<string, number>> = {}
    for (const b of weekBuckets) weekCsm[b.key] = {}
    for (const d of enriched) {
      const dt = d.closeDate ?? d.operationDate
      if (!dt) continue
      const k = weekKey(new Date(dt))
      if (!weekCsm[k]) continue
      const csm = csmShort(d.ownerId)
      weekCsm[k][csm] = (weekCsm[k][csm] ?? 0) + d.amount
    }
    const byWeekCsm = weekBuckets.map((b) => ({ weekLabel: b.label, ...weekCsm[b.key] }))

    // === 4. Tier breakdown ===
    const tierAgg: Record<string, { amount: number; count: number }> = {}
    for (const d of enriched) {
      const tier = (d.companyId && companyTier.get(d.companyId)) || TIER_FALLBACK
      if (!tierAgg[tier]) tierAgg[tier] = { amount: 0, count: 0 }
      tierAgg[tier].amount += d.amount
      tierAgg[tier].count += 1
    }
    const byTier = Object.entries(tierAgg)
      .map(([tier, v]) => ({ tier, ...v }))
      .sort((a, b) => b.amount - a.amount)

    // === 5. Forecast churn ===
    // Open churn deals already created (not yet closed-won) — they represent likely future churn.
    const openChurnDeals = allChurnDeals.filter((d) => d.stage !== SALES_STAGES.CLOSED_WON && d.stage !== SALES_STAGES.CLOSED_LOST)
    const openChurnAmount = openChurnDeals.reduce((s, d) => s + d.amount, 0)

    // At-risk renewals: renewal deals tagged with renewall_strategy = "at risk"
    const atRiskRenewals = upcomingRenewals.filter((d) => isAtRiskStrategy(d.renewalStrategy))
    const atRiskAmount = atRiskRenewals.reduce((s, d) => s + d.amount, 0)

    // Forecast by month (next 6 months) — combine open churn deals (use closeDate if set, else month from createdAt+30d)
    // and at-risk renewals (use renewalDate)
    const forecastBuckets: { key: string; label: string }[] = []
    const now = new Date()
    for (let i = 0; i < 6; i++) {
      const d = startOfMonth(addMonths(now, i))
      forecastBuckets.push({ key: monthKey(d), label: monthLabel(d) })
    }
    const forecastByMonth: Record<string, { openChurn: number; atRisk: number }> = {}
    for (const b of forecastBuckets) forecastByMonth[b.key] = { openChurn: 0, atRisk: 0 }

    for (const d of openChurnDeals) {
      const dt = d.closeDate ?? d.operationDate
      if (!dt) continue
      const k = dt.slice(0, 7)
      if (forecastByMonth[k]) forecastByMonth[k].openChurn += d.amount
    }
    for (const d of atRiskRenewals) {
      if (!d.renewalDate) continue
      const k = d.renewalDate.slice(0, 7)
      if (forecastByMonth[k]) forecastByMonth[k].atRisk += d.amount
    }
    const forecast = forecastBuckets.map((b) => ({
      monthLabel: b.label,
      "Churn ouvert": forecastByMonth[b.key].openChurn,
      "Renouvellement à risque": forecastByMonth[b.key].atRisk,
    }))

    return NextResponse.json({
      byMonthCsm,
      byQuarterCsm,
      byWeekCsm,
      byTier,
      forecast,
      summary: {
        totalChurn: enriched.reduce((s, d) => s + d.amount, 0),
        churnCount: enriched.length,
        openChurnAmount,
        openChurnCount: openChurnDeals.length,
        atRiskAmount,
        atRiskCount: atRiskRenewals.length,
      },
      csms: CHART_CSMS,
    })
  } catch (error) {
    console.error("Churn analytics error:", error)
    return NextResponse.json(
      { error: "Failed to compute churn analytics", details: String(error) },
      { status: 500 }
    )
  }
}
