export const dynamic = "force-dynamic"

// =============================================================================
// Dashboard — table centrale (NRR / GRR / Upsell / Churn / Downsell / Renew)
// Spec CALCUL.md §3 §4 §5 §6 (strict) + §9 diagnostics.
// =============================================================================

import { NextRequest, NextResponse } from "next/server"
import { fetchCustomerCompanies } from "@/lib/hubspot/companies"
import {
  fetchAttributionDeals,
  enrichDealsWithCompanies,
  fetchRenewalDeals,
} from "@/lib/hubspot/deals"
import { fetchCompanyHistoryBatch } from "@/lib/hubspot/history"
import type { Deal } from "@/lib/types"
import {
  ATTRIBUTION,
  CSM_TEAM,
  CHART_CSMS,
  SALES_STAGES,
  isRetainedMovement,
  movementDateFor,
  normalizeCountry,
  normalizeTier,
  type CalcMethod,
  type Country,
  COUNTRIES,
} from "@/lib/constants"
import {
  earliestPaymentByCompany,
  dealsByCompany,
  mrrUnderManagement,
  ownerAtMonthStart,
  monthlyNrr,
  firstOfMonthUTC,
  newDiagnostics,
  type Diagnostics,
} from "@/lib/analytics/portfolio"
import {
  startOfMonth,
  subMonths,
  endOfMonth,
  format,
  getQuarter,
  startOfQuarter,
  startOfYear,
  endOfQuarter,
  endOfYear,
} from "date-fns"

type PeriodType = "month" | "quarter" | "year"

interface Period {
  key: string
  label: string
  startIso: string
  start: Date
  end: Date
}

interface Cell {
  value: number
  volume?: number
  pct?: number
  dealIds: string[]
}

interface Row {
  id: string
  label: string
  perPeriod: Record<string, Cell>
}

interface MetricGroup {
  total: Row
  byCsm: Row[]
  byTier: Row[]
  byCountry: Row[]
}

interface DealBrief {
  id: string
  name: string
  companyName: string
  csmName: string
  amount: number
  attribution: string
  stage: string
  operationDate: string | null
  paymentDate: string | null
  renewalDate: string | null
  country: string | null
  tier: string | null
}

function buildPeriods(periodType: PeriodType, months: number): Period[] {
  const now = new Date()
  const periods: Period[] = []
  if (periodType === "month") {
    for (let i = months - 1; i >= 0; i--) {
      const md = subMonths(now, i)
      const start = startOfMonth(md)
      const end = endOfMonth(md)
      periods.push({
        key: format(start, "yyyy-MM"),
        label: format(start, "MMM yy"),
        startIso: firstOfMonthUTC(start.getFullYear(), start.getMonth() + 1),
        start,
        end,
      })
    }
  } else if (periodType === "quarter") {
    const quarters = Math.max(2, Math.ceil(months / 3))
    for (let i = quarters - 1; i >= 0; i--) {
      const qd = subMonths(now, i * 3)
      const start = startOfQuarter(qd)
      const end = endOfQuarter(qd)
      periods.push({
        key: `${start.getFullYear()}-Q${getQuarter(start)}`,
        label: `Q${getQuarter(start)} ${start.getFullYear()}`,
        startIso: new Date(Date.UTC(start.getFullYear(), start.getMonth(), 1)).toISOString(),
        start,
        end,
      })
    }
  } else {
    const years = Math.max(1, Math.ceil(months / 12))
    for (let i = years - 1; i >= 0; i--) {
      const yd = subMonths(now, i * 12)
      const start = startOfYear(yd)
      const end = endOfYear(yd)
      periods.push({
        key: String(start.getFullYear()),
        label: String(start.getFullYear()),
        startIso: new Date(Date.UTC(start.getFullYear(), 0, 1)).toISOString(),
        start,
        end,
      })
    }
  }
  return periods
}

function periodKeyForDate(iso: string, periodType: PeriodType): string {
  const d = new Date(iso)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  if (periodType === "month") return `${y}-${String(m).padStart(2, "0")}`
  if (periodType === "quarter") return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
  return String(y)
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const periodType = (sp.get("periodType") ?? "month") as PeriodType
    const calcMethod = (sp.get("calcMethod") ?? "billed") as CalcMethod
    const months = parseInt(sp.get("months") ?? "12", 10)

    const periods = buildPeriods(periodType, months)
    const rangeStart = periods[0].start
    const rangeEnd = periods[periods.length - 1].end

    const wideFrom = "2010-01-01"
    const wideTo = format(new Date(), "yyyy-MM-dd")

    const [activeCompanies, allAttributedDealsRaw, renewalDealsRaw] = await Promise.all([
      fetchCustomerCompanies(),
      fetchAttributionDeals(
        [
          ATTRIBUTION.UPSELL,
          ATTRIBUTION.CHURN,
          ATTRIBUTION.DOWNSELL,
          ATTRIBUTION.PARTNERS,
          ATTRIBUTION.HUNT,
          ATTRIBUTION.INBOUND,
          ATTRIBUTION.PAID,
          ATTRIBUTION.EVENT,
          ATTRIBUTION.PLG,
        ],
        wideFrom,
        wideTo
      ),
      fetchRenewalDeals(format(rangeStart, "yyyy-MM-dd"), format(rangeEnd, "yyyy-MM-dd")),
    ])
    const allDeals = await enrichDealsWithCompanies(allAttributedDealsRaw)
    const renewalDeals = await enrichDealsWithCompanies(renewalDealsRaw)

    const companyIdSet = new Set<string>()
    for (const c of activeCompanies) companyIdSet.add(c.id)
    for (const d of allDeals) if (d.companyId) companyIdSet.add(d.companyId)
    for (const d of renewalDeals) if (d.companyId) companyIdSet.add(d.companyId)
    const historyMap = await fetchCompanyHistoryBatch(Array.from(companyIdSet))
    const historyList = Array.from(historyMap.values())
    const earliestPayment = earliestPaymentByCompany(allDeals)
    const companyDealsMap = dealsByCompany(allDeals)

    const companyMeta = new Map<
      string,
      { tier: string | null; country: Country | null }
    >()
    for (const c of activeCompanies) {
      companyMeta.set(c.id, {
        tier: normalizeTier(c.revenueTier),
        country: normalizeCountry(c.country),
      })
    }
    for (const d of [...allDeals, ...renewalDeals]) {
      if (!d.companyId) continue
      if (!companyMeta.has(d.companyId)) {
        companyMeta.set(d.companyId, {
          tier: normalizeTier(d.companyRevenueTier ?? null),
          country: normalizeCountry(d.companyCountry ?? null),
        })
      }
    }

    const dealsMap: Record<string, DealBrief> = {}
    const briefOf = (d: Deal): DealBrief => {
      const meta = d.companyId ? companyMeta.get(d.companyId) : undefined
      return {
        id: d.id,
        name: d.name,
        companyName: d.companyName ?? "—",
        csmName: csmFull(d.ownerId),
        amount: d.amount,
        attribution: d.attribution ?? "",
        stage: d.stage,
        operationDate: d.operationDate,
        paymentDate: d.paymentDate,
        renewalDate: d.renewalDate,
        country: meta?.country ?? null,
        tier: meta?.tier ?? null,
      }
    }

    // MRR under management per (CSM|tier|country, period start)
    const mrrByPeriod = new Map<string, {
      total: number
      byCsm: Map<string, number>
      byTier: Map<string, number>
      byCountry: Map<string, number>
      passedCount: number
    }>()
    // Diagnostics (spec §9) — collected on the latest period only.
    const latestPeriodKey = periods[periods.length - 1].key
    const diagnosticsByPeriod = new Map<string, Diagnostics>()
    for (const p of periods) {
      const bucket = {
        total: 0,
        byCsm: new Map<string, number>(),
        byTier: new Map<string, number>(),
        byCountry: new Map<string, number>(),
        passedCount: 0,
      }
      const diag = newDiagnostics()
      const contribs = mrrUnderManagement(
        historyList,
        earliestPayment,
        companyDealsMap,
        p.startIso,
        undefined,
        diag
      )
      diagnosticsByPeriod.set(p.key, diag)
      bucket.passedCount = contribs.length
      for (const c of contribs) {
        bucket.total += c.mrr
        bucket.byCsm.set(c.csm, (bucket.byCsm.get(c.csm) ?? 0) + c.mrr)
        const meta = companyMeta.get(c.companyId)
        if (meta?.tier) bucket.byTier.set(meta.tier, (bucket.byTier.get(meta.tier) ?? 0) + c.mrr)
        if (meta?.country) bucket.byCountry.set(meta.country, (bucket.byCountry.get(meta.country) ?? 0) + c.mrr)
      }
      mrrByPeriod.set(p.key, bucket)
    }

    interface Agg {
      value: number
      volume: number
      dealIds: string[]
    }
    const newAgg = (): Agg => ({ value: 0, volume: 0, dealIds: [] })

    type DimensionsMap = Map<string, Map<string, Agg>>
    const acc = new Map<string, DimensionsMap>([
      ["upsell", new Map()],
      ["churn", new Map()],
      ["downsell", new Map()],
      ["renewDue", new Map()],
      ["renewWon", new Map()],
    ])

    const bumpAgg = (
      metric: string,
      dim: string,
      periodKey: string,
      amount: number,
      dealId: string
    ) => {
      const dims = acc.get(metric)!
      if (!dims.has(dim)) dims.set(dim, new Map())
      const perDim = dims.get(dim)!
      if (!perDim.has(periodKey)) perDim.set(periodKey, newAgg())
      const a = perDim.get(periodKey)!
      a.value += amount
      a.volume += 1
      a.dealIds.push(dealId)
    }

    // Upsell / Churn / Downsell (spec §5)
    for (const deal of allDeals) {
      if (!isRetainedMovement(deal)) continue
      const attr = deal.attribution
      const dt = movementDateFor(deal, calcMethod)
      if (!dt) continue
      const pk = periodKeyForDate(new Date(dt).toISOString(), periodType)
      if (!periods.some((p) => p.key === pk)) continue

      const amt = Math.abs(deal.amount)
      const csm = ownerAtMonthStart(deal, deal.companyId ? historyMap.get(deal.companyId) : undefined)
      const meta = deal.companyId ? companyMeta.get(deal.companyId) : undefined

      const metricKey = attr === ATTRIBUTION.UPSELL ? "upsell"
        : attr === ATTRIBUTION.CHURN ? "churn"
        : attr === ATTRIBUTION.DOWNSELL ? "downsell"
        : null
      if (!metricKey) continue

      dealsMap[deal.id] = briefOf(deal)
      bumpAgg(metricKey, "total", pk, amt, deal.id)
      if (csm) bumpAgg(metricKey, `csm:${csm}`, pk, amt, deal.id)
      if (meta?.tier) bumpAgg(metricKey, `tier:${meta.tier}`, pk, amt, deal.id)
      if (meta?.country) bumpAgg(metricKey, `country:${meta.country}`, pk, amt, deal.id)
    }

    // Renewals — bucket by renewalDate, "won" if stage is a retained "won" stage
    const RENEW_WON_STAGES = new Set<string>([SALES_STAGES.CLOSED_WON, SALES_STAGES.PAIEMENT_RECU])
    for (const deal of renewalDeals) {
      if (!deal.renewalDate) continue
      const pk = periodKeyForDate(new Date(deal.renewalDate).toISOString(), periodType)
      if (!periods.some((p) => p.key === pk)) continue

      const amt = Math.abs(deal.amount)
      const csm = ownerAtMonthStart(deal, deal.companyId ? historyMap.get(deal.companyId) : undefined)
      const meta = deal.companyId ? companyMeta.get(deal.companyId) : undefined

      dealsMap[deal.id] = briefOf(deal)

      bumpAgg("renewDue", "total", pk, amt, deal.id)
      if (csm) bumpAgg("renewDue", `csm:${csm}`, pk, amt, deal.id)
      if (meta?.tier) bumpAgg("renewDue", `tier:${meta.tier}`, pk, amt, deal.id)
      if (meta?.country) bumpAgg("renewDue", `country:${meta.country}`, pk, amt, deal.id)

      if (RENEW_WON_STAGES.has(deal.stage)) {
        bumpAgg("renewWon", "total", pk, amt, deal.id)
        if (csm) bumpAgg("renewWon", `csm:${csm}`, pk, amt, deal.id)
        if (meta?.tier) bumpAgg("renewWon", `tier:${meta.tier}`, pk, amt, deal.id)
        if (meta?.country) bumpAgg("renewWon", `country:${meta.country}`, pk, amt, deal.id)
      }
    }

    const getAgg = (metric: string, dim: string, pk: string): Agg => {
      const dims = acc.get(metric)
      const perDim = dims?.get(dim)
      return perDim?.get(pk) ?? newAgg()
    }

    const startingMrr = (pk: string, dim: string): number => {
      const b = mrrByPeriod.get(pk)
      if (!b) return 0
      if (dim === "total") return b.total
      if (dim.startsWith("csm:")) return b.byCsm.get(dim.slice(4)) ?? 0
      if (dim.startsWith("tier:")) return b.byTier.get(dim.slice(5)) ?? 0
      if (dim.startsWith("country:")) return b.byCountry.get(dim.slice(8)) ?? 0
      return 0
    }

    const nrrRow = (dim: string, id: string, label: string): Row => {
      const perPeriod: Record<string, Cell> = {}
      for (const p of periods) {
        const start = startingMrr(p.key, dim)
        const up = getAgg("upsell", dim, p.key)
        const ch = getAgg("churn", dim, p.key)
        const dn = getAgg("downsell", dim, p.key)
        const nrr = monthlyNrr(start, up.value, ch.value, dn.value)
        perPeriod[p.key] = {
          value: nrr ?? 0,
          pct: nrr ?? undefined,
          dealIds: [...up.dealIds, ...ch.dealIds, ...dn.dealIds],
        }
      }
      return { id, label, perPeriod }
    }
    const grrRow = (dim: string, id: string, label: string): Row => {
      const perPeriod: Record<string, Cell> = {}
      for (const p of periods) {
        const start = startingMrr(p.key, dim)
        const ch = getAgg("churn", dim, p.key)
        const dn = getAgg("downsell", dim, p.key)
        const grr = start > 0 ? ((start - ch.value - dn.value) / start) * 100 : null
        perPeriod[p.key] = {
          value: grr ?? 0,
          pct: grr ?? undefined,
          dealIds: [...ch.dealIds, ...dn.dealIds],
        }
      }
      return { id, label, perPeriod }
    }
    const movementRow = (metric: string, dim: string, id: string, label: string): Row => {
      const perPeriod: Record<string, Cell> = {}
      for (const p of periods) {
        const a = getAgg(metric, dim, p.key)
        perPeriod[p.key] = { value: a.value, volume: a.volume, dealIds: a.dealIds }
      }
      return { id, label, perPeriod }
    }
    const renewRow = (dim: string, id: string, label: string): Row => {
      const perPeriod: Record<string, Cell> = {}
      for (const p of periods) {
        const due = getAgg("renewDue", dim, p.key)
        const won = getAgg("renewWon", dim, p.key)
        const pct = due.value > 0 ? (won.value / due.value) * 100 : null
        perPeriod[p.key] = {
          value: won.value,
          volume: won.volume,
          pct: pct ?? undefined,
          dealIds: due.dealIds,
        }
      }
      return { id, label, perPeriod }
    }

    const discoveredTiers = new Set<string>()
    companyMeta.forEach((meta) => {
      if (meta.tier) discoveredTiers.add(meta.tier)
    })
    const tierList = Array.from(discoveredTiers).sort()

    const firstNameCounts = new Map<string, number>()
    for (const c of CHART_CSMS) {
      const first = c.name.split(" ")[0]
      firstNameCounts.set(first, (firstNameCounts.get(first) ?? 0) + 1)
    }
    const csmLabel = (fullName: string): string => {
      const parts = fullName.split(" ")
      const first = parts[0]
      if ((firstNameCounts.get(first) ?? 0) > 1 && parts.length > 1) {
        return `${first} ${parts[parts.length - 1][0]}.`
      }
      return first
    }

    const buildDimensionRows = (
      builder: (dim: string, id: string, label: string) => Row
    ): { byCsm: Row[]; byTier: Row[]; byCountry: Row[] } => {
      const byCsm = CHART_CSMS.map((c) => {
        const csmId = CSM_TEAM.find((t) => t.name === c.name)?.id
        return csmId ? builder(`csm:${csmId}`, csmId, csmLabel(c.name)) : null
      }).filter(Boolean) as Row[]
      const byTier = tierList.map((t) => builder(`tier:${t}`, t, t))
      const byCountry = COUNTRIES.map((c) => builder(`country:${c}`, c, c))
      return { byCsm, byTier, byCountry }
    }

    const buildMetric = (
      builder: (dim: string, id: string, label: string) => Row
    ): MetricGroup => ({
      total: builder("total", "total", "Total"),
      ...buildDimensionRows(builder),
    })

    const metrics = {
      nrr: buildMetric(nrrRow),
      grr: buildMetric(grrRow),
      upsell: buildMetric((dim, id, label) => movementRow("upsell", dim, id, label)),
      churn: buildMetric((dim, id, label) => movementRow("churn", dim, id, label)),
      downsell: buildMetric((dim, id, label) => movementRow("downsell", dim, id, label)),
      renew: buildMetric(renewRow),
    }

    // Diagnostics summary for the latest period (spec §9).
    const latestDiag = diagnosticsByPeriod.get(latestPeriodKey) ?? newDiagnostics()
    const latestBucket = mrrByPeriod.get(latestPeriodKey)
    const diagnostics = {
      period: latestPeriodKey,
      totalConsidered: historyList.length,
      totalCustomers: activeCompanies.length,
      passed: latestBucket?.passedCount ?? 0,
      mrrTotal: Math.round((latestBucket?.total ?? 0) * 100) / 100,
      excludedNoCsm: latestDiag.excludedNoCsm.length,
      excludedZeroMrr: latestDiag.excludedZeroMrr.length,
      excludedNoBilling: latestDiag.excludedNoBilling.length,
      excludedExited: latestDiag.excludedExited.length,
      accountsWithoutBilling: latestDiag.accountsWithoutBilling.length,
      accountsExitedByPhaseOnly: latestDiag.accountsExitedByPhaseOnly.length,
      accountsRetainedWithChurn: latestDiag.accountsRetainedWithChurn.length,
      accountsInvisibleTruncatedHistory: latestDiag.accountsInvisibleTruncatedHistory.length,
      accountsMrrFromDeals: latestDiag.accountsMrrFromDeals.length,
    }

    return NextResponse.json({
      periods: periods.map((p) => ({ key: p.key, label: p.label, startIso: p.startIso })),
      periodType,
      calcMethod,
      metrics,
      deals: dealsMap,
      diagnostics,
    })
  } catch (error) {
    console.error("Dashboard API error:", error)
    return NextResponse.json(
      { error: "Failed to compute dashboard", details: String(error) },
      { status: 500 }
    )
  }
}

function csmFull(id: string | null): string {
  if (!id) return "—"
  return CSM_TEAM.find((c) => c.id === id)?.name ?? "—"
}
