"use client"

import { Suspense, useMemo, useState } from "react"
import { Header } from "@/components/layout/Header"
import { useFetch } from "@/lib/hooks"
import { ErrorState } from "@/components/ui/ErrorState"
import { formatCurrency, formatDateFR, cn } from "@/lib/utils"
import { ChevronDown, ChevronRight, X } from "lucide-react"

type PeriodType = "month" | "quarter" | "year"
type CalcMethod = "booked" | "billed"
type MetricKey = "mrr" | "nrr" | "grr" | "upsell" | "churn" | "downsell" | "renew"

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

interface Diagnostics {
  period: string
  totalConsidered: number
  totalCustomers: number
  passed: number
  mrrTotal: number
  customerPassed: number
  customerMrrTotal: number
  customerExcludedNoCsm: number
  customerExcludedPhase: number
  customerExcludedZeroMrr: number
  customerNoPaidDeals: number
  dealsWithoutCompany: number
  dealsTotal: number
  paidDealsWithoutCompany: number
  paidDealsTotal: number
  excludedNoCsm: number
  excludedPhase: number
  excludedZeroMrr: number
  accountsNoPaidDeals: number
  accountsInvisibleTruncatedHistory: number
}

interface DashboardResponse {
  periods: Array<{ key: string; label: string; startIso: string }>
  periodType: PeriodType
  calcMethod: CalcMethod
  metrics: Record<MetricKey, MetricGroup>
  deals: Record<string, DealBrief>
  diagnostics?: Diagnostics
}

interface MetricSpec {
  key: MetricKey
  label: string
  format: "pct" | "eur"
  color?: string
}

const METRICS: MetricSpec[] = [
  { key: "mrr", label: "MRR sous gestion (1er du mois)", format: "eur" },
  { key: "nrr", label: "NRR", format: "pct" },
  { key: "grr", label: "GRR", format: "pct" },
  { key: "upsell", label: "Upsell", format: "eur", color: "text-positive" },
  { key: "churn", label: "Churn", format: "eur", color: "text-negative" },
  { key: "downsell", label: "Downsell", format: "eur", color: "text-warning" },
  { key: "renew", label: "Renouvellement", format: "pct" },
]

function fmtValue(cell: Cell, spec: MetricSpec): string {
  if (spec.format === "pct") {
    if (cell.pct === undefined || cell.pct === null) return "—"
    return `${cell.pct.toFixed(1)}%`
  }
  return formatCurrency(cell.value, true)
}

function DashboardContent() {
  const [periodType, setPeriodType] = useState<PeriodType>("month")
  const [calcMethod, setCalcMethod] = useState<CalcMethod>("billed")
  const [expanded, setExpanded] = useState<Set<MetricKey>>(new Set())
  const [drawer, setDrawer] = useState<{ title: string; dealIds: string[] } | null>(null)

  const fetchParams = useMemo(
    () => ({ periodType, calcMethod, months: "12" }),
    [periodType, calcMethod]
  )
  const { data, loading, error, refetch } = useFetch<DashboardResponse>("/api/dashboard", fetchParams)

  const periodsReversed = useMemo(() => (data?.periods ?? []).slice().reverse(), [data?.periods])

  const toggleMetric = (k: MetricKey) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  const openDrawer = (title: string, dealIds: string[]) => setDrawer({ title, dealIds })

  if (error && !loading) {
    return <div className="p-6"><ErrorState message="Impossible de charger le dashboard" onRetry={refetch} /></div>
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Période:</span>
          <div className="flex items-center gap-1 bg-card rounded-lg p-0.5 border border-card-border">
            {(["month", "quarter", "year"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriodType(p)}
                className={cn(
                  "px-3 py-1.5 text-xs rounded-md transition-colors font-medium",
                  periodType === p ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"
                )}
              >
                {p === "month" ? "Mois" : p === "quarter" ? "Trimestre" : "Année"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Méthode:</span>
          <div className="flex items-center gap-1 bg-card rounded-lg p-0.5 border border-card-border">
            {(["billed", "booked"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setCalcMethod(m)}
                className={cn(
                  "px-3 py-1.5 text-xs rounded-md transition-colors font-medium",
                  calcMethod === m ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"
                )}
                title={
                  m === "billed"
                    ? "Upsell par date de paiement, Churn/Downsell par operation date"
                    : "Tous les mouvements par operation date"
                }
              >
                {m === "billed" ? "Billed" : "Booked"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {data?.diagnostics && <DiagnosticsBanner d={data.diagnostics} />}

      {loading || !data ? (
        <div className="card skeleton h-[500px]" />
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] tabular-nums border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="text-left px-3 py-2 text-2xs font-medium uppercase tracking-wide text-text-muted sticky left-0 top-0 bg-card z-20 min-w-[200px] border-b border-card-border">
                    Métrique
                  </th>
                  {periodsReversed.map((p, i) => (
                    <th
                      key={p.key}
                      className={cn(
                        "text-right px-3 py-2 text-2xs font-medium uppercase tracking-wide whitespace-nowrap sticky top-0 bg-card z-10 border-b border-card-border",
                        i === 0 ? "text-text-primary bg-accent/5" : "text-text-muted"
                      )}
                    >
                      {p.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map((spec) => {
                  const group = data.metrics?.[spec.key]
                  if (!group) return null
                  return (
                    <MetricRows
                      key={spec.key}
                      spec={spec}
                      group={group}
                      periods={periodsReversed}
                      expanded={expanded.has(spec.key)}
                      onToggle={() => toggleMetric(spec.key)}
                      onOpenDrawer={openDrawer}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {drawer && data && (
        <Drawer
          title={drawer.title}
          deals={drawer.dealIds.map((id) => data.deals[id]).filter(Boolean)}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// DiagnosticsBanner — spec §9 signals for the latest period
// Explains WHY companies were excluded from MRR sous gestion.
// -----------------------------------------------------------------------------
function DiagnosticsBanner({ d }: { d: Diagnostics }) {
  const anyIssue =
    d.customerExcludedNoCsm > 0 ||
    d.customerExcludedPhase > 0 ||
    d.customerExcludedZeroMrr > 0 ||
    d.accountsInvisibleTruncatedHistory > 0 ||
    d.dealsWithoutCompany > 0 ||
    d.paidDealsWithoutCompany > 0
  if (!anyIssue) return null

  const mrrLabel = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(d.customerMrrTotal)
  return (
    <details className="card p-3 text-xs">
      <summary className="cursor-pointer text-text-secondary font-medium">
        Diagnostics — {d.customerPassed}/{d.totalCustomers} clients retenus · {mrrLabel} € de MRR sous gestion
        <span className="text-text-muted ml-2">
          ({d.passed} au total sur {d.totalConsidered} évalués)
        </span>
      </summary>
      <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-text-muted">
        <DiagRow label="Clients — CSM inconnu à T" value={d.customerExcludedNoCsm} />
        <DiagRow label="Clients — Phase hors périmètre à T" value={d.customerExcludedPhase} />
        <DiagRow label="Clients — Σ paiement reçu ≤ 0" value={d.customerExcludedZeroMrr} />
        <DiagRow label="Clients — Aucune transaction payée" value={d.customerNoPaidDeals} />
        <DiagRow label="Tout — CSM inconnu à T" value={d.excludedNoCsm} />
        <DiagRow label="Tout — Phase hors périmètre à T" value={d.excludedPhase} />
        <DiagRow label="Tout — Σ paiement reçu ≤ 0" value={d.excludedZeroMrr} />
        <DiagRow label="Tout — Aucune transaction payée" value={d.accountsNoPaidDeals} />
        {d.accountsInvisibleTruncatedHistory > 0 && (
          <DiagRow label="⚠ CSM pris sur le 1er historique (§2)" value={d.accountsInvisibleTruncatedHistory} />
        )}
        {d.paidDealsWithoutCompany > 0 && (
          <DiagRow
            label={`⚠ Paiements reçus sans company (sur ${d.paidDealsTotal})`}
            value={d.paidDealsWithoutCompany}
          />
        )}
        {d.dealsWithoutCompany > 0 && (
          <DiagRow
            label={`⚠ Mouvements sans company (sur ${d.dealsTotal})`}
            value={d.dealsWithoutCompany}
          />
        )}
      </div>
    </details>
  )
}

function DiagRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate">{label}</span>
      <span className="font-mono text-text-primary">{value}</span>
    </div>
  )
}

function MetricRows({
  spec,
  group,
  periods,
  expanded,
  onToggle,
  onOpenDrawer,
}: {
  spec: MetricSpec
  group: MetricGroup
  periods: Array<{ key: string; label: string }>
  expanded: boolean
  onToggle: () => void
  onOpenDrawer: (title: string, dealIds: string[]) => void
}) {
  type Kind = "total" | "csm" | "tier" | "country"
  const GROUP_TAG: Record<Kind, string> = { total: "", csm: "CSM", tier: "Tier", country: "Pays" }
  const rows: Array<{ row: Row; kind: Kind; firstOfGroup: boolean }> = []
  rows.push({ row: group.total, kind: "total", firstOfGroup: false })
  if (expanded) {
    const push = (list: Row[], kind: Kind) =>
      list.forEach((r, i) => rows.push({ row: r, kind, firstOfGroup: i === 0 }))
    push(group.byCsm, "csm")
    push(group.byTier, "tier")
    push(group.byCountry, "country")
  }

  // Threshold colouring for retention ratios: ≥100 % positive, 95–100 warning, <95 negative.
  const pctTone = (pct: number | undefined): string => {
    if (pct === undefined || pct === null) return "text-text-muted"
    if (spec.key === "renew") return pct >= 50 ? "text-positive" : "text-warning"
    if (pct >= 100) return "text-positive"
    if (pct >= 95) return "text-warning"
    return "text-negative"
  }

  return (
    <>
      {rows.map((entry, idx) => {
        const isTotal = entry.kind === "total"
        const rowBase = isTotal
          ? "bg-background/40 font-semibold border-t-2 border-card-border"
          : cn("text-text-secondary border-t border-card-border/50", entry.firstOfGroup && "border-t-card-border")
        return (
          <tr key={`${spec.key}-${entry.row.id}-${idx}`} className={cn(rowBase, "group/row")}>
            <td
              className={cn(
                "sticky left-0 z-10 px-3 whitespace-nowrap",
                isTotal ? "py-1.5 bg-background/95 backdrop-blur" : "py-1 pl-8 bg-card"
              )}
            >
              {isTotal ? (
                <button
                  onClick={onToggle}
                  className="flex items-center gap-1.5 text-text-primary hover:text-accent transition-colors"
                  aria-expanded={expanded}
                >
                  {expanded ? <ChevronDown className="w-3.5 h-3.5 text-text-muted" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted" />}
                  <span>{spec.label}</span>
                </button>
              ) : (
                <div className="flex items-center gap-2 text-xs">
                  <span className="inline-block w-8 text-2xs uppercase tracking-wide text-text-muted">
                    {entry.firstOfGroup ? GROUP_TAG[entry.kind] : ""}
                  </span>
                  <span className="text-text-secondary">{entry.row.label}</span>
                </div>
              )}
            </td>
            {periods.map((p, i) => {
              const cell = entry.row.perPeriod[p.key]
              const isCurrent = i === 0
              const baseTd = cn(
                "text-right px-3 whitespace-nowrap",
                isTotal ? "py-1.5" : "py-1 text-xs",
                isCurrent && "bg-accent/5"
              )
              if (!cell) return <td key={p.key} className={cn(baseTd, "text-text-muted")}>—</td>
              const clickable = cell.dealIds.length > 0
              const volume = spec.format === "eur" ? cell.volume : undefined
              const isEmptyEur = spec.format === "eur" && cell.value === 0 && !volume
              return (
                <td
                  key={p.key}
                  className={cn(baseTd, clickable && "cursor-pointer hover:bg-card-hover")}
                  title={clickable ? "Voir les transactions" : undefined}
                  onClick={
                    clickable
                      ? () =>
                          onOpenDrawer(
                            `${spec.label} · ${isTotal ? "Total" : entry.row.label} · ${p.label}`,
                            cell.dealIds
                          )
                      : undefined
                  }
                >
                  <span className="inline-flex items-baseline justify-end gap-1.5">
                    <span
                      className={cn(
                        "font-mono",
                        spec.format === "pct" ? pctTone(cell.pct) : isEmptyEur ? "text-text-muted" : spec.color
                      )}
                    >
                      {isEmptyEur ? "—" : fmtValue(cell, spec)}
                    </span>
                    {volume !== undefined && volume > 0 && (
                      <span className="text-2xs text-text-muted font-mono">×{volume}</span>
                    )}
                    {spec.key === "renew" && cell.volume !== undefined && cell.volume > 0 && (
                      <span className="text-2xs text-text-muted font-mono">
                        {formatCurrency(cell.value, true)}·{cell.volume}
                      </span>
                    )}
                  </span>
                </td>
              )
            })}
          </tr>
        )
      })}
    </>
  )
}

function Drawer({
  title,
  deals,
  onClose,
}: {
  title: string
  deals: DealBrief[]
  onClose: () => void
}) {
  const total = deals.reduce((s, d) => s + Math.abs(d.amount), 0)
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-[560px] bg-background-secondary h-full overflow-y-auto shadow-2xl border-l border-card-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-background-secondary border-b border-card-border px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
            <p className="text-2xs text-text-muted mt-0.5">
              {deals.length} transactions — {formatCurrency(total, true)}
            </p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="divide-y divide-card-border">
          {deals.length === 0 ? (
            <div className="p-8 text-center text-sm text-text-muted">Aucune transaction</div>
          ) : (
            deals.map((d) => (
              <div key={d.id} className="px-5 py-3 hover:bg-card-hover transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{d.name}</p>
                    <p className="text-xs text-text-secondary mt-0.5">
                      {d.companyName} · {d.csmName}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-2xs text-text-muted">
                      {d.tier && <span className="px-1.5 py-0.5 rounded bg-card-hover">{d.tier}</span>}
                      {d.country && <span className="px-1.5 py-0.5 rounded bg-card-hover">{d.country}</span>}
                      {d.attribution && <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent">{d.attribution}</span>}
                    </div>
                    <div className="text-2xs text-text-muted mt-1 space-x-3">
                      {d.operationDate && <span>Op: {formatDateFR(d.operationDate)}</span>}
                      {d.paymentDate && <span>Pay: {formatDateFR(d.paymentDate)}</span>}
                      {d.renewalDate && <span>Renew: {formatDateFR(d.renewalDate)}</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-sm text-text-primary">{formatCurrency(d.amount, true)}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <div>
      <Suspense>
        <Header title="Dashboard" subtitle="Vue synthétique — NRR, GRR, mouvements, renouvellements" />
      </Suspense>
      <Suspense>
        <DashboardContent />
      </Suspense>
    </div>
  )
}
