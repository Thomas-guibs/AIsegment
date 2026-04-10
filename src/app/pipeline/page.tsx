"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { Header } from "@/components/layout/Header"
import { useFetch } from "@/lib/hooks"
import { cn, formatCurrency } from "@/lib/utils"
import { ArrowRight } from "lucide-react"

interface PipeDeal {
  id: string
  name: string
  amount: number
  mrr: number
  attribution: string | null
  renewalDate: string | null
  companyName?: string
  companyId?: string
  ownerId: string | null
  dealType: string
}

interface PipeStage {
  stageId: string
  stageLabel: string
  order: number
  deals: PipeDeal[]
  totalAmount: number
  totalMrr: number
  count: number
}

interface CsmPipeline {
  csmId: string
  csmName: string
  initials: string
  color: string
  stages: PipeStage[]
  totalDeals: number
  totalAmount: number
  totalMrr: number
}

interface GlobalStage {
  stageId: string
  stageLabel: string
  count: number
  totalAmount: number
}

interface PipelineData {
  csmPipelines: CsmPipeline[]
  globalStages: GlobalStage[]
  totalDeals: number
  totalAmount: number
}

function PipelineContent() {
  const { data, loading } = useFetch<PipelineData>("/api/pipeline")
  const [activeTab, setActiveTab] = useState<string>("all")

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="skeleton h-10" />
        <div className="skeleton h-[500px]" />
      </div>
    )
  }

  if (!data) return null

  const { csmPipelines, globalStages, totalDeals, totalAmount } = data

  // Build unified stages for "all" tab
  const allStages: PipeStage[] = globalStages.map((gs) => {
    const allDealsForStage: PipeDeal[] = []
    for (const csm of csmPipelines) {
      const stage = csm.stages.find((s) => s.stageId === gs.stageId)
      if (stage) {
        allDealsForStage.push(
          ...stage.deals.map((d) => ({ ...d, _csmColor: csm.color, _csmInitials: csm.initials, _csmName: csm.csmName } as any))
        )
      }
    }
    allDealsForStage.sort((a, b) => b.amount - a.amount)
    return {
      stageId: gs.stageId,
      stageLabel: gs.stageLabel,
      order: 0,
      deals: allDealsForStage,
      totalAmount: gs.totalAmount,
      totalMrr: 0,
      count: gs.count,
    }
  })

  // Active CSM's stages
  const activeCsm = activeTab !== "all" ? csmPipelines.find((c) => c.csmId === activeTab) : null
  const displayStages = activeCsm ? activeCsm.stages : allStages

  return (
    <div className="p-6 space-y-4">
      {/* Tabs: All + per CSM */}
      <div className="flex items-center gap-1 border-b border-card-border pb-0">
        <button
          onClick={() => setActiveTab("all")}
          className={cn(
            "px-3 py-2 text-[13px] font-medium border-b-2 transition-colors -mb-px",
            activeTab === "all"
              ? "border-accent text-accent"
              : "border-transparent text-text-secondary hover:text-text-primary"
          )}
        >
          Tous ({totalDeals})
        </button>
        {csmPipelines.map((csm) => (
          <button
            key={csm.csmId}
            onClick={() => setActiveTab(csm.csmId)}
            className={cn(
              "px-3 py-2 text-[13px] font-medium border-b-2 transition-colors -mb-px flex items-center gap-1.5",
              activeTab === csm.csmId
                ? "border-accent text-accent"
                : "border-transparent text-text-secondary hover:text-text-primary"
            )}
          >
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold text-white"
              style={{ backgroundColor: csm.color }}
            >
              {csm.initials}
            </span>
            {csm.csmName.split(" ")[0]}
            <span className="text-text-muted text-2xs">({csm.totalDeals})</span>
          </button>
        ))}
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-2">
        {displayStages.map((stage, i) => (
          <div key={stage.stageId} className="flex items-center gap-2 flex-1">
            <div className="flex-1 bg-card rounded-lg p-3 border border-card-border">
              <div className="text-2xs text-text-muted mb-0.5">{stage.stageLabel}</div>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-mono font-semibold text-text-primary">{stage.count}</span>
                <span className="text-2xs font-mono text-text-secondary">{formatCurrency(stage.totalAmount, true)}</span>
              </div>
            </div>
            {i < displayStages.length - 1 && (
              <ArrowRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            )}
          </div>
        ))}
      </div>

      {/* Kanban columns */}
      <div className="grid gap-3 min-h-[400px]" style={{ gridTemplateColumns: `repeat(${displayStages.length}, minmax(0, 1fr))` }}>
        {displayStages.map((stage) => (
          <div key={stage.stageId} className="bg-row-alt rounded-xl border border-card-border p-2.5">
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="text-2xs font-medium text-text-muted uppercase tracking-wider">
                {stage.stageLabel}
              </span>
              {stage.count > 0 && (
                <span className="text-2xs font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded-full">
                  {stage.count}
                </span>
              )}
            </div>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {stage.deals.map((deal: any) => (
                <div
                  key={deal.id}
                  className="bg-card rounded-lg border border-card-border p-2.5 hover:border-accent/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-1 mb-1">
                    <span className="text-[12px] font-medium text-text-primary leading-tight">
                      {deal.companyName ?? deal.name}
                    </span>
                    <span
                      className={cn(
                        "text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0",
                        deal.dealType === "upsell"
                          ? "bg-emerald-50 text-emerald-600"
                          : deal.dealType === "renewal+upsell"
                            ? "bg-blue-50 text-blue-600"
                            : "bg-gray-100 text-gray-500"
                      )}
                    >
                      {deal.dealType === "upsell" ? "Upsell" : deal.dealType === "renewal+upsell" ? "R+U" : "Renewal"}
                    </span>
                  </div>
                  {deal.companyName && (
                    <div className="text-2xs text-text-muted truncate mb-1.5">{deal.name}</div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-mono font-medium text-text-primary">
                      {formatCurrency(deal.amount)}
                    </span>
                    {/* CSM avatar in "All" view */}
                    {activeTab === "all" && deal._csmInitials && (
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-semibold text-white"
                        style={{ backgroundColor: deal._csmColor }}
                        title={deal._csmName}
                      >
                        {deal._csmInitials}
                      </span>
                    )}
                    {activeTab !== "all" && deal.renewalDate && (
                      <span className="text-2xs text-text-muted">
                        {deal.renewalDate.slice(0, 10)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {stage.count === 0 && (
                <div className="text-2xs text-text-muted text-center py-8 opacity-50">
                  Aucun deal
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PipelinePage() {
  return (
    <div>
      <Suspense>
        <Header title="Pipeline" subtitle="Renouvellements et upsells en cours" />
      </Suspense>
      <Suspense>
        <PipelineContent />
      </Suspense>
    </div>
  )
}
