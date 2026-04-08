"use client"

import { formatCurrency, formatNumber, cn } from "@/lib/utils"
import type { PipelineFunnelStep } from "@/lib/types"

interface FunnelChartProps {
  steps: PipelineFunnelStep[]
}

export function FunnelChart({ steps }: FunnelChartProps) {
  const maxCount = Math.max(...steps.map((s) => s.dealCount), 1)

  return (
    <div className="space-y-3">
      {steps.map((step, i) => (
        <div key={step.category} className="animate-fade-in" style={{ animationDelay: `${i * 50}ms` }}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-sm"
                style={{ backgroundColor: step.color }}
              />
              <span className="text-sm font-medium text-text-primary">{step.label}</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-text-secondary">
              <span className="font-mono">{formatNumber(step.dealCount)} deals</span>
              <span className="font-mono">{formatCurrency(step.totalMrr, true)} MRR</span>
              {step.conversionRate !== null && (
                <span className="text-text-muted">
                  {step.conversionRate.toFixed(0)}% conv.
                </span>
              )}
            </div>
          </div>
          <div className="h-8 bg-card rounded-md overflow-hidden">
            <div
              className="h-full rounded-md transition-all duration-500 ease-out flex items-center px-3"
              style={{
                width: `${Math.max((step.dealCount / maxCount) * 100, 5)}%`,
                backgroundColor: step.color,
                opacity: 0.8,
              }}
            >
              <span className="text-xs font-mono text-white font-medium">
                {step.dealCount}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
