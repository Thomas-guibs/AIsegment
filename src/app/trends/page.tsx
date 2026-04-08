"use client"

import { Suspense, useState } from "react"
import { Header } from "@/components/layout/Header"
import { BarChartComponent } from "@/components/charts/BarChart"
import { LineChartComponent } from "@/components/charts/LineChart"
import { useFetch } from "@/lib/hooks"
import type { Deal } from "@/lib/types"
import { ATTRIBUTION, CSM_TEAM, getCsmName } from "@/lib/constants"
import { formatCurrency } from "@/lib/utils"
import { startOfWeek, subWeeks, format, isWithinInterval } from "date-fns"
import { fr } from "date-fns/locale"

function TrendsContent() {
  const { data, loading } = useFetch<{ deals: Deal[] }>("/api/deals", { limit: "500" })
  const [viewMode, setViewMode] = useState<"global" | "by_csm">("global")

  const deals = data?.deals ?? []

  // Build 12 weeks of data
  const now = new Date()
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const weekStart = startOfWeek(subWeeks(now, 11 - i), { weekStartsOn: 1 })
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)
    return { start: weekStart, end: weekEnd }
  })

  const weeklyUpsell = weeks.map((week) => {
    const weekDeals = deals.filter(
      (d) =>
        d.attribution === ATTRIBUTION.UPSELL &&
        d.operationDate &&
        isWithinInterval(new Date(d.operationDate), { start: week.start, end: week.end })
    )
    return {
      week: format(week.start, "dd/MM", { locale: fr }),
      value: weekDeals.reduce((sum, d) => sum + d.amount, 0),
    }
  })

  const weeklyChurn = weeks.map((week) => {
    const weekDeals = deals.filter(
      (d) =>
        d.attribution === ATTRIBUTION.CHURN &&
        d.operationDate &&
        isWithinInterval(new Date(d.operationDate), { start: week.start, end: week.end })
    )
    return {
      week: format(week.start, "dd/MM", { locale: fr }),
      value: weekDeals.reduce((sum, d) => sum + d.amount, 0),
    }
  })

  const weeklyNet = weeks.map((week, i) => {
    const upsellDeals = deals.filter(
      (d) =>
        d.attribution === ATTRIBUTION.UPSELL &&
        d.operationDate &&
        isWithinInterval(new Date(d.operationDate), { start: week.start, end: week.end })
    )
    const churnDeals = deals.filter(
      (d) =>
        d.attribution === ATTRIBUTION.CHURN &&
        d.operationDate &&
        isWithinInterval(new Date(d.operationDate), { start: week.start, end: week.end })
    )
    const downsellDeals = deals.filter(
      (d) =>
        d.attribution === ATTRIBUTION.DOWNSELL &&
        d.operationDate &&
        isWithinInterval(new Date(d.operationDate), { start: week.start, end: week.end })
    )

    const upsell = upsellDeals.reduce((sum, d) => sum + d.amount, 0)
    const churn = churnDeals.reduce((sum, d) => sum + d.amount, 0)
    const downsell = downsellDeals.reduce((sum, d) => sum + d.amount, 0)

    return {
      week: format(week.start, "dd/MM", { locale: fr }),
      net: upsell - churn - downsell,
    }
  })

  // CSM activity per week (simplified - based on deal count since engagements may not be available)
  const weeklyActivity = weeks.map((week) => {
    const base: Record<string, unknown> = {
      week: format(week.start, "dd/MM", { locale: fr }),
    }
    for (const csm of CSM_TEAM) {
      base[csm.name.split(" ")[0]] = deals.filter(
        (d) =>
          d.ownerId === csm.id &&
          d.operationDate &&
          isWithinInterval(new Date(d.operationDate), { start: week.start, end: week.end })
      ).length
    }
    return base
  })

  const Toggle = () => (
    <div className="flex items-center gap-1 bg-background rounded-lg p-0.5 border border-card-border">
      <button
        onClick={() => setViewMode("global")}
        className={`px-3 py-1 text-xs rounded-md transition-colors ${
          viewMode === "global"
            ? "bg-accent text-white"
            : "text-text-secondary hover:text-text-primary"
        }`}
      >
        Global
      </button>
      <button
        onClick={() => setViewMode("by_csm")}
        className={`px-3 py-1 text-xs rounded-md transition-colors ${
          viewMode === "by_csm"
            ? "bg-accent text-white"
            : "text-text-secondary hover:text-text-primary"
        }`}
      >
        Par CSM
      </button>
    </div>
  )

  const placeholder = (
    <div className="flex items-center justify-center h-[250px] text-text-muted text-sm">
      Les graphiques se rempliront avec les donnees HubSpot
    </div>
  )

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-end">
        <Toggle />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Upsell weekly */}
        <div className="card">
          <h3 className="text-sm font-medium text-text-secondary mb-4">Upsell hebdomadaire</h3>
          {weeklyUpsell.some((w) => w.value > 0) ? (
            <BarChartComponent
              data={weeklyUpsell}
              series={[{ key: "value", label: "Upsell", color: "#22C55E" }]}
              xKey="week"
              height={250}
            />
          ) : (
            placeholder
          )}
        </div>

        {/* Churn weekly */}
        <div className="card">
          <h3 className="text-sm font-medium text-text-secondary mb-4">Churn hebdomadaire</h3>
          {weeklyChurn.some((w) => w.value > 0) ? (
            <BarChartComponent
              data={weeklyChurn}
              series={[{ key: "value", label: "Churn", color: "#EF4444" }]}
              xKey="week"
              height={250}
            />
          ) : (
            placeholder
          )}
        </div>

        {/* Net expansion */}
        <div className="card">
          <h3 className="text-sm font-medium text-text-secondary mb-4">Net Expansion</h3>
          {weeklyNet.some((w) => w.net !== 0) ? (
            <LineChartComponent
              data={weeklyNet}
              series={[{ key: "net", label: "Net (Upsell - Churn - Downsell)", color: "#2563EB" }]}
              xKey="week"
              height={250}
              formatValue={(v) => formatCurrency(v, true)}
              referenceLine={{ y: 0, label: "Breakeven", color: "#64748B" }}
            />
          ) : (
            placeholder
          )}
        </div>

        {/* CSM Activity */}
        <div className="card">
          <h3 className="text-sm font-medium text-text-secondary mb-4">Activite CSM (transactions/semaine)</h3>
          {deals.length > 0 ? (
            <BarChartComponent
              data={weeklyActivity}
              series={CSM_TEAM.slice(0, 5).map((csm) => ({
                key: csm.name.split(" ")[0],
                label: csm.name.split(" ")[0],
                color: csm.color,
              }))}
              xKey="week"
              stacked
              height={250}
            />
          ) : (
            placeholder
          )}
        </div>
      </div>
    </div>
  )
}

export default function TrendsPage() {
  return (
    <div>
      <Suspense>
        <Header title="Tendances" subtitle="Analyse temporelle sur 12 semaines glissantes" />
      </Suspense>
      <Suspense>
        <TrendsContent />
      </Suspense>
    </div>
  )
}
