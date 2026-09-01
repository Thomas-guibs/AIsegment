"use client"

import { Suspense, useMemo, useState } from "react"
import { Header } from "@/components/layout/Header"
import { useFetch } from "@/lib/hooks"
import { ErrorState } from "@/components/ui/ErrorState"
import { formatCurrency, formatDateFR, cn } from "@/lib/utils"
import { ChevronDown, ChevronRight, X, ExternalLink } from "lucide-react"

type PeriodType = "month" | "quarter" | "year"
type CalcMethod = "booked" | "billed"
type MetricKey = "nrr" | "grr" | "upsell" | "churn" | "downsell" | "renew"

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
  excludedNoCsm: number
  excludedZeroMrr: number
  excludedNoBilling: number
  excludedExited: number
  accountsWithoutBilling: number
  accountsExitedByPhaseOnly: number
  accountsRetainedWithChurn: number
  accountsInvisibleTruncatedHistory: number
  accountsMrrFromDeals: number
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

function fmtVolume(cell: Cell): string | null {
  if (cell.volume === undefined || cell.volume === 0) return null
  return `${cell.volume} deal${cell.volume > 1 ? "s" : ""}`
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border bg-background/50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-muted sticky left-0 bg-background/50 z-10 min-w-[220px]">
                    Métrique
                  </th>
                  {periodsReversed.map((p) => (
                    <th key={p.key} className="text-right px-4 py-3 text-xs font-medium text-text-muted whitespace-nowrap">
                      {p.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
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
    d.excludedZeroMrr > 0 ||
    d.excludedNoCsm > 0 ||
    d.excludedNoBilling > 0 ||
    d.accountsWithoutBilling > 0 ||
    d.accountsExitedByPhaseOnly > 0 ||
    d.accountsRetainedWithChurn > 0 ||
    d.accountsInvisibleTruncatedHistory > 0 ||
    d.accountsMrrFromDeals > 0
  if (!anyIssue) return null

  const mrrLabel = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(d.mrrTotal)
  return (
    <details className="card p-3 text-xs">
      <summary className="cursor-pointer text-text-secondary font-medium">
        Diagnostics — {d.passed} comptes retenus · {mrrLabel} € de MRR sous gestion
        <span className="text-text-muted ml-2">
          (sur {d.totalConsidered} évalués, {d.totalCustomers} clients actifs)
        </span>
      </summary>
      <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-text-muted">
        <DiagRow label="CSM inconnu à T (§3.1)" value={d.excludedNoCsm} />
        <DiagRow label="MRR ≤ 0 à T (§3.3)" value={d.excludedZeroMrr} />
        <DiagRow label="Pas encore facturé (§3.4)" value={d.excludedNoBilling} />
        <DiagRow label="Sorti du portefeuille (§4)" value={d.excludedExited} />
        {d.accountsWithoutBilling > 0 && (
          <DiagRow label="⚠ Aucun deal avec date_de_paiement" value={d.accountsWithoutBilling} />
        )}
        {d.accountsExitedByPhaseOnly > 0 && (
          <DiagRow label="⚠ Sorti sur phase seule (deal churn manquant)" value={d.accountsExitedByPhaseOnly} />
        )}
        {d.accountsRetainedWithChurn > 0 && (
          <DiagRow label="⚠ Retenu malgré churn (downsell mal étiqueté ?)" value={d.accountsRetainedWithChurn} />
        )}
        {d.accountsInvisibleTruncatedHistory > 0 && (
          <DiagRow label="⚠ Historique tronqué (§2)" value={d.accountsInvisibleTruncatedHistory} />
        )}
        {d.accountsMrrFromDeals > 0 && (
          <DiagRow label="ℹ MRR reconstruit depuis les deals" value={d.accountsMrrFromDeals} />
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
  const rows: Array<{ row: Row; kind: "total" | "csm" | "tier" | "country"; groupLabel: string }> = []
  rows.push({ row: group.total, kind: "total", groupLabel: "Total" })
  if (expanded) {
    for (const r of group.byCsm) rows.push({ row: r, kind: "csm", groupLabel: "CSM" })
    for (const r of group.byTier) rows.push({ row: r, kind: "tier", groupLabel: "Tier" })
    for (const r of group.byCountry) rows.push({ row: r, kind: "country", groupLabel: "Pays" })
  }

  return (
    <>
      {rows.map((entry, idx) => {
        const isTotal = entry.kind === "total"
        return (
          <tr key={`${spec.key}-${entry.row.id}-${idx}`} className={cn(isTotal ? "font-semibold" : "text-text-secondary")}>
            <td className={cn("px-4 py-2.5 sticky left-0 bg-card z-10", !isTotal && "pl-10")}>
              <div className="flex items-center gap-2">
                {isTotal && (
                  <button onClick={onToggle} className="text-text-muted hover:text-text-primary">
                    {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                )}
                <span className={isTotal ? "text-text-primary" : "text-text-secondary"}>
                  {isTotal ? spec.label : `${spec.label} / ${entry.row.label}`}
                </span>
              </div>
            </td>
            {periods.map((p) => {
              const cell = entry.row.perPeriod[p.key]
              if (!cell) return <td key={p.key} className="text-right px-4 py-2.5 text-text-muted">—</td>
              return (
                <td key={p.key} className="text-right px-4 py-2.5">
                  <div className="flex flex-col items-end gap-0.5">
                    <span className={cn("font-mono text-[13px]", spec.color)}>
                      {fmtValue(cell, spec)}
                    </span>
                    {spec.format === "eur" && fmtVolume(cell) && (
                      <span className="text-2xs text-text-muted font-mono">{fmtVolume(cell)}</span>
                    )}
                    {spec.key === "renew" && cell.volume !== undefined && cell.volume > 0 && (
                      <span className="text-2xs text-text-muted font-mono">
                        {formatCurrency(cell.value, true)} · {cell.volume}
                      </span>
                    )}
                    {cell.dealIds.length > 0 && (
                      <button
                        onClick={() =>
                          onOpenDrawer(
                            `${spec.label} · ${isTotal ? "Total" : entry.row.label} · ${p.label}`,
                            cell.dealIds
                          )
                        }
                        className="text-2xs text-accent hover:underline flex items-center gap-0.5"
                      >
                        Voir <ExternalLink className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
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
