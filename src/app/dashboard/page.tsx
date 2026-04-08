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
import { STAGE_CATEGORY_COLORS, STAGE_CATEGORY_LABELS, CSM_TEAM, type StageCategory } from "@/lib/constants"
import {
  DollarSign,
  Percent,
  TrendingDown,
  TrendingUp,
  Layers,
  CalendarClock,
} from "lucide-react"

interface NrrTrendsResponse {
  chartData: Record<string, unknown>[]
  global: Array<{ month: string; monthLabel: string; nrr: number; startingMrr: number; upsell: number; churn: number; downsell: number }>
  perCsm: Array<{ csmId: string; csmName: string; color: string; months: Array<{ monthLabel: string; nrr: number }> }>
}

function DashboardContent() {
  const { data: kpis, loading: kpisLoading } = useFetch<DashboardKpis>("/api/kpis")
  const { data: dealsData, loading: dealsLoading } = useFetch<{ deals: Deal[] }>("/api/deals")
  const { data: nrrTrends, loading: nrrLoading } = useFetch<NrrTrendsResponse>("/api/nrr-trends")

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
          ) : (
            <div className="flex items-center justify-center h-[280px] text-text-muted text-sm">
              Aucune donnee disponible
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
                { key: "Global", label: "Global", color: "#E2E8F0", dashed: true },
                ...CSM_TEAM.filter((c) => c.role !== "COO (backup)").map((csm) => ({
                  key: csm.name.split(" ")[0],
                  label: csm.name.split(" ")[0],
                  color: csm.color,
                })),
              ]}
              xKey="monthLabel"
              height={280}
              referenceLine={{ y: 100, label: "100%", color: "#64748B" }}
            />
          ) : (
            <div className="flex items-center justify-center h-[280px] text-text-muted text-sm">
              Aucune donnee NRR disponible
            </div>
          )}
        </div>
      </div>

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
