"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { Header } from "@/components/layout/Header"
import { KpiCard, KpiCardSkeleton } from "@/components/charts/KpiCard"
import { DonutChart } from "@/components/charts/DonutChart"
import { PortfolioTable } from "@/components/tables/PortfolioTable"
import { useFetch } from "@/lib/hooks"
import type { Company, Deal, CsmPortfolio } from "@/lib/types"
import { formatNrr, type MetricsResponse } from "@/lib/engine/client-types"
import {
  CSM_TEAM,
  CUSTOMER_STAGE_CATEGORIES,
  STAGE_CATEGORY_COLORS,
  STAGE_CATEGORY_LABELS,
  ACTIVE_STAGE_IDS,
  type StageCategory,
} from "@/lib/constants"
import { cn, formatCurrency } from "@/lib/utils"

function PortfolioContent() {
  const { data: companiesData, loading: compLoading } = useFetch<{ companies: Company[] }>("/api/companies")
  const { data: pipelineData, loading: pipeLoading } = useFetch<{ deals: Deal[] }>("/api/pipeline")
  // MRR, NRR and movements come from the engine — read point-in-time at the 1st
  // of the month, with churned accounts already out. Never re-derived here.
  const { data: metrics, loading: metricsLoading } = useFetch<MetricsResponse>("/api/metrics", {
    months: "1",
  })
  const [selectedCsm, setSelectedCsm] = useState<string | null>(null)

  const loading = compLoading || pipeLoading || metricsLoading
  const companies = companiesData?.companies ?? []
  const pipelineDeals = pipelineData?.deals ?? []

  // Build portfolios per CSM
  const portfolios: CsmPortfolio[] = CSM_TEAM.map((csm) => {
    const csmDeals = pipelineDeals.filter((d) => d.ownerId === csm.id)

    const engineCsm = metrics?.perCsm.find((c) => c.csmId === csm.id)
    const thisMonth = engineCsm?.months[engineCsm.months.length - 1]

    const totalMrr = thisMonth?.startingMrr ?? 0
    const accountCount = thisMonth?.accountCount ?? 0
    const upsellThisMonth = thisMonth?.upsell ?? 0
    const churnThisMonth = thisMonth?.churn ?? 0
    const nrr = thisMonth?.nrr ?? null

    // Stage breakdown
    const stageBreakdown: Record<StageCategory, number> = {
      onboarding: 0,
      active: 0,
      at_risk: 0,
      churned: 0,
      disqualified: 0,
    }
    for (const deal of csmDeals) {
      const cat = CUSTOMER_STAGE_CATEGORIES[deal.stage]
      if (cat) stageBreakdown[cat]++
    }

    // Health = % active / total
    const activeCount = stageBreakdown.active
    const totalCount = csmDeals.filter((d) => ACTIVE_STAGE_IDS.includes(d.stage)).length
    const healthPercent = totalCount > 0 ? (activeCount / totalCount) * 100 : 0

    // Renewals 30d
    const now = new Date()
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    const renewals30d = csmDeals.filter((d) => {
      if (!d.renewalDate) return false
      const rd = new Date(d.renewalDate)
      return rd >= now && rd <= in30Days
    }).length

    return {
      csmId: csm.id,
      csmName: csm.name,
      csmRole: csm.role,
      initials: csm.initials,
      color: csm.color,
      accountCount,
      totalMrr,
      // An empty portfolio has no NRR; the table renders the absence as such.
      nrr: nrr ?? 0,
      nrrAvailable: nrr != null,
      upsellThisMonth,
      churnThisMonth,
      renewals30d,
      healthPercent,
      stageBreakdown,
    }
  })

  // Detail view for selected CSM
  const selectedPortfolio = selectedCsm ? portfolios.find((p) => p.csmId === selectedCsm) : null
  const selectedCompanies = selectedCsm ? companies.filter((c) => c.ownerId === selectedCsm) : []
  const selectedMovements = selectedCsm
    ? metrics?.perCsm.find((c) => c.csmId === selectedCsm)?.movements ?? []
    : []

  return (
    <div className="p-6 space-y-6">
      {/* CSM Cards overview */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <KpiCardSkeleton key={i} />)
          : portfolios.map((p) => (
              <div
                key={p.csmId}
                className={cn(
                  "card-hover cursor-pointer",
                  selectedCsm === p.csmId && "ring-2 ring-accent"
                )}
                onClick={() => setSelectedCsm(selectedCsm === p.csmId ? null : p.csmId)}
              >
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium text-white"
                    style={{ backgroundColor: p.color }}
                  >
                    {p.initials}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-text-primary">{p.csmName.split(" ")[0]}</div>
                    <div className="text-[10px] text-text-muted">{p.accountCount} comptes</div>
                  </div>
                </div>
                <div className="font-mono text-lg font-semibold text-text-primary">
                  {formatCurrency(p.totalMrr, true)}
                </div>
                <div className="flex gap-2 mt-1 text-xs">
                  <span
                    className={cn(
                      "font-medium",
                      !p.nrrAvailable
                        ? "text-text-muted"
                        : p.nrr >= 100
                          ? "text-positive"
                          : "text-negative"
                    )}
                    title="NRR du mois en cours — portefeuille lu au 1er, comptes churnés exclus"
                  >
                    NRR {formatNrr(p.nrrAvailable ? p.nrr : null)}
                  </span>
                  <span className={cn(
                    "font-medium",
                    p.healthPercent >= 80 ? "text-positive" :
                    p.healthPercent >= 60 ? "text-warning" : "text-negative"
                  )}>
                    {p.healthPercent.toFixed(0)}% health
                  </span>
                </div>
              </div>
            ))}
      </div>

      {/* Comparative table */}
      <div>
        <h3 className="text-sm font-medium text-text-secondary mb-3">
          Tableau comparatif
        </h3>
        {loading ? (
          <div className="card skeleton h-64" />
        ) : (
          <PortfolioTable
            portfolios={portfolios}
            onCsmClick={(id) => setSelectedCsm(selectedCsm === id ? null : id)}
          />
        )}
      </div>

      {/* Drill-down */}
      {selectedPortfolio && (
        <div className="card animate-slide-up">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium text-white"
              style={{ backgroundColor: selectedPortfolio.color }}
            >
              {selectedPortfolio.initials}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-text-primary">{selectedPortfolio.csmName}</h3>
              <p className="text-xs text-text-muted">{selectedPortfolio.csmRole} — {selectedPortfolio.accountCount} comptes</p>
            </div>
          </div>

          {selectedMovements.length > 0 && (
            <div className="mb-6">
              <h4 className="text-xs font-medium text-text-secondary mb-2">
                Mouvements du mois retenus par le calcul
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-card-border">
                    <tr>
                      <th className="px-4 py-2 text-left text-[10px] font-medium text-text-muted uppercase">Compte</th>
                      <th className="px-4 py-2 text-left text-[10px] font-medium text-text-muted uppercase">Deal</th>
                      <th className="px-4 py-2 text-left text-[10px] font-medium text-text-muted uppercase">Type</th>
                      <th className="px-4 py-2 text-left text-[10px] font-medium text-text-muted uppercase">Date de réf.</th>
                      <th className="px-4 py-2 text-right text-[10px] font-medium text-text-muted uppercase">Montant</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-card-border">
                    {selectedMovements.map((mv) => (
                      <tr key={mv.id} className="hover:bg-card-hover transition-colors">
                        <td className="px-4 py-2 text-xs text-text-primary">{mv.accountName ?? "—"}</td>
                        <td className="px-4 py-2 text-xs text-text-secondary">{mv.name}</td>
                        <td className="px-4 py-2 text-xs text-text-muted capitalize">{mv.type}</td>
                        <td className="px-4 py-2 text-xs font-mono text-text-muted">{mv.referenceDate ?? "—"}</td>
                        <td className={cn(
                          "px-4 py-2 text-xs font-mono text-right",
                          mv.type === "upsell" ? "text-positive" : mv.type === "churn" ? "text-negative" : "text-warning"
                        )}>
                          {mv.type === "upsell" ? "+" : "-"}{formatCurrency(mv.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <h4 className="text-xs font-medium text-text-secondary mb-2">Comptes du portefeuille</h4>
            <table className="w-full">
              <thead className="border-b border-card-border">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Company</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Plan</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">MRR</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {selectedCompanies.map((company, i) => (
                  <tr
                    key={company.id}
                    className={cn(
                      "hover:bg-card-hover transition-colors",
                      i % 2 === 1 && "bg-background/30"
                    )}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-text-primary">
                      <Link href={`/account/${company.id}`} className="hover:text-accent transition-colors hover:underline">
                        {company.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">{company.plan ?? "-"}</td>
                    <td className="px-4 py-3 text-sm font-mono text-text-primary">{formatCurrency(company.mrr)}</td>
                    <td className="px-4 py-3 text-sm font-mono text-text-secondary">{company.roi > 0 ? `${company.roi.toFixed(1)}x` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PortfolioPage() {
  return (
    <div>
      <Suspense>
        <Header title="Portefeuille CSM" subtitle="Vue par CSM et comparaison d'equipe" />
      </Suspense>
      <Suspense>
        <PortfolioContent />
      </Suspense>
    </div>
  )
}
