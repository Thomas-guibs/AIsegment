"use client"

import { Suspense, useState, useMemo } from "react"
import Link from "next/link"
import { Header } from "@/components/layout/Header"
import { KpiCard, KpiCardSkeleton } from "@/components/charts/KpiCard"
import { BarChartComponent } from "@/components/charts/BarChart"
import { HeatmapCalendar } from "@/components/charts/HeatmapCalendar"
import { useFetch } from "@/lib/hooks"
import type { RenewalDeal, RenewalKpis } from "@/lib/types"
import { cn, formatCurrency, formatDateFR, daysFromNow } from "@/lib/utils"
import { getCsmName, CUSTOMER_STAGE_LABELS } from "@/lib/constants"
import { CalendarDays, Clock, Calendar, BarChart3 } from "lucide-react"
import { format, startOfQuarter } from "date-fns"
import { fr } from "date-fns/locale"

const WON_STAGES = ["closedlost", "143474109", "878353129"]
const CHURN_STAGES = ["1220133077", "124302781"]

function RenewalStats({ deals }: { deals: RenewalDeal[] }) {
  const [statMode, setStatMode] = useState<"month" | "quarter" | "year">("quarter")

  const chartData = useMemo(() => {
    const buckets: Record<string, { won: number; churn: number; open: number; wonCount: number; churnCount: number; openCount: number }> = {}

    for (const deal of deals) {
      if (!deal.renewalDate) continue
      const d = new Date(deal.renewalDate)
      let key: string
      if (statMode === "month") {
        key = format(d, "MMM yy", { locale: fr })
      } else if (statMode === "quarter") {
        const q = Math.ceil((d.getMonth() + 1) / 3)
        key = `Q${q} ${d.getFullYear()}`
      } else {
        key = `${d.getFullYear()}`
      }

      if (!buckets[key]) buckets[key] = { won: 0, churn: 0, open: 0, wonCount: 0, churnCount: 0, openCount: 0 }

      if (WON_STAGES.includes(deal.stage)) {
        buckets[key].won += Math.abs(deal.amount)
        buckets[key].wonCount++
      } else if (CHURN_STAGES.includes(deal.stage)) {
        buckets[key].churn += Math.abs(deal.amount)
        buckets[key].churnCount++
      } else {
        buckets[key].open += Math.abs(deal.amount)
        buckets[key].openCount++
      }
    }

    return Object.entries(buckets).map(([label, data]) => ({
      label,
      "Renouvelé": data.won,
      "Churn": -data.churn,
      "En cours": data.open,
      wonCount: data.wonCount,
      churnCount: data.churnCount,
      openCount: data.openCount,
    }))
  }, [deals, statMode])

  // Summary totals
  const totals = useMemo(() => {
    let won = 0, churn = 0, open = 0
    for (const d of chartData) {
      won += d["Renouvelé"]
      churn += Math.abs(d["Churn"])
      open += d["En cours"]
    }
    return { won, churn, open }
  }, [chartData])

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-text-secondary">
          Statistiques renouvellements
        </h3>
        <div className="flex items-center gap-1 bg-background rounded-lg p-0.5 border border-card-border">
          {(["month", "quarter", "year"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setStatMode(m)}
              className={cn("px-2.5 py-1 text-2xs rounded-md font-medium transition-colors", statMode === m ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary")}
            >
              {m === "month" ? "Mois" : m === "quarter" ? "Trimestre" : "Année"}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-positive/5 rounded-lg p-3 border border-positive/10">
          <div className="text-2xs text-positive font-medium mb-0.5">Renouvelés</div>
          <div className="text-lg font-mono font-semibold text-positive">{formatCurrency(totals.won, true)}</div>
        </div>
        <div className="bg-negative/5 rounded-lg p-3 border border-negative/10">
          <div className="text-2xs text-negative font-medium mb-0.5">Churn</div>
          <div className="text-lg font-mono font-semibold text-negative">{formatCurrency(totals.churn, true)}</div>
        </div>
        <div className="bg-warning/5 rounded-lg p-3 border border-warning/10">
          <div className="text-2xs text-warning font-medium mb-0.5">En cours</div>
          <div className="text-lg font-mono font-semibold text-warning">{formatCurrency(totals.open, true)}</div>
        </div>
      </div>

      {/* Chart */}
      <BarChartComponent
        data={chartData}
        series={[
          { key: "Renouvelé", label: "Renouvelé", color: "#2BA85D" },
          { key: "En cours", label: "En cours", color: "#E8923A" },
          { key: "Churn", label: "Churn", color: "#DC3545" },
        ]}
        xKey="label"
        stacked
        height={250}
      />
    </div>
  )
}

function RenewalsContent() {
  const { data, loading } = useFetch<{ deals: RenewalDeal[]; kpis: RenewalKpis }>("/api/renewals", { days: "365" })
  const [selectedDayDeals, setSelectedDayDeals] = useState<RenewalDeal[]>([])
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  const deals = data?.deals ?? []
  const kpis = data?.kpis

  function handleDayClick(date: Date, dayDeals: RenewalDeal[]) {
    setSelectedDate(date)
    setSelectedDayDeals(dayDeals)
  }

  return (
    <div className="p-6 space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading || !kpis ? (
          Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : (
          <>
            <KpiCard
              kpi={{
                value: kpis.thisMonth.count,
                previousValue: 0,
                delta: 0,
                deltaDirection: "flat",
                label: "Ce mois",
                format: "number",
              }}
              icon={<CalendarDays className="w-4 h-4" />}
            >
              <span className="text-xs text-text-muted font-mono">
                {formatCurrency(kpis.thisMonth.mrr)} MRR
              </span>
            </KpiCard>
            <KpiCard
              kpi={{
                value: kpis.nextMonth.count,
                previousValue: 0,
                delta: 0,
                deltaDirection: "flat",
                label: "Mois prochain",
                format: "number",
              }}
              icon={<Clock className="w-4 h-4" />}
            >
              <span className="text-xs text-text-muted font-mono">
                {formatCurrency(kpis.nextMonth.mrr)} MRR
              </span>
            </KpiCard>
            <KpiCard
              kpi={{
                value: kpis.next90Days.count,
                previousValue: 0,
                delta: 0,
                deltaDirection: "flat",
                label: "90 prochains jours",
                format: "number",
              }}
              icon={<Calendar className="w-4 h-4" />}
            >
              <span className="text-xs text-text-muted font-mono">
                {formatCurrency(kpis.next90Days.mrr)} MRR
              </span>
            </KpiCard>
            <KpiCard
              kpi={{
                value: kpis.renewalRate,
                previousValue: 0,
                delta: 0,
                deltaDirection: "flat",
                label: "Taux de renouvellement",
                format: "percent",
              }}
              icon={<BarChart3 className="w-4 h-4" />}
            />
          </>
        )}
      </div>

      {/* Period stats: won vs churn by month/quarter/year */}
      {!loading && deals.length > 0 && (
        <RenewalStats deals={deals} />
      )}

      {/* Heatmap + Side panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card">
          <h3 className="text-sm font-medium text-text-secondary mb-4">
            Calendrier des renouvellements
          </h3>
          {loading ? (
            <div className="skeleton h-64" />
          ) : (
            <HeatmapCalendar deals={deals} onDayClick={handleDayClick} />
          )}
        </div>

        <div className="card">
          <h3 className="text-sm font-medium text-text-secondary mb-4">
            {selectedDate
              ? format(selectedDate, "dd MMMM yyyy", { locale: fr })
              : "Selectionnez un jour"}
          </h3>
          {selectedDayDeals.length === 0 ? (
            <p className="text-text-muted text-sm">
              Cliquez sur un jour du calendrier pour voir les renouvellements.
            </p>
          ) : (
            <div className="space-y-2">
              {selectedDayDeals.map((deal) => {
                const wonStages = ["closedlost", "143474109", "878353129"]
                const churnStages = ["1220133077", "124302781"]
                const statusColor = wonStages.includes(deal.stage) ? "border-positive/40" : churnStages.includes(deal.stage) ? "border-negative/40" : "border-warning/40"
                const statusLabel = wonStages.includes(deal.stage) ? "Won" : churnStages.includes(deal.stage) ? "Churn" : "En cours"
                const statusTextColor = wonStages.includes(deal.stage) ? "text-positive" : churnStages.includes(deal.stage) ? "text-negative" : "text-warning"
                return (
                  <div key={deal.id} className={cn("p-3 bg-background rounded-lg border", statusColor)}>
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-text-primary">{deal.companyName ?? deal.name}</div>
                      <span className={cn("text-[10px] font-medium", statusTextColor)}>{statusLabel}</span>
                    </div>
                    <div className="text-xs text-text-muted mt-1">{deal.name}</div>
                    <div className="flex justify-between mt-2 text-xs">
                      <span className="font-mono text-accent">{formatCurrency(deal.mrr)} MRR</span>
                      <span className="text-text-secondary">{deal.ownerId ? getCsmName(deal.ownerId) : "-"}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Renewals table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-card-border">
          <h3 className="text-sm font-medium text-text-secondary">
            Tous les renouvellements
          </h3>
        </div>
        {loading ? (
          <div className="p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton h-10 mb-2" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-card border-b border-card-border">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Company</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Deal</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">MRR</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Renewal</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Jours</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">CSM</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Stage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {deals.map((deal, i) => (
                  <tr
                    key={deal.id}
                    className={cn(
                      "hover:bg-card-hover transition-colors",
                      i % 2 === 1 && "bg-background/30"
                    )}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-text-primary">
                      {deal.companyId ? (
                        <Link href={`/account/${deal.companyId}`} className="hover:text-accent transition-colors hover:underline">
                          {deal.companyName ?? "-"}
                        </Link>
                      ) : (deal.companyName ?? "-")}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">{deal.name}</td>
                    <td className="px-4 py-3 text-sm font-mono text-text-primary">
                      {formatCurrency(deal.mrr)}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {deal.renewalDate ? formatDateFR(deal.renewalDate) : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "font-mono text-sm font-medium",
                          deal.daysUntilRenewal <= 7
                            ? "text-negative"
                            : deal.daysUntilRenewal <= 30
                              ? "text-warning"
                              : "text-text-primary"
                        )}
                      >
                        J-{deal.daysUntilRenewal}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {deal.ownerId ? getCsmName(deal.ownerId) : "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">
                      {CUSTOMER_STAGE_LABELS[deal.stage] ?? deal.stage}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default function RenewalsPage() {
  return (
    <div>
      <Suspense>
        <Header title="Renouvellements" subtitle="Suivi des echéances et calendrier" />
      </Suspense>
      <Suspense>
        <RenewalsContent />
      </Suspense>
    </div>
  )
}
