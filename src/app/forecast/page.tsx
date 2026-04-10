"use client"

import { Suspense, useState } from "react"
import { Header } from "@/components/layout/Header"
import { BarChartComponent } from "@/components/charts/BarChart"
import { useFetch } from "@/lib/hooks"
import { cn, formatCurrency } from "@/lib/utils"
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, RefreshCw } from "lucide-react"

interface ForecastDeal {
  id: string
  name: string
  amount: number
  companyName?: string
  status: "won" | "open" | "lost"
  type: "upsell" | "churn" | "renewal"
  probability: number
  expectedDate: string | null
  ownerId: string | null
}

interface PeriodBucket {
  key: string
  label: string
  upsell: { won: number; open: number; lost: number; deals: ForecastDeal[] }
  churn: { won: number; open: number; lost: number; deals: ForecastDeal[] }
  renewal: { won: number; open: number; lost: number; deals: ForecastDeal[] }
}

interface CsmForecast {
  csmId: string
  csmName: string
  color: string
  periods: PeriodBucket[]
}

interface ForecastData {
  global: PeriodBucket[]
  perCsm: CsmForecast[]
  chartData: Record<string, unknown>[]
  totals: { upsell: number; churn: number; renewal: number }
}

const STATUS_COLORS = {
  won: "bg-positive/15 text-positive",
  open: "bg-accent/15 text-accent",
  lost: "bg-negative/15 text-negative",
}

function ForecastContent() {
  const [mode, setMode] = useState<"month" | "quarter">("quarter")
  const [expandedSection, setExpandedSection] = useState<string | null>(null)
  const [selectedCsm, setSelectedCsm] = useState<string | null>(null)

  const { data, loading } = useFetch<ForecastData>("/api/forecast", { mode, periods: "8" })

  const buckets = selectedCsm
    ? data?.perCsm?.find((c) => c.csmId === selectedCsm)?.periods ?? []
    : data?.global ?? []

  const chartData = selectedCsm
    ? (data?.perCsm?.find((c) => c.csmId === selectedCsm)?.periods ?? []).map((b) => ({
        label: b.label,
        upsellWon: b.upsell.won,
        upsellOpen: b.upsell.open,
        churnWon: b.churn.won,
        churnOpen: b.churn.open,
        renewalWon: b.renewal.won,
        renewalOpen: b.renewal.open,
      }))
    : data?.chartData ?? []

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="skeleton h-10" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-[300px]" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-card rounded-lg p-0.5 border border-card-border">
            <button
              onClick={() => setMode("month")}
              className={cn("px-3 py-1.5 text-xs rounded-md transition-colors font-medium", mode === "month" ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary")}
            >
              Par mois
            </button>
            <button
              onClick={() => setMode("quarter")}
              className={cn("px-3 py-1.5 text-xs rounded-md transition-colors font-medium", mode === "quarter" ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary")}
            >
              Par trimestre
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setSelectedCsm(null)}
            className={cn("px-2.5 py-1 text-[10px] rounded-md transition-colors font-medium", !selectedCsm ? "bg-accent text-white" : "bg-card border border-card-border text-text-secondary hover:text-text-primary")}
          >
            Global
          </button>
          {data?.perCsm?.map((csm) => (
            <button
              key={csm.csmId}
              onClick={() => setSelectedCsm(selectedCsm === csm.csmId ? null : csm.csmId)}
              className={cn("px-2.5 py-1 text-[10px] rounded-md transition-colors font-medium", selectedCsm === csm.csmId ? "text-white" : "bg-card border border-card-border text-text-secondary hover:text-text-primary")}
              style={selectedCsm === csm.csmId ? { backgroundColor: csm.color } : undefined}
            >
              {csm.csmName.split(" ")[0]}
            </button>
          ))}
        </div>
      </div>

      {/* 3 charts: Upsell, Churn, Renewals */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card">
          <h3 className="text-sm font-medium text-text-secondary mb-1">Upsell Forecast</h3>
          <p className="text-[10px] text-text-muted mb-4">Won + Open pipeline</p>
          <BarChartComponent
            data={chartData}
            series={[
              { key: "upsellWon", label: "Won", color: "#22C55E" },
              { key: "upsellOpen", label: "Pipeline", color: "#22C55E50" },
            ]}
            xKey="label"
            stacked
            height={220}
          />
        </div>

        <div className="card">
          <h3 className="text-sm font-medium text-text-secondary mb-1">Churn Forecast</h3>
          <p className="text-[10px] text-text-muted mb-4">Confirmed + Projected</p>
          <BarChartComponent
            data={chartData}
            series={[
              { key: "churnWon", label: "Confirmed", color: "#EF4444" },
              { key: "churnOpen", label: "Projected", color: "#EF444450" },
            ]}
            xKey="label"
            stacked
            height={220}
          />
        </div>

        <div className="card">
          <h3 className="text-sm font-medium text-text-secondary mb-1">Renewals Forecast</h3>
          <p className="text-[10px] text-text-muted mb-4">Renewed + Upcoming</p>
          <BarChartComponent
            data={chartData}
            series={[
              { key: "renewalWon", label: "Renewed", color: "#2563EB" },
              { key: "renewalOpen", label: "Upcoming", color: "#2563EB50" },
            ]}
            xKey="label"
            stacked
            height={220}
          />
        </div>
      </div>

      {/* Detail table per period */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-background/50 border-b border-card-border">
              <tr>
                <th className="px-4 py-3 text-left text-xs text-text-muted font-medium">{mode === "month" ? "Mois" : "Trimestre"}</th>
                <th className="px-4 py-3 text-right text-xs text-text-muted font-medium" colSpan={2}>
                  <span className="flex items-center justify-end gap-1"><TrendingUp className="w-3 h-3 text-positive" />Upsell</span>
                </th>
                <th className="px-4 py-3 text-right text-xs text-text-muted font-medium" colSpan={2}>
                  <span className="flex items-center justify-end gap-1"><TrendingDown className="w-3 h-3 text-negative" />Churn</span>
                </th>
                <th className="px-4 py-3 text-right text-xs text-text-muted font-medium" colSpan={2}>
                  <span className="flex items-center justify-end gap-1"><RefreshCw className="w-3 h-3 text-accent" />Renewals</span>
                </th>
                <th className="px-4 py-3 text-right text-xs text-text-muted font-medium">Net</th>
              </tr>
              <tr className="border-b border-card-border">
                <th />
                <th className="px-2 py-1 text-right text-[10px] text-text-muted">Vol.</th>
                <th className="px-2 py-1 text-right text-[10px] text-text-muted">Montant</th>
                <th className="px-2 py-1 text-right text-[10px] text-text-muted">Vol.</th>
                <th className="px-2 py-1 text-right text-[10px] text-text-muted">Montant</th>
                <th className="px-2 py-1 text-right text-[10px] text-text-muted">Vol.</th>
                <th className="px-2 py-1 text-right text-[10px] text-text-muted">Montant</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {buckets.map((bucket) => {
                const upsellTotal = bucket.upsell.won + bucket.upsell.open
                const churnTotal = bucket.churn.won + bucket.churn.open
                const renewalTotal = bucket.renewal.won + bucket.renewal.open
                const net = upsellTotal - churnTotal
                const isExpanded = expandedSection === bucket.key
                const allDeals = [...bucket.upsell.deals, ...bucket.churn.deals, ...bucket.renewal.deals]

                return (
                  <>
                    <tr
                      key={bucket.key}
                      className="hover:bg-card-hover transition-colors cursor-pointer"
                      onClick={() => setExpandedSection(isExpanded ? null : bucket.key)}
                    >
                      <td className="px-4 py-3 text-sm font-medium text-text-primary">
                        <span className="flex items-center gap-2">
                          {bucket.label}
                          {allDeals.length > 0 && (
                            isExpanded ? <ChevronUp className="w-3 h-3 text-text-muted" /> : <ChevronDown className="w-3 h-3 text-text-muted" />
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-3 text-sm font-mono text-text-secondary text-right">{bucket.upsell.deals.length}</td>
                      <td className="px-2 py-3 text-sm font-mono text-positive text-right font-medium">
                        {upsellTotal > 0 ? formatCurrency(upsellTotal, true) : "—"}
                      </td>
                      <td className="px-2 py-3 text-sm font-mono text-text-secondary text-right">{bucket.churn.deals.length}</td>
                      <td className="px-2 py-3 text-sm font-mono text-negative text-right font-medium">
                        {churnTotal > 0 ? formatCurrency(churnTotal, true) : "—"}
                      </td>
                      <td className="px-2 py-3 text-sm font-mono text-text-secondary text-right">{bucket.renewal.deals.length}</td>
                      <td className="px-2 py-3 text-sm font-mono text-accent text-right font-medium">
                        {renewalTotal > 0 ? formatCurrency(renewalTotal, true) : "—"}
                      </td>
                      <td className={cn("px-4 py-3 text-sm font-mono text-right font-semibold", net >= 0 ? "text-positive" : "text-negative")}>
                        {net !== 0 ? formatCurrency(net, true) : "—"}
                      </td>
                    </tr>
                    {isExpanded && allDeals.length > 0 && (
                      <tr key={`${bucket.key}-detail`}>
                        <td colSpan={8} className="px-4 py-0 bg-background/30">
                          <div className="py-2 space-y-1">
                            {allDeals
                              .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
                              .map((deal) => (
                                <div key={deal.id} className="flex items-center justify-between text-xs py-1.5 px-3 rounded hover:bg-card-hover transition-colors">
                                  <div className="flex items-center gap-2">
                                    <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-medium",
                                      deal.type === "upsell" ? "bg-positive/15 text-positive" :
                                      deal.type === "churn" ? "bg-negative/15 text-negative" :
                                      "bg-accent/15 text-accent"
                                    )}>
                                      {deal.type === "upsell" ? "Upsell" : deal.type === "churn" ? "Churn" : "Renewal"}
                                    </span>
                                    <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-medium", STATUS_COLORS[deal.status])}>
                                      {deal.status === "won" ? "Won" : deal.status === "lost" ? "Lost" : "Open"}
                                    </span>
                                    <span className="text-text-primary font-medium">{deal.companyName ?? deal.name}</span>
                                  </div>
                                  <div className="flex items-center gap-4">
                                    <span className="text-text-muted">{deal.expectedDate?.slice(0, 10) ?? "—"}</span>
                                    <span className={cn("font-mono font-medium min-w-[70px] text-right",
                                      deal.type === "churn" ? "text-negative" : "text-positive"
                                    )}>
                                      {formatCurrency(Math.abs(deal.amount))}
                                    </span>
                                  </div>
                                </div>
                              ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default function ForecastPage() {
  return (
    <div>
      <Suspense>
        <Header title="Forecast" subtitle="Previsions upsell, churn et renouvellements" />
      </Suspense>
      <Suspense>
        <ForecastContent />
      </Suspense>
    </div>
  )
}
