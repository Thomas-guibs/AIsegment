"use client"

import { Suspense, useState } from "react"
import { Header } from "@/components/layout/Header"
import { BarChartComponent } from "@/components/charts/BarChart"
import { LineChartComponent } from "@/components/charts/LineChart"
import { DonutChart } from "@/components/charts/DonutChart"
import { useFetch } from "@/lib/hooks"
import { ErrorState } from "@/components/ui/ErrorState"
import { formatCurrency, cn } from "@/lib/utils"

interface UpsellAnalyticsResponse {
  byMonthCsm: Array<Record<string, unknown>>
  byQuarter: Array<{ quarterLabel: string; Upsell: number }>
  byMonthTotal: Array<{ monthLabel: string; Upsell: number }>
  avgByMonth: Array<{ monthLabel: string; Moyenne: number }>
  overallAvg: number
  byTier: Array<{ tier: string; amount: number; count: number }>
  conversionRate: { created: number; won: number; rate: number }
  pipelineByStage: Array<{ stage: string; label: string; count: number; amount: number }>
  createdByMonth: Array<Record<string, unknown>>
  csms: Array<{ name: string; color: string }>
}

const TIER_COLORS = ["#2563EB", "#06B6D4", "#22C55E", "#F59E0B", "#EC4899", "#8B5CF6", "#64748B"]

function UpsellContent() {
  const [range, setRange] = useState<"6" | "12">("12")
  const { data, loading, error, refetch } = useFetch<UpsellAnalyticsResponse>("/api/analytics/upsell", { months: range })

  if (error && !loading) {
    return <div className="p-6"><ErrorState message="Impossible de charger les données upsell" onRetry={refetch} /></div>
  }

  const csmSeries = (data?.csms ?? []).map((c) => ({
    key: c.name.split(" ")[0],
    label: c.name.split(" ")[0],
    color: c.color,
  }))

  const tierData = (data?.byTier ?? []).map((t, i) => ({
    name: t.tier,
    value: t.amount,
    color: TIER_COLORS[i % TIER_COLORS.length],
  }))

  return (
    <div className="p-6 space-y-6">
      {/* Range toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 bg-card rounded-lg p-0.5 border border-card-border">
          {(["6", "12"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "px-3 py-1.5 text-xs rounded-md transition-colors font-medium",
                range === r ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"
              )}
            >
              {r} mois
            </button>
          ))}
        </div>
      </div>

      {loading || !data ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="card skeleton h-[300px]" />)}
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="card">
              <p className="text-xs text-text-muted mb-1">Panier moyen</p>
              <p className="text-2xl font-semibold text-text-primary">{formatCurrency(data.overallAvg, true)}</p>
            </div>
            <div className="card">
              <p className="text-xs text-text-muted mb-1">Taux de conversion</p>
              <p className="text-2xl font-semibold text-text-primary">{data.conversionRate.rate.toFixed(1)}%</p>
              <p className="text-2xs text-text-muted mt-1">{data.conversionRate.won} gagnés / {data.conversionRate.created} créés</p>
            </div>
            <div className="card">
              <p className="text-xs text-text-muted mb-1">Pipe en cours</p>
              <p className="text-2xl font-semibold text-text-primary">
                {formatCurrency(data.pipelineByStage.reduce((s, p) => s + p.amount, 0), true)}
              </p>
              <p className="text-2xs text-text-muted mt-1">{data.pipelineByStage.reduce((s, p) => s + p.count, 0)} deals ouverts</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 1. Upsell par mois / CSM */}
            <div className="card">
              <h3 className="text-sm font-medium text-text-secondary mb-4">Upsell par mois / CSM</h3>
              <BarChartComponent
                data={data.byMonthCsm}
                series={csmSeries}
                xKey="monthLabel"
                stacked
                height={280}
              />
            </div>

            {/* 2. Upsell par mois (total) */}
            <div className="card">
              <h3 className="text-sm font-medium text-text-secondary mb-4">Upsell par mois — Total</h3>
              <LineChartComponent
                data={data.byMonthTotal}
                series={[{ key: "Upsell", label: "Upsell", color: "#22C55E" }]}
                xKey="monthLabel"
                height={280}
                formatValue={(v) => formatCurrency(v, true)}
              />
            </div>

            {/* 3. Upsell par trimestre */}
            <div className="card">
              <h3 className="text-sm font-medium text-text-secondary mb-4">Upsell par trimestre</h3>
              <BarChartComponent
                data={data.byQuarter}
                series={[{ key: "Upsell", label: "Upsell", color: "#2563EB" }]}
                xKey="quarterLabel"
                height={280}
              />
            </div>

            {/* 4. Panier moyen par mois */}
            <div className="card">
              <h3 className="text-sm font-medium text-text-secondary mb-4">Panier moyen des transactions d'upsell</h3>
              <LineChartComponent
                data={data.avgByMonth}
                series={[{ key: "Moyenne", label: "Panier moyen", color: "#8B5CF6" }]}
                xKey="monthLabel"
                height={280}
                formatValue={(v) => formatCurrency(v, true)}
              />
            </div>

            {/* 5. Tier breakdown */}
            <div className="card">
              <h3 className="text-sm font-medium text-text-secondary mb-4">Upsell par tier client</h3>
              {tierData.length === 0 ? (
                <div className="flex items-center justify-center h-[260px] text-text-muted text-sm">Aucune donnée</div>
              ) : (
                <div className="flex items-center justify-center gap-8 h-[260px]">
                  <DonutChart data={tierData} size={220} innerRadius={70} outerRadius={105} />
                  <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
                    {data.byTier.map((t, i) => (
                      <div key={t.tier} className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: TIER_COLORS[i % TIER_COLORS.length] }} />
                        <span className="text-text-secondary">{t.tier}</span>
                        <span className="font-mono text-text-primary ml-auto">{formatCurrency(t.amount, true)}</span>
                        <span className="text-text-muted">({t.count})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 6. Pipeline par stage */}
            <div className="card">
              <h3 className="text-sm font-medium text-text-secondary mb-4">Pipe en cours par phase</h3>
              <BarChartComponent
                data={data.pipelineByStage.map((s) => ({ stage: s.label, Montant: s.amount, count: s.count }))}
                series={[{ key: "Montant", label: "Montant", color: "#06B6D4" }]}
                xKey="stage"
                height={280}
                formatValue={(v) => formatCurrency(v, true)}
              />
            </div>

            {/* 7. Opportunités créées par mois / CSM */}
            <div className="card lg:col-span-2">
              <h3 className="text-sm font-medium text-text-secondary mb-4">Opportunités créées par mois / CSM</h3>
              <BarChartComponent
                data={data.createdByMonth}
                series={csmSeries}
                xKey="monthLabel"
                stacked
                height={280}
                formatValue={(v) => `${v} deal${v > 1 ? "s" : ""}`}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function UpsellPage() {
  return (
    <div>
      <Suspense>
        <Header title="Upsell" subtitle="Analyse des transactions d'upsell" />
      </Suspense>
      <Suspense>
        <UpsellContent />
      </Suspense>
    </div>
  )
}
