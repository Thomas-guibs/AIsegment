"use client"

import { Suspense, useState } from "react"
import { Header } from "@/components/layout/Header"
import { KpiCard, KpiCardSkeleton } from "@/components/charts/KpiCard"
import { HeatmapCalendar } from "@/components/charts/HeatmapCalendar"
import { useFetch } from "@/lib/hooks"
import type { RenewalDeal, RenewalKpis } from "@/lib/types"
import { cn, formatCurrency, formatDateFR, daysFromNow } from "@/lib/utils"
import { getCsmName, CUSTOMER_STAGE_LABELS } from "@/lib/constants"
import { CalendarDays, Clock, Calendar, BarChart3 } from "lucide-react"
import { format } from "date-fns"
import { fr } from "date-fns/locale"

function RenewalsContent() {
  const { data, loading } = useFetch<{ deals: RenewalDeal[]; kpis: RenewalKpis }>("/api/renewals")
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

      {/* Heatmap + Side panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card">
          <h3 className="text-sm font-medium text-text-secondary mb-4">
            Calendrier des renouvellements (90 jours)
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
              {selectedDayDeals.map((deal) => (
                <div key={deal.id} className="p-3 bg-background rounded-lg border border-card-border">
                  <div className="text-sm font-medium text-text-primary">{deal.companyName ?? deal.name}</div>
                  <div className="text-xs text-text-muted mt-1">{deal.name}</div>
                  <div className="flex justify-between mt-2 text-xs">
                    <span className="font-mono text-accent">{formatCurrency(deal.mrr)} MRR</span>
                    <span className="text-text-secondary">{deal.ownerId ? getCsmName(deal.ownerId) : "-"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Renewals table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-card-border">
          <h3 className="text-sm font-medium text-text-secondary">
            Tous les renouvellements (90 jours)
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
                      {deal.companyName ?? "-"}
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
