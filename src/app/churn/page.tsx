"use client"

import { Suspense, useState } from "react"
import { Header } from "@/components/layout/Header"
import { BarChartComponent } from "@/components/charts/BarChart"
import { DonutChart } from "@/components/charts/DonutChart"
import { useFetch } from "@/lib/hooks"
import { ErrorState } from "@/components/ui/ErrorState"
import { formatCurrency, cn } from "@/lib/utils"

interface ChurnAnalyticsResponse {
  byMonthCsm: Array<Record<string, unknown>>
  byQuarterCsm: Array<Record<string, unknown>>
  byWeekCsm: Array<Record<string, unknown>>
  byTier: Array<{ tier: string; amount: number; count: number }>
  forecast: Array<{ monthLabel: string; "Churn ouvert": number; "Renouvellement à risque": number }>
  summary: {
    totalChurn: number
    churnCount: number
    openChurnAmount: number
    openChurnCount: number
    atRiskAmount: number
    atRiskCount: number
  }
  csms: Array<{ name: string; color: string }>
}

const TIER_COLORS = ["#EF4444", "#F97316", "#F59E0B", "#EC4899", "#8B5CF6", "#06B6D4", "#64748B"]

function ChurnContent() {
  const [range, setRange] = useState<"6" | "12">("12")
  const { data, loading, error, refetch } = useFetch<ChurnAnalyticsResponse>("/api/analytics/churn", { months: range })

  if (error && !loading) {
    return <div className="p-6"><ErrorState message="Impossible de charger les données churn" onRetry={refetch} /></div>
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
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="card skeleton h-[300px]" />)}
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="card">
              <p className="text-xs text-text-muted mb-1">Churn confirmé ({range} mois)</p>
              <p className="text-2xl font-semibold text-negative">{formatCurrency(data.summary.totalChurn, true)}</p>
              <p className="text-2xs text-text-muted mt-1">{data.summary.churnCount} deals</p>
            </div>
            <div className="card">
              <p className="text-xs text-text-muted mb-1">Churn ouvert (en cours)</p>
              <p className="text-2xl font-semibold text-warning">{formatCurrency(data.summary.openChurnAmount, true)}</p>
              <p className="text-2xs text-text-muted mt-1">{data.summary.openChurnCount} deals</p>
            </div>
            <div className="card">
              <p className="text-xs text-text-muted mb-1">Renouvellements à risque</p>
              <p className="text-2xl font-semibold text-warning">{formatCurrency(data.summary.atRiskAmount, true)}</p>
              <p className="text-2xs text-text-muted mt-1">{data.summary.atRiskCount} renouvellements at-risk</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 1. Churn par mois / CSM */}
            <div className="card">
              <h3 className="text-sm font-medium text-text-secondary mb-4">Churn par mois / CSM</h3>
              <BarChartComponent
                data={data.byMonthCsm}
                series={csmSeries}
                xKey="monthLabel"
                stacked
                height={280}
              />
            </div>

            {/* 2. Churn par trimestre / CSM */}
            <div className="card">
              <h3 className="text-sm font-medium text-text-secondary mb-4">Churn par trimestre / CSM</h3>
              <BarChartComponent
                data={data.byQuarterCsm}
                series={csmSeries}
                xKey="quarterLabel"
                stacked
                height={280}
              />
            </div>

            {/* 3. Churn par semaine / CSM */}
            <div className="card lg:col-span-2">
              <h3 className="text-sm font-medium text-text-secondary mb-4">Churn par semaine / CSM (12 dernières semaines)</h3>
              <BarChartComponent
                data={data.byWeekCsm}
                series={csmSeries}
                xKey="weekLabel"
                stacked
                height={260}
              />
            </div>

            {/* 4. Tier breakdown */}
            <div className="card">
              <h3 className="text-sm font-medium text-text-secondary mb-4">Churn par tier client</h3>
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

            {/* 5. Forecast */}
            <div className="card">
              <h3 className="text-sm font-medium text-text-secondary mb-1">Forecast churn (6 prochains mois)</h3>
              <p className="text-2xs text-text-muted mb-3">Deals de churn ouverts + renouvellements en at-risk</p>
              <BarChartComponent
                data={data.forecast}
                series={[
                  { key: "Churn ouvert", label: "Churn ouvert", color: "#EF4444" },
                  { key: "Renouvellement à risque", label: "Renouvellement à risque", color: "#F59E0B" },
                ]}
                xKey="monthLabel"
                stacked
                height={240}
                formatValue={(v) => formatCurrency(v, true)}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function ChurnPage() {
  return (
    <div>
      <Suspense>
        <Header title="Churn" subtitle="Analyse du churn et forecast" />
      </Suspense>
      <Suspense>
        <ChurnContent />
      </Suspense>
    </div>
  )
}
