export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { fetchAttributionDeals, enrichDealsWithCompanies } from "@/lib/hubspot/deals"
import { ATTRIBUTION, SALES_STAGES, SALES_STAGE_LABELS, CSM_TEAM, CHART_CSMS } from "@/lib/constants"
import { format, startOfMonth, subMonths, getQuarter, startOfQuarter } from "date-fns"
import type { Deal } from "@/lib/types"

const TIER_FALLBACK = "Non défini"
const OPEN_STAGE_IDS = [
  SALES_STAGES.DISCOVERY_CALL,
  SALES_STAGES.QUALIFIED_30,
  SALES_STAGES.EVALUATE_50,
  SALES_STAGES.OFFRE_ENVOYEE_70,
  SALES_STAGES.GO_VERBAL_80,
  SALES_STAGES.PAIEMENT_RECU,
  SALES_STAGES.PENDING,
  SALES_STAGES.UPSELL,
] as string[]

function monthKey(d: Date) { return format(d, "yyyy-MM") }
function monthLabel(d: Date) { return format(d, "MMM yy") }
function quarterKey(d: Date) { return `${d.getFullYear()}-Q${getQuarter(d)}` }

function csmShort(id: string | null): string {
  if (!id) return "Inconnu"
  const m = CSM_TEAM.find((c) => c.id === id)
  return m?.name.split(" ")[0] ?? "Inconnu"
}

function csmFull(id: string | null): string {
  if (!id) return "Inconnu"
  return CSM_TEAM.find((c) => c.id === id)?.name ?? "Inconnu"
}

function buildMonthBuckets(months: number) {
  const buckets: { key: string; label: string; date: Date }[] = []
  const now = new Date()
  for (let i = months - 1; i >= 0; i--) {
    const d = startOfMonth(subMonths(now, i))
    buckets.push({ key: monthKey(d), label: monthLabel(d), date: d })
  }
  return buckets
}

function buildQuarterBuckets(quarters: number) {
  const buckets: { key: string; label: string; date: Date }[] = []
  const now = new Date()
  let cursor = startOfQuarter(now)
  for (let i = 0; i < quarters; i++) {
    buckets.unshift({ key: quarterKey(cursor), label: `Q${getQuarter(cursor)} ${cursor.getFullYear()}`, date: cursor })
    cursor = subMonths(cursor, 3)
  }
  return buckets
}

export async function GET(request: NextRequest) {
  try {
    const months = parseInt(request.nextUrl.searchParams.get("months") ?? "12", 10)
    const csmId = request.nextUrl.searchParams.get("csmId") ?? undefined

    const dateFrom = format(startOfMonth(subMonths(new Date(), months - 1)), "yyyy-MM-dd")
    const dateTo = format(new Date(), "yyyy-MM-dd")

    const wonDeals = await fetchAttributionDeals([ATTRIBUTION.UPSELL], dateFrom, dateTo, csmId)
    const enriched = await enrichDealsWithCompanies(wonDeals)

    // For "open pipeline" + "created opportunities", fetch all upsell deals regardless of operationDate.
    // We reuse fetchAttributionDeals with a wide date range to capture both open and closed.
    const wideFrom = format(startOfMonth(subMonths(new Date(), 24)), "yyyy-MM-dd")
    const allUpsellDeals = await fetchAttributionDeals([ATTRIBUTION.UPSELL], wideFrom, dateTo, csmId)


    // Buckets
    const monthBuckets = buildMonthBuckets(months)
    const quarterBuckets = buildQuarterBuckets(Math.ceil(months / 3))

    // Toutes les transactions Upsell ayant une operationDate (date_de_prise_en_compte).
    // C'est la date d'effet réel de l'upsell — on ignore closeDate / createdAt en bucketing.
    const upsellByOpDate = enriched.filter((d) => !!d.operationDate)

    // === 1. Upsell par mois / CSM ===
    const monthCsm: Record<string, Record<string, number>> = {}
    for (const b of monthBuckets) monthCsm[b.key] = {}
    for (const d of upsellByOpDate) {
      const k = d.operationDate!.slice(0, 7)
      if (!monthCsm[k]) continue
      const csm = csmShort(d.ownerId)
      monthCsm[k][csm] = (monthCsm[k][csm] ?? 0) + d.amount
    }
    const byMonthCsm = monthBuckets.map((b) => ({
      monthLabel: b.label,
      ...monthCsm[b.key],
    }))

    // === 2. Upsell par trimestre ===
    const quarterTotal: Record<string, number> = {}
    for (const b of quarterBuckets) quarterTotal[b.key] = 0
    for (const d of upsellByOpDate) {
      const k = quarterKey(new Date(d.operationDate!))
      if (k in quarterTotal) quarterTotal[k] += d.amount
    }
    const byQuarter = quarterBuckets.map((b) => ({
      quarterLabel: b.label,
      Upsell: quarterTotal[b.key] ?? 0,
    }))

    // === 3. Upsell par mois (line, total) ===
    const byMonthTotal = monthBuckets.map((b) => {
      const total = Object.values(monthCsm[b.key] ?? {}).reduce((s, v) => s + v, 0)
      return { monthLabel: b.label, Upsell: total }
    })

    // === 4. Panier moyen ===
    const avgByMonth = monthBuckets.map((b) => {
      const dealsOfMonth = upsellByOpDate.filter((d) => {
        return d.operationDate!.slice(0, 7) === b.key
      })
      const avg = dealsOfMonth.length > 0
        ? dealsOfMonth.reduce((s, d) => s + d.amount, 0) / dealsOfMonth.length
        : 0
      return { monthLabel: b.label, Moyenne: Math.round(avg) }
    })
    const overallAvg = upsellByOpDate.length > 0
      ? Math.round(upsellByOpDate.reduce((s, d) => s + d.amount, 0) / upsellByOpDate.length)
      : 0

    // === 5. Tier breakdown (via deal→company association) ===
    const tierAgg: Record<string, { amount: number; count: number }> = {}
    for (const d of upsellByOpDate) {
      const tier = d.companyRevenueTier || TIER_FALLBACK
      if (!tierAgg[tier]) tierAgg[tier] = { amount: 0, count: 0 }
      tierAgg[tier].amount += d.amount
      tierAgg[tier].count += 1
    }
    const byTier = Object.entries(tierAgg)
      .map(([tier, v]) => ({ tier, ...v }))
      .sort((a, b) => b.amount - a.amount)

    // === 6. Conversion rate (won / created in period) ===
    const createdInPeriod = allUpsellDeals.filter((d) => {
      if (!d.createdAt) return false
      return d.createdAt.slice(0, 10) >= dateFrom
    })
    const wonInPeriod = allUpsellDeals.filter(isWon)
    const conversionRate = {
      created: createdInPeriod.length,
      won: wonInPeriod.length,
      rate: createdInPeriod.length > 0 ? (wonInPeriod.length / createdInPeriod.length) * 100 : 0,
    }

    // === 7. Pipe en cours par stage ===
    const openDeals = allUpsellDeals.filter((d) => OPEN_STAGE_IDS.includes(d.stage))
    const stageAgg: Record<string, { count: number; amount: number }> = {}
    for (const d of openDeals) {
      if (!stageAgg[d.stage]) stageAgg[d.stage] = { count: 0, amount: 0 }
      stageAgg[d.stage].count += 1
      stageAgg[d.stage].amount += d.amount
    }
    const pipelineByStage = OPEN_STAGE_IDS
      .map((stage) => ({
        stage,
        label: SALES_STAGE_LABELS[stage] ?? stage,
        count: stageAgg[stage]?.count ?? 0,
        amount: stageAgg[stage]?.amount ?? 0,
      }))
      .filter((s) => s.count > 0)

    // === 8. Opportunités créées par mois / CSM ===
    const createdByMonthCsm: Record<string, Record<string, number>> = {}
    for (const b of monthBuckets) createdByMonthCsm[b.key] = {}
    for (const d of allUpsellDeals) {
      if (!d.createdAt) continue
      const k = d.createdAt.slice(0, 7)
      if (!createdByMonthCsm[k]) continue
      const csm = csmShort(d.ownerId)
      createdByMonthCsm[k][csm] = (createdByMonthCsm[k][csm] ?? 0) + 1
    }
    const createdByMonth = monthBuckets.map((b) => ({
      monthLabel: b.label,
      ...createdByMonthCsm[b.key],
    }))

    // === 9. Flat deals list for the Liste tab ===
    const dealsList = enriched
      .sort((a, b) => (b.operationDate ?? "").localeCompare(a.operationDate ?? ""))
      .map((d) => ({
        id: d.id,
        name: d.name,
        companyName: d.companyName ?? "—",
        csmId: d.ownerId,
        csmName: csmFull(d.ownerId),
        amount: d.amount,
        operationDate: d.operationDate,
        paymentDate: d.paymentDate,
      }))

    return NextResponse.json({
      byMonthCsm,
      byQuarter,
      byMonthTotal,
      avgByMonth,
      overallAvg,
      byTier,
      conversionRate,
      pipelineByStage,
      createdByMonth,
      dealsList,
      csms: CHART_CSMS,
    })
  } catch (error) {
    console.error("Upsell analytics error:", error)
    return NextResponse.json(
      { error: "Failed to compute upsell analytics", details: String(error) },
      { status: 500 }
    )
  }
}

function isWon(d: Deal): boolean {
  return d.stage === SALES_STAGES.CLOSED_WON
}
