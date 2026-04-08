"use client"

import { Suspense, useState } from "react"
import { Header } from "@/components/layout/Header"
import { KpiCard, KpiCardSkeleton } from "@/components/charts/KpiCard"
import { BarChartComponent } from "@/components/charts/BarChart"
import { LineChartComponent } from "@/components/charts/LineChart"
import { MiniDonut } from "@/components/charts/DonutChart"
import { DealsTable, DealsTableSkeleton } from "@/components/tables/DealsTable"
import { useFetch } from "@/lib/hooks"
import type { DashboardKpis, Deal } from "@/lib/types"
import { STAGE_CATEGORY_COLORS, STAGE_CATEGORY_LABELS, type StageCategory } from "@/lib/constants"
import { cn, formatCurrency } from "@/lib/utils"
import {
  DollarSign,
  Percent,
  TrendingDown,
  TrendingUp,
  Layers,
  CalendarClock,
  ChevronDown,
  ChevronUp,
} from "lucide-react"

interface DealDetail {
  id: string
  name: string
  amount: number
  attribution: string
  companyName?: string
  ownerId: string | null
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

// Active CSMs for chart series (must match API filter)
const CHART_CSMS = [
  { name: "Farah Bahoui", color: "#8B5CF6" },
  { name: "Antoine de Chanaleilles", color: "#06B6D4" },
  { name: "Marthe Potin", color: "#EC4899" },
  { name: "Fatima Hilmi", color: "#F97316" },
]

function DashboardContent() {
  const { data: kpis, loading: kpisLoading } = useFetch<DashboardKpis>("/api/kpis")
  const { data: dealsData, loading: dealsLoading } = useFetch<{ deals: Deal[] }>("/api/deals")
  const { data: nrrTrends, loading: nrrLoading } = useFetch<NrrTrendsResponse>("/api/nrr-trends")
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null)
  const [expandedCsm, setExpandedCsm] = useState<string | null>(null)

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
          ) : (
            <div className="flex items-center justify-center h-[280px] text-text-muted text-sm">
              Aucune donnee NRR disponible
            </div>
          )}
        </div>
      </div>

      {/* NRR Detail — Transactions per CSM per month */}
      {!nrrLoading && nrrTrends?.perCsm && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-text-secondary">
            Detail NRR — Transactions par CSM par mois
          </h3>
          {nrrTrends.perCsm.map((csm) => (
            <div key={csm.csmId} className="card p-0 overflow-hidden">
              <button
                onClick={() => setExpandedCsm(expandedCsm === csm.csmId ? null : csm.csmId)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-card-hover transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: csm.color }}
                  />
                  <span className="text-sm font-medium text-text-primary">{csm.csmName}</span>
                </div>
                <div className="flex items-center gap-4">
                  {csm.months.map((m) => (
                    <span
                      key={m.month}
                      className={cn(
                        "text-xs font-mono font-medium",
                        m.nrr >= 100 ? "text-positive" : "text-negative"
                      )}
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
                    <thead className="bg-background/50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs text-text-muted">Mois</th>
                        <th className="px-4 py-2 text-right text-xs text-text-muted">MRR Debut</th>
                        <th className="px-4 py-2 text-right text-xs text-text-muted">Upsell</th>
                        <th className="px-4 py-2 text-right text-xs text-text-muted">Churn</th>
                        <th className="px-4 py-2 text-right text-xs text-text-muted">Downsell</th>
                        <th className="px-4 py-2 text-right text-xs text-text-muted">NRR</th>
                        <th className="px-4 py-2 text-right text-xs text-text-muted">Deals</th>
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
                            <td className="px-4 py-2 text-sm text-text-primary font-medium">{m.monthLabel}</td>
                            <td className="px-4 py-2 text-sm font-mono text-text-secondary text-right">{formatCurrency(m.startingMrr, true)}</td>
                            <td className="px-4 py-2 text-sm font-mono text-positive text-right">
                              {m.upsell > 0 ? `+${formatCurrency(m.upsell, true)}` : "-"}
                            </td>
                            <td className="px-4 py-2 text-sm font-mono text-negative text-right">
                              {m.churn > 0 ? `-${formatCurrency(m.churn, true)}` : "-"}
                            </td>
                            <td className="px-4 py-2 text-sm font-mono text-warning text-right">
                              {m.downsell > 0 ? `-${formatCurrency(m.downsell, true)}` : "-"}
                            </td>
                            <td className={cn("px-4 py-2 text-sm font-mono font-medium text-right", m.nrr >= 100 ? "text-positive" : "text-negative")}>
                              {m.nrr.toFixed(1)}%
                            </td>
                            <td className="px-4 py-2 text-sm text-text-muted text-right">
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
                                    <div key={deal.id} className="flex items-center justify-between text-xs py-1">
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
