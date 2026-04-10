"use client"

import { Suspense, useState } from "react"
import { Header } from "@/components/layout/Header"
import { BarChartComponent } from "@/components/charts/BarChart"
import { LineChartComponent } from "@/components/charts/LineChart"
import { useFetch } from "@/lib/hooks"
import { formatCurrency, cn } from "@/lib/utils"

interface NrrMonthData {
  month: string
  monthLabel: string
  startingMrr: number
  upsell: number
  churn: number
  downsell: number
  nrr: number
  deals: Array<{
    id: string
    name: string
    amount: number
    attribution: string
    companyName?: string
    operationDate: string | null
  }>
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

function TrendsContent() {
  const { data: nrr6, loading: loading6 } = useFetch<NrrTrendsResponse>("/api/nrr-trends", { months: "6" })
  const { data: nrr12, loading: loading12 } = useFetch<NrrTrendsResponse>("/api/nrr-trends", { months: "12" })
  const [range, setRange] = useState<"6" | "12">("6")
  const [selectedCsm, setSelectedCsm] = useState<string | null>(null)

  const loading = range === "6" ? loading6 : loading12
  const nrrData = range === "6" ? nrr6 : nrr12

  const globalData = nrrData?.global ?? []
  const csmData = nrrData?.perCsm ?? []
  const chartData = nrrData?.chartData ?? []

  // Build monthly upsell vs churn bar chart data
  const movementsData = globalData.map((m) => ({
    monthLabel: m.monthLabel,
    Upsell: m.upsell,
    Churn: -m.churn,
    Downsell: -m.downsell,
    Net: m.upsell - m.churn - m.downsell,
  }))

  // MRR evolution
  const mrrEvolution = globalData.map((m) => ({
    monthLabel: m.monthLabel,
    mrr: m.startingMrr + m.upsell - m.churn - m.downsell,
  }))

  // Per-CSM MRR stacked
  const csmMrrData = globalData.map((m, i) => {
    const row: Record<string, unknown> = { monthLabel: m.monthLabel }
    for (const csm of csmData) {
      const cm = csm.months[i]
      if (cm) row[csm.csmName.split(" ")[0]] = cm.startingMrr + cm.upsell - cm.churn - cm.downsell
    }
    return row
  })

  // Selected CSM data for detail
  const selectedCsmData = selectedCsm ? csmData.find((c) => c.csmId === selectedCsm) : null

  return (
    <div className="p-6 space-y-6">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Range toggle */}
          <div className="flex items-center gap-1 bg-card rounded-lg p-0.5 border border-card-border">
            <button
              onClick={() => setRange("6")}
              className={cn("px-3 py-1.5 text-xs rounded-md transition-colors font-medium", range === "6" ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary")}
            >
              6 mois
            </button>
            <button
              onClick={() => setRange("12")}
              className={cn("px-3 py-1.5 text-xs rounded-md transition-colors font-medium", range === "12" ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary")}
            >
              12 mois
            </button>
          </div>
        </div>

        {/* CSM filter chips */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSelectedCsm(null)}
            className={cn("px-2.5 py-1 text-[10px] rounded-md transition-colors font-medium", !selectedCsm ? "bg-accent text-white" : "bg-card border border-card-border text-text-secondary hover:text-text-primary")}
          >
            Global
          </button>
          {csmData.map((csm) => (
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

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="card skeleton h-[300px]" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* NRR Evolution */}
            <div className="card">
              <h3 className="text-sm font-medium text-text-secondary mb-4">
                NRR par mois {selectedCsmData ? `— ${selectedCsmData.csmName}` : "— Global"}
              </h3>
              <LineChartComponent
                data={selectedCsmData
                  ? selectedCsmData.months.map((m) => ({ monthLabel: m.monthLabel, NRR: m.nrr }))
                  : chartData
                }
                series={selectedCsmData
                  ? [{ key: "NRR", label: "NRR", color: selectedCsmData.color }]
                  : [
                      { key: "Global", label: "Global", color: "var(--color-text-primary)", dashed: true },
                      ...csmData.map((c) => ({ key: c.csmName.split(" ")[0], label: c.csmName.split(" ")[0], color: c.color })),
                    ]
                }
                xKey="monthLabel"
                height={280}
                referenceLine={{ y: 100, label: "100%", color: "#64748B" }}
              />
            </div>

            {/* Upsell vs Churn vs Downsell */}
            <div className="card">
              <h3 className="text-sm font-medium text-text-secondary mb-4">
                Mouvements mensuels {selectedCsmData ? `— ${selectedCsmData.csmName}` : "— Global"}
              </h3>
              <BarChartComponent
                data={selectedCsmData
                  ? selectedCsmData.months.map((m) => ({
                      monthLabel: m.monthLabel,
                      Upsell: m.upsell,
                      Churn: -m.churn,
                      Downsell: -m.downsell,
                    }))
                  : movementsData
                }
                series={[
                  { key: "Upsell", label: "Upsell", color: "#22C55E" },
                  { key: "Churn", label: "Churn", color: "#EF4444" },
                  { key: "Downsell", label: "Downsell", color: "#F59E0B" },
                ]}
                xKey="monthLabel"
                stacked
                height={280}
              />
            </div>

            {/* Net Expansion */}
            <div className="card">
              <h3 className="text-sm font-medium text-text-secondary mb-4">
                Net Expansion {selectedCsmData ? `— ${selectedCsmData.csmName}` : "— Global"}
              </h3>
              <LineChartComponent
                data={selectedCsmData
                  ? selectedCsmData.months.map((m) => ({
                      monthLabel: m.monthLabel,
                      Net: m.upsell - m.churn - m.downsell,
                    }))
                  : movementsData
                }
                series={[{ key: "Net", label: "Net Expansion", color: "#2563EB" }]}
                xKey="monthLabel"
                height={280}
                formatValue={(v) => formatCurrency(v, true)}
                referenceLine={{ y: 0, label: "Breakeven", color: "#64748B" }}
              />
            </div>

            {/* MRR Evolution per CSM */}
            <div className="card">
              <h3 className="text-sm font-medium text-text-secondary mb-4">
                MRR fin de mois par CSM
              </h3>
              <BarChartComponent
                data={csmMrrData}
                series={csmData.map((c) => ({
                  key: c.csmName.split(" ")[0],
                  label: c.csmName.split(" ")[0],
                  color: c.color,
                }))}
                xKey="monthLabel"
                stacked
                height={280}
              />
            </div>
          </div>

          {/* Monthly detail table */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-card-border">
              <h3 className="text-sm font-medium text-text-secondary">
                Detail mensuel {selectedCsmData ? `— ${selectedCsmData.csmName}` : "— Global"}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-background/50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs text-text-muted">Mois</th>
                    <th className="px-4 py-2 text-right text-xs text-text-muted">MRR Debut</th>
                    <th className="px-4 py-2 text-right text-xs text-text-muted">Upsell</th>
                    <th className="px-4 py-2 text-right text-xs text-text-muted">Churn</th>
                    <th className="px-4 py-2 text-right text-xs text-text-muted">Downsell</th>
                    <th className="px-4 py-2 text-right text-xs text-text-muted">Net</th>
                    <th className="px-4 py-2 text-right text-xs text-text-muted">NRR</th>
                    <th className="px-4 py-2 text-right text-xs text-text-muted">Deals</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {(selectedCsmData?.months ?? globalData).map((m) => {
                    const net = m.upsell - m.churn - m.downsell
                    return (
                      <tr key={m.month} className="hover:bg-card-hover transition-colors">
                        <td className="px-4 py-2.5 text-sm font-medium text-text-primary">{m.monthLabel}</td>
                        <td className="px-4 py-2.5 text-sm font-mono text-text-secondary text-right">{formatCurrency(m.startingMrr, true)}</td>
                        <td className="px-4 py-2.5 text-sm font-mono text-positive text-right">{m.upsell > 0 ? `+${formatCurrency(m.upsell, true)}` : "—"}</td>
                        <td className="px-4 py-2.5 text-sm font-mono text-negative text-right">{m.churn > 0 ? `-${formatCurrency(m.churn, true)}` : "—"}</td>
                        <td className="px-4 py-2.5 text-sm font-mono text-warning text-right">{m.downsell > 0 ? `-${formatCurrency(m.downsell, true)}` : "—"}</td>
                        <td className={cn("px-4 py-2.5 text-sm font-mono text-right font-medium", net >= 0 ? "text-positive" : "text-negative")}>{formatCurrency(net, true)}</td>
                        <td className={cn("px-4 py-2.5 text-sm font-mono text-right font-semibold", m.nrr >= 100 ? "text-positive" : "text-negative")}>{m.nrr.toFixed(1)}%</td>
                        <td className="px-4 py-2.5 text-sm text-text-muted text-right">{m.deals?.length ?? 0}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function TrendsPage() {
  return (
    <div>
      <Suspense>
        <Header title="Tendances" subtitle="Analyse mensuelle — NRR, mouvements et MRR" />
      </Suspense>
      <Suspense>
        <TrendsContent />
      </Suspense>
    </div>
  )
}
