"use client"

import { Suspense } from "react"
import { Header } from "@/components/layout/Header"
import { KpiCard, KpiCardSkeleton } from "@/components/charts/KpiCard"
import { BarChartComponent } from "@/components/charts/BarChart"
import { LineChartComponent } from "@/components/charts/LineChart"
import { MiniDonut } from "@/components/charts/DonutChart"
import { DealsTable, DealsTableSkeleton } from "@/components/tables/DealsTable"
import { useFetch } from "@/lib/hooks"
import type { DashboardKpis, Deal } from "@/lib/types"
import { STAGE_CATEGORY_COLORS, STAGE_CATEGORY_LABELS, CHART_CSMS, type StageCategory } from "@/lib/constants"
import { cn, formatCurrency } from "@/lib/utils"
import { ErrorState } from "@/components/ui/ErrorState"
import {
  DollarSign,
  Percent,
  TrendingDown,
  TrendingUp,
  Layers,
  CalendarClock,
} from "lucide-react"

interface NrrMonthData {
  month: string
  monthLabel: string
  startingMrr: number
  upsell: number
  churn: number
  downsell: number
  nrr: number
}

interface NrrTrendsResponse {
  chartData: Record<string, unknown>[]
  global: NrrMonthData[]
}


function DashboardContent() {
  const { data: kpis, loading: kpisLoading, error: kpisError, refetch: refetchKpis } = useFetch<DashboardKpis>("/api/kpis")
  const { data: dealsData, loading: dealsLoading, error: dealsError, refetch: refetchDeals } = useFetch<{ deals: Deal[] }>("/api/deals")
  const { data: nrrTrends, loading: nrrLoading, error: nrrError, refetch: refetchNrr } = useFetch<NrrTrendsResponse>("/api/nrr-trends")

  const criticalError = kpisError && dealsError && nrrError
  if (criticalError) {
    return (
      <div className="p-6">
        <ErrorState
          message="Impossible de charger le dashboard. Vérifie que le token HubSpot est configuré."
          onRetry={() => { refetchKpis(); refetchDeals(); refetchNrr() }}
        />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpisLoading || !kpis ? (
          Array.from({ length: 6 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : (
          <>
            <KpiCard kpi={kpis.mrrUnderManagement} icon={<DollarSign className="w-4 h-4" />} />
            <KpiCard kpi={kpis.nrr} icon={<Percent className="w-4 h-4" />} />
            <KpiCard kpi={kpis.churnRate} icon={<TrendingDown className="w-4 h-4" />} />
            <KpiCard kpi={kpis.upsellRevenue} icon={<TrendingUp className="w-4 h-4" />} />
            <KpiCard kpi={kpis.activeDeals} icon={<Layers className="w-4 h-4" />}>
              <MiniDonut
                data={Object.entries(kpis.activeDeals.breakdown)
                  .filter(([, v]) => v > 0)
                  .map(([cat, v]) => ({
                    name: STAGE_CATEGORY_LABELS[cat as StageCategory],
                    value: v,
                    color: STAGE_CATEGORY_COLORS[cat as StageCategory],
                  }))}
              />
            </KpiCard>
            <KpiCard
              kpi={kpis.renewals30d}
              icon={<CalendarClock className="w-4 h-4" />}
              warning={kpis.renewals30d.value > 5}
              danger={kpis.renewals30d.value > 10}
            />
          </>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-medium text-text-secondary mb-4">
            Upsell vs Churn vs Downsell (6 mois)
          </h3>
          {nrrLoading ? (
            <div className="skeleton h-[280px]" />
          ) : nrrTrends?.global ? (
            <BarChartComponent
              data={nrrTrends.global.map((m) => ({
                monthLabel: m.monthLabel,
                upsell: m.upsell,
                churn: m.churn,
                downsell: m.downsell,
              }))}
              series={[
                { key: "upsell", label: "Upsell", color: "#22C55E" },
                { key: "churn", label: "Churn", color: "#EF4444" },
                { key: "downsell", label: "Downsell", color: "#F59E0B" },
              ]}
              xKey="monthLabel"
              stacked
              height={280}
            />
          ) : nrrError ? (
            <ErrorState message="Impossible de charger les tendances NRR" onRetry={refetchNrr} />
          ) : (
            <div className="flex items-center justify-center h-[280px] text-text-muted text-sm">
              Aucune donnée disponible
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="text-sm font-medium text-text-secondary mb-4">
            NRR par CSM — Rolling 6 mois
          </h3>
          {nrrLoading ? (
            <div className="skeleton h-[280px]" />
          ) : nrrTrends?.chartData && nrrTrends.chartData.length > 0 ? (
            <LineChartComponent
              data={nrrTrends.chartData}
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
              referenceLine={{ y: 100, label: "100%", color: "#64748B" }}
            />
          ) : nrrError ? (
            <ErrorState message="Impossible de charger les données NRR" onRetry={refetchNrr} />
          ) : (
            <div className="flex items-center justify-center h-[280px] text-text-muted text-sm">
              Aucune donnée NRR disponible
            </div>
          )}
        </div>
      </div>

      {/* Monthly detail table */}
      {!nrrLoading && nrrTrends?.global && (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-card-border">
            <h3 className="text-sm font-medium text-text-secondary">Detail mensuel</h3>
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
                {nrrTrends.global.map((m) => {
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
      )}

      {/* Recent transactions */}
      <div>
        <h3 className="text-sm font-medium text-text-secondary mb-3">
          Transactions recentes
        </h3>
        {dealsLoading ? (
          <DealsTableSkeleton />
        ) : (
          <DealsTable deals={dealsData?.deals ?? []} />
        )}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <div>
      <Suspense>
        <Header title="Dashboard" subtitle="Vue globale des KPIs Customer Success" />
      </Suspense>
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card h-[340px] skeleton" />
        <div className="card h-[340px] skeleton" />
      </div>
      <DealsTableSkeleton />
    </div>
  )
}
