"use client"

import { cn, formatCurrency, formatPercent, formatNumber } from "@/lib/utils"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import type { KpiValue } from "@/lib/types"

interface KpiCardProps {
  kpi: KpiValue
  icon?: React.ReactNode
  warning?: boolean
  danger?: boolean
  children?: React.ReactNode
}

export function KpiCard({ kpi, icon, warning, danger, children }: KpiCardProps) {
  const formattedValue =
    kpi.format === "currency"
      ? formatCurrency(kpi.value, true)
      : kpi.format === "percent"
        ? `${kpi.value.toFixed(1)}%`
        : formatNumber(kpi.value)

  const deltaIcon =
    kpi.deltaDirection === "up" ? (
      <TrendingUp className="w-3 h-3" />
    ) : kpi.deltaDirection === "down" ? (
      <TrendingDown className="w-3 h-3" />
    ) : (
      <Minus className="w-3 h-3" />
    )

  const deltaColor =
    kpi.deltaDirection === "up"
      ? "text-positive"
      : kpi.deltaDirection === "down"
        ? "text-negative"
        : "text-text-muted"

  return (
    <div
      className={cn(
        "card animate-fade-in",
        warning && "border-warning/40",
        danger && "border-negative/40"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xs font-medium text-text-muted uppercase tracking-wider">
          {kpi.label}
        </span>
        {icon && <span className="text-text-muted">{icon}</span>}
      </div>

      <div className="flex items-end gap-2">
        <span
          className={cn(
            "text-xl font-semibold font-mono text-text-primary",
            warning && "text-warning",
            danger && "text-negative"
          )}
        >
          {formattedValue}
        </span>

        {kpi.delta !== 0 && (
          <span className={cn("flex items-center gap-0.5 text-2xs font-medium pb-0.5", deltaColor)}>
            {deltaIcon}
            {formatPercent(kpi.delta)}
          </span>
        )}
      </div>

      {children && <div className="mt-2">{children}</div>}
    </div>
  )
}

export function KpiCardSkeleton() {
  return (
    <div className="card">
      <div className="skeleton h-3 w-20 mb-3" />
      <div className="skeleton h-6 w-28" />
    </div>
  )
}
