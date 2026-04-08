"use client"

import { Suspense } from "react"
import { Header } from "@/components/layout/Header"
import { FunnelChart } from "@/components/charts/FunnelChart"
import { BarChartComponent } from "@/components/charts/BarChart"
import { DealsTable, DealsTableSkeleton } from "@/components/tables/DealsTable"
import { useFetch } from "@/lib/hooks"
import type { Deal, PipelineFunnelStep, StageAging } from "@/lib/types"
import { cn, formatCurrency } from "@/lib/utils"
import { getCsmName, CUSTOMER_STAGE_LABELS } from "@/lib/constants"

interface PipelineData {
  funnel: PipelineFunnelStep[]
  stageAging: StageAging[]
  newUpsellDeals: Deal[]
  newChurnDeals: Deal[]
  deals: Deal[]
  totalDeals: number
}

function PipelineContent() {
  const { data, loading } = useFetch<PipelineData>("/api/pipeline")

  const funnel = data?.funnel ?? []
  const stageAging = data?.stageAging ?? []
  const newUpsellDeals = data?.newUpsellDeals ?? []
  const newChurnDeals = data?.newChurnDeals ?? []
  const deals = data?.deals ?? []

  return (
    <div className="p-6 space-y-6">
      {/* Funnel */}
      <div className="card">
        <h3 className="text-sm font-medium text-text-secondary mb-4">
          Funnel Pipeline Customers Stage
        </h3>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-10" />
            ))}
          </div>
        ) : (
          <FunnelChart steps={funnel} />
        )}
      </div>

      {/* Aging + New deals */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Aging analysis */}
        <div className="card">
          <h3 className="text-sm font-medium text-text-secondary mb-4">
            Aging par stage (jours moyens)
          </h3>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton h-8" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {stageAging.map((stage) => (
                <div key={stage.stageId} className="flex items-center gap-3">
                  <span className="text-xs text-text-secondary w-28 truncate" title={stage.stageLabel}>
                    {stage.stageLabel}
                  </span>
                  <div className="flex-1 h-6 bg-background rounded overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded flex items-center px-2 transition-all duration-500",
                        stage.isOverThreshold ? "bg-negative/60" : "bg-accent/40"
                      )}
                      style={{
                        width: `${Math.min((stage.avgDays / Math.max(...stageAging.map((s) => s.avgDays), 1)) * 100, 100)}%`,
                      }}
                    >
                      <span className="text-[10px] font-mono text-text-primary whitespace-nowrap">
                        {stage.avgDays}j ({stage.dealCount})
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* New upsell deals this week */}
        <div className="card">
          <h3 className="text-sm font-medium text-text-secondary mb-4">
            Upsell cette semaine
          </h3>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="skeleton h-16" />
              ))}
            </div>
          ) : newUpsellDeals.length === 0 ? (
            <p className="text-text-muted text-sm">Aucun upsell cette semaine</p>
          ) : (
            <div className="space-y-2">
              {newUpsellDeals.map((deal) => (
                <div key={deal.id} className="p-3 bg-background rounded-lg border border-positive/20">
                  <div className="text-sm font-medium text-text-primary">{deal.companyName ?? deal.name}</div>
                  <div className="flex justify-between mt-1 text-xs">
                    <span className="font-mono text-positive">{formatCurrency(deal.amount)}</span>
                    <span className="text-text-secondary">{deal.ownerId ? getCsmName(deal.ownerId) : "-"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* New churn deals this week */}
        <div className="card">
          <h3 className="text-sm font-medium text-text-secondary mb-4">
            Churn cette semaine
          </h3>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="skeleton h-16" />
              ))}
            </div>
          ) : newChurnDeals.length === 0 ? (
            <p className="text-text-muted text-sm">Aucun churn cette semaine</p>
          ) : (
            <div className="space-y-2">
              {newChurnDeals.map((deal) => (
                <div key={deal.id} className="p-3 bg-background rounded-lg border border-negative/20">
                  <div className="text-sm font-medium text-text-primary">{deal.companyName ?? deal.name}</div>
                  <div className="flex justify-between mt-1 text-xs">
                    <span className="font-mono text-negative">{formatCurrency(deal.amount)}</span>
                    <span className="text-text-secondary">{deal.ownerId ? getCsmName(deal.ownerId) : "-"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Full pipeline table */}
      <div>
        <h3 className="text-sm font-medium text-text-secondary mb-3">
          Pipeline complete ({data?.totalDeals ?? 0} deals)
        </h3>
        {loading ? <DealsTableSkeleton /> : <DealsTable deals={deals} showAttribution={false} />}
      </div>
    </div>
  )
}

export default function PipelinePage() {
  return (
    <div>
      <Suspense>
        <Header title="Pipeline CSM" subtitle="Funnel de conversion et analyse des stages" />
      </Suspense>
      <Suspense>
        <PipelineContent />
      </Suspense>
    </div>
  )
}
