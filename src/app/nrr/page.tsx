"use client"

import { Suspense, useState } from "react"
import { Header } from "@/components/layout/Header"
import { LineChartComponent } from "@/components/charts/LineChart"
import { BarChartComponent } from "@/components/charts/BarChart"
import { useFetch } from "@/lib/hooks"
import { cn, formatCurrency } from "@/lib/utils"
import { CHART_CSMS } from "@/lib/constants"
import { ChevronDown, ChevronUp } from "lucide-react"

interface DealDetail {
  id: string
  name: string
  amount: number
  attribution: string
  companyName?: string
  operationDate: string | null
}

interface NrrMonthData {
  month: string
  monthLabel: string
  startingMrr: number
  upsell: number
  churn: number
  downsell: number
  nrr: number
  deals: DealDetail[]
}

interface CsmNrrTrend {
  csmId: string
  csmName: string
  color: string
  months: NrrMonthData[]
}

interface NrrTrendsResponse {
  chartData: Record<string, unknown>[]
  global: NrrMonthData[]
  perCsm: CsmNrrTrend[]
}


function NrrContent() {
  const [range, setRange] = useState<"6" | "12">("6")
  const { data: nrr6, loading: loading6 } = useFetch<NrrTrendsResponse>("/api/nrr-trends", { months: "6" })
  const { data: nrr12, loading: loading12 } = useFetch<NrrTrendsResponse>("/api/nrr-trends", { months: "12" })
  const [expandedCsm, setExpandedCsm] = useState<string | null>(null)
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null)

  const loading = range === "6" ? loading6 : loading12
  const nrrData = range === "6" ? nrr6 : nrr12

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="skeleton h-10" />
        <div className="grid grid-cols-2 gap-4">
          <div className="skeleton h-[300px]" />
          <div className="skeleton h-[300px]" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-14" />)}
      </div>
    )
  }

  if (!nrrData) return null

  return (
    <div className="p-6 space-y-6">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 bg-card rounded-lg p-0.5 border border-card-border">
          <button
            onClick={() => setRange("6")}
            className={cn("px-3 py-1.5 text-2xs rounded-md font-medium transition-colors", range === "6" ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary")}
          >
            6 mois
          </button>
          <button
            onClick={() => setRange("12")}
            className={cn("px-3 py-1.5 text-2xs rounded-md font-medium transition-colors", range === "12" ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary")}
          >
            12 mois
          </button>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-medium text-text-secondary mb-4">NRR par CSM</h3>
          <LineChartComponent
            data={nrrData.chartData}
            series={[
              { key: "Global", label: "Global", color: "var(--color-text-primary)", dashed: true },
              ...CHART_CSMS.map((csm) => ({
                key: csm.name.split(" ")[0],
                label: csm.name.split(" ")[0],
                color: csm.color,
              })),
            ]}
            xKey="monthLabel"
            height={280}
            referenceLine={{ y: 100, label: "100%", color: "#A3A3A3" }}
          />
        </div>

        <div className="card">
          <h3 className="text-sm font-medium text-text-secondary mb-4">Mouvements mensuels</h3>
          <BarChartComponent
            data={nrrData.global.map((m) => ({
              monthLabel: m.monthLabel,
              Upsell: m.upsell,
              Churn: -m.churn,
              Downsell: -m.downsell,
            }))}
            series={[
              { key: "Upsell", label: "Upsell", color: "#2BA85D" },
              { key: "Churn", label: "Churn", color: "#DC3545" },
              { key: "Downsell", label: "Downsell", color: "#E8923A" },
            ]}
            xKey="monthLabel"
            stacked
            height={280}
          />
        </div>
      </div>

      {/* Global monthly table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-card-border">
          <h3 className="text-sm font-medium text-text-secondary">Detail mensuel — Global</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-row-alt">
              <tr>
                <th className="px-4 py-2.5 text-left text-2xs text-text-muted font-medium">Mois</th>
                <th className="px-4 py-2.5 text-right text-2xs text-text-muted font-medium">MRR Debut</th>
                <th className="px-4 py-2.5 text-right text-2xs text-text-muted font-medium">Upsell</th>
                <th className="px-4 py-2.5 text-right text-2xs text-text-muted font-medium">Churn</th>
                <th className="px-4 py-2.5 text-right text-2xs text-text-muted font-medium">Downsell</th>
                <th className="px-4 py-2.5 text-right text-2xs text-text-muted font-medium">Net</th>
                <th className="px-4 py-2.5 text-right text-2xs text-text-muted font-medium">NRR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {nrrData.global.map((m) => {
                const net = m.upsell - m.churn - m.downsell
                return (
                  <tr key={m.month} className="hover:bg-card-hover transition-colors">
                    <td className="px-4 py-2.5 text-[13px] font-medium text-text-primary">{m.monthLabel}</td>
                    <td className="px-4 py-2.5 text-[13px] font-mono text-text-secondary text-right">{formatCurrency(m.startingMrr, true)}</td>
                    <td className="px-4 py-2.5 text-[13px] font-mono text-positive text-right">{m.upsell > 0 ? `+${formatCurrency(m.upsell, true)}` : "—"}</td>
                    <td className="px-4 py-2.5 text-[13px] font-mono text-negative text-right">{m.churn > 0 ? `-${formatCurrency(m.churn, true)}` : "—"}</td>
                    <td className="px-4 py-2.5 text-[13px] font-mono text-warning text-right">{m.downsell > 0 ? `-${formatCurrency(m.downsell, true)}` : "—"}</td>
                    <td className={cn("px-4 py-2.5 text-[13px] font-mono font-medium text-right", net >= 0 ? "text-positive" : "text-negative")}>{formatCurrency(net, true)}</td>
                    <td className={cn("px-4 py-2.5 text-[13px] font-mono font-semibold text-right", m.nrr >= 100 ? "text-positive" : "text-negative")}>{m.nrr.toFixed(1)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-CSM expandable detail */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-text-secondary">Detail par CSM</h3>
        {nrrData.perCsm.map((csm) => (
          <div key={csm.csmId} className="card p-0 overflow-hidden">
            <button
              onClick={() => setExpandedCsm(expandedCsm === csm.csmId ? null : csm.csmId)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-card-hover transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: csm.color }} />
                <span className="text-[13px] font-medium text-text-primary">{csm.csmName}</span>
              </div>
              <div className="flex items-center gap-4">
                {csm.months.map((m) => (
                  <span
                    key={m.month}
                    className={cn("text-2xs font-mono font-medium", m.nrr >= 100 ? "text-positive" : "text-negative")}
                  >
                    {m.nrr.toFixed(1)}%
                  </span>
                ))}
                {expandedCsm === csm.csmId ? (
                  <ChevronUp className="w-4 h-4 text-text-muted" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-text-muted" />
                )}
              </div>
            </button>

            {expandedCsm === csm.csmId && (
              <div className="border-t border-card-border animate-fade-in">
                <table className="w-full">
                  <thead className="bg-row-alt">
                    <tr>
                      <th className="px-4 py-2 text-left text-2xs text-text-muted">Mois</th>
                      <th className="px-4 py-2 text-right text-2xs text-text-muted">MRR Debut</th>
                      <th className="px-4 py-2 text-right text-2xs text-text-muted">Upsell</th>
                      <th className="px-4 py-2 text-right text-2xs text-text-muted">Churn</th>
                      <th className="px-4 py-2 text-right text-2xs text-text-muted">Downsell</th>
                      <th className="px-4 py-2 text-right text-2xs text-text-muted">NRR</th>
                      <th className="px-4 py-2 text-right text-2xs text-text-muted">Deals</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-card-border">
                    {csm.months.map((m) => (
                      <>
                        <tr
                          key={m.month}
                          className="hover:bg-card-hover cursor-pointer transition-colors"
                          onClick={() => setExpandedMonth(expandedMonth === `${csm.csmId}-${m.month}` ? null : `${csm.csmId}-${m.month}`)}
                        >
                          <td className="px-4 py-2 text-[13px] text-text-primary font-medium">{m.monthLabel}</td>
                          <td className="px-4 py-2 text-[13px] font-mono text-text-secondary text-right">{formatCurrency(m.startingMrr, true)}</td>
                          <td className="px-4 py-2 text-[13px] font-mono text-positive text-right">{m.upsell > 0 ? `+${formatCurrency(m.upsell, true)}` : "—"}</td>
                          <td className="px-4 py-2 text-[13px] font-mono text-negative text-right">{m.churn > 0 ? `-${formatCurrency(m.churn, true)}` : "—"}</td>
                          <td className="px-4 py-2 text-[13px] font-mono text-warning text-right">{m.downsell > 0 ? `-${formatCurrency(m.downsell, true)}` : "—"}</td>
                          <td className={cn("px-4 py-2 text-[13px] font-mono font-medium text-right", m.nrr >= 100 ? "text-positive" : "text-negative")}>{m.nrr.toFixed(1)}%</td>
                          <td className="px-4 py-2 text-[13px] text-text-muted text-right">
                            {m.deals.length > 0 ? (
                              <span className="flex items-center justify-end gap-1">
                                {m.deals.length}
                                {expandedMonth === `${csm.csmId}-${m.month}` ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </span>
                            ) : "0"}
                          </td>
                        </tr>
                        {expandedMonth === `${csm.csmId}-${m.month}` && m.deals.length > 0 && (
                          <tr key={`${m.month}-deals`}>
                            <td colSpan={7} className="px-4 py-0">
                              <div className="py-2 pl-4 space-y-1 border-l-2 border-card-border ml-2">
                                {m.deals.map((deal) => (
                                  <div key={deal.id} className="flex items-center justify-between text-xs py-1.5">
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={cn(
                                          "badge",
                                          deal.attribution === "Upsell" && "badge-upsell",
                                          deal.attribution === "Churn" && "badge-churn",
                                          deal.attribution === "Downsell" && "badge-downsell"
                                        )}
                                      >
                                        {deal.attribution}
                                      </span>
                                      <span className="text-text-primary">{deal.companyName ?? deal.name}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <span className="text-text-muted">{deal.operationDate?.slice(0, 10)}</span>
                                      <span className={cn("font-mono font-medium", deal.amount >= 0 ? "text-positive" : "text-negative")}>
                                        {formatCurrency(deal.amount)}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function NrrPage() {
  return (
    <div>
      <Suspense>
        <Header title="NRR Detail" subtitle="Net Revenue Retention par CSM avec detail des transactions" />
      </Suspense>
      <Suspense>
        <NrrContent />
      </Suspense>
    </div>
  )
}
