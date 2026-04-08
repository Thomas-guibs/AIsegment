"use client"

import { Suspense, useState } from "react"
import { Header } from "@/components/layout/Header"
import { useFetch } from "@/lib/hooks"
import { cn, formatCurrency } from "@/lib/utils"
import { getCsmName } from "@/lib/constants"
import { ChevronDown, ChevronUp, ArrowRight } from "lucide-react"

interface PipeDeal {
  id: string
  name: string
  amount: number
  mrr: number
  attribution: string | null
  renewalDate: string | null
  companyName?: string
  ownerId: string | null
  dealType: "renewal" | "upsell" | "renewal+upsell"
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
  const [expandedCsm, setExpandedCsm] = useState<string | null>(null)

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="skeleton h-24" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-40" />
        ))}
      </div>
    )
  }

  if (!data) return null

  const { csmPipelines, globalStages, totalDeals, totalAmount } = data

  return (
    <div className="p-6 space-y-6">
      {/* Global funnel summary */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-text-secondary">
            Pipeline global — {totalDeals} deals actifs
          </h3>
          <span className="text-sm font-mono text-text-primary font-medium">
            {formatCurrency(totalAmount)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {globalStages.map((stage, i) => (
            <div key={stage.stageId} className="flex items-center gap-2 flex-1">
              <div className="flex-1 bg-background rounded-lg p-3 border border-card-border">
                <div className="text-xs text-text-muted mb-1">{stage.stageLabel}</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-mono font-semibold text-text-primary">{stage.count}</span>
                  <span className="text-xs font-mono text-text-secondary">{formatCurrency(stage.totalAmount, true)}</span>
                </div>
              </div>
              {i < globalStages.length - 1 && (
                <ArrowRight className="w-4 h-4 text-text-muted flex-shrink-0" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Per-CSM pipelines */}
      {csmPipelines.map((csm) => {
        const isExpanded = expandedCsm === csm.csmId
        const hasDeals = csm.totalDeals > 0

        return (
          <div key={csm.csmId} className="card p-0 overflow-hidden">
            {/* CSM header */}
            <button
              onClick={() => setExpandedCsm(isExpanded ? null : csm.csmId)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-card-hover transition-colors"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                  style={{ backgroundColor: csm.color }}
                >
                  {csm.initials}
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-text-primary">{csm.csmName}</div>
                  <div className="text-xs text-text-muted">
                    {csm.totalDeals} deal{csm.totalDeals > 1 ? "s" : ""} en pipe
                    {csm.totalAmount > 0 && ` — ${formatCurrency(csm.totalAmount)}`}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                {/* Mini stage indicators */}
                <div className="hidden md:flex items-center gap-1">
                  {csm.stages.map((stage) => (
                    <div
                      key={stage.stageId}
                      className={cn(
                        "w-7 h-7 rounded flex items-center justify-center text-[10px] font-mono font-medium",
                        stage.count > 0
                          ? "bg-accent/20 text-accent"
                          : "bg-background text-text-muted"
                      )}
                      title={`${stage.stageLabel}: ${stage.count}`}
                    >
                      {stage.count}
                    </div>
                  ))}
                </div>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-text-muted" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-text-muted" />
                )}
              </div>
            </button>

            {/* Expanded: stage columns with deals */}
            {isExpanded && (
              <div className="border-t border-card-border animate-fade-in">
                {hasDeals ? (
                  <div className="grid grid-cols-5 divide-x divide-card-border">
                    {csm.stages.map((stage) => (
                      <div key={stage.stageId} className="p-3 min-h-[200px]">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                            {stage.stageLabel}
                          </span>
                          {stage.count > 0 && (
                            <span className="text-[10px] font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                              {stage.count}
                            </span>
                          )}
                        </div>
                        <div className="space-y-2">
                          {stage.deals.map((deal) => (
                            <div
                              key={deal.id}
                              className="bg-background rounded-lg border border-card-border p-2.5 hover:border-accent/30 transition-colors"
                            >
                              <div className="flex items-start justify-between gap-1 mb-1">
                                <span className="text-xs font-medium text-text-primary leading-tight">
                                  {deal.companyName ?? deal.name}
                                </span>
                                <span
                                  className={cn(
                                    "text-[9px] px-1.5 py-0.5 rounded font-medium flex-shrink-0",
                                    deal.dealType === "upsell"
                                      ? "bg-positive/15 text-positive"
                                      : deal.dealType === "renewal+upsell"
                                        ? "bg-accent/15 text-accent"
                                        : "bg-text-muted/15 text-text-secondary"
                                  )}
                                >
                                  {deal.dealType === "upsell"
                                    ? "Upsell"
                                    : deal.dealType === "renewal+upsell"
                                      ? "Renew+Up"
                                      : "Renewal"}
                                </span>
                              </div>
                              {deal.companyName && (
                                <div className="text-[10px] text-text-muted truncate mb-1">{deal.name}</div>
                              )}
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-mono font-medium text-text-primary">
                                  {formatCurrency(deal.amount)}
                                </span>
                                {deal.renewalDate && (
                                  <span className="text-[10px] text-text-muted">
                                    {deal.renewalDate.slice(0, 10)}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                          {stage.count === 0 && (
                            <div className="text-xs text-text-muted text-center py-6 opacity-50">
                              Aucun deal
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 text-center text-sm text-text-muted">
                    Aucun deal en pipe pour ce CSM
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function PipelinePage() {
  return (
    <div>
      <Suspense>
        <Header title="Pipeline CSM" subtitle="Pipe de renouvellements et upsells par CSM" />
      </Suspense>
      <Suspense>
        <PipelineContent />
      </Suspense>
    </div>
  )
}
