"use client"

import { useState } from "react"
import type { CsmPortfolio } from "@/lib/types"
import { cn, formatCurrency, formatNumber } from "@/lib/utils"
import { STAGE_CATEGORY_COLORS, type StageCategory } from "@/lib/constants"
import { MiniDonut } from "@/components/charts/DonutChart"

interface PortfolioTableProps {
  portfolios: CsmPortfolio[]
  onCsmClick?: (csmId: string) => void
}

export function PortfolioTable({ portfolios, onCsmClick }: PortfolioTableProps) {
  const [sortKey, setSortKey] = useState<"totalMrr" | "accountCount" | "healthPercent">("totalMrr")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  function handleSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const sorted = [...portfolios].sort((a, b) => {
    const cmp = a[sortKey] - b[sortKey]
    return sortDir === "asc" ? cmp : -cmp
  })

  // Totals
  const totals = portfolios.reduce(
    (acc, p) => ({
      accounts: acc.accounts + p.accountCount,
      mrr: acc.mrr + p.totalMrr,
      upsell: acc.upsell + p.upsellThisMonth,
      churn: acc.churn + p.churnThisMonth,
      renewals: acc.renewals + p.renewals30d,
    }),
    { accounts: 0, mrr: 0, upsell: 0, churn: 0, renewals: 0 }
  )

  function getHealthColor(percent: number): string {
    if (percent >= 80) return "text-positive"
    if (percent >= 60) return "text-warning"
    return "text-negative"
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-card border-b border-card-border">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                CSM
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-secondary"
                onClick={() => handleSort("accountCount")}
              >
                Comptes {sortKey === "accountCount" && (sortDir === "asc" ? "\u2191" : "\u2193")}
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-secondary"
                onClick={() => handleSort("totalMrr")}
              >
                MRR {sortKey === "totalMrr" && (sortDir === "asc" ? "\u2191" : "\u2193")}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                NRR
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                Upsell
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                Churn
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                Renewals 30j
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-secondary"
                onClick={() => handleSort("healthPercent")}
              >
                Health {sortKey === "healthPercent" && (sortDir === "asc" ? "\u2191" : "\u2193")}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                Stages
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {sorted.map((p, i) => {
              const donutData = Object.entries(p.stageBreakdown)
                .filter(([, v]) => v > 0)
                .map(([cat, v]) => ({
                  name: cat,
                  value: v,
                  color: STAGE_CATEGORY_COLORS[cat as StageCategory],
                }))

              return (
                <tr
                  key={p.csmId}
                  className={cn(
                    "hover:bg-card-hover transition-colors cursor-pointer",
                    i % 2 === 1 && "bg-background/30"
                  )}
                  onClick={() => onCsmClick?.(p.csmId)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium text-white"
                        style={{ backgroundColor: p.color }}
                      >
                        {p.initials}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-text-primary">{p.csmName}</div>
                        <div className="text-[10px] text-text-muted">{p.csmRole}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-text-primary">
                    {p.accountCount}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-text-primary">
                    {formatCurrency(p.totalMrr, true)}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 font-mono text-sm",
                      !p.nrrAvailable
                        ? "text-text-muted"
                        : p.nrr >= 100
                          ? "text-positive"
                          : "text-negative"
                    )}
                    title={
                      p.nrrAvailable
                        ? undefined
                        : "Portefeuille vide ce mois — le NRR n'est pas calculable, ce n'est pas 0 %."
                    }
                  >
                    {p.nrrAvailable ? `${p.nrr.toFixed(1)} %` : "n/a"}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-positive">
                    {formatCurrency(p.upsellThisMonth, true)}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-negative">
                    {formatCurrency(p.churnThisMonth, true)}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-text-primary">
                    {p.renewals30d}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("font-mono text-sm font-medium", getHealthColor(p.healthPercent))}>
                      {p.healthPercent.toFixed(0)}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <MiniDonut data={donutData} />
                  </td>
                </tr>
              )
            })}

            {/* Totals row */}
            <tr className="bg-card-hover font-medium">
              <td className="px-4 py-3 text-sm text-text-primary">Total</td>
              <td className="px-4 py-3 font-mono text-sm text-text-primary">{totals.accounts}</td>
              <td className="px-4 py-3 font-mono text-sm text-text-primary">
                {formatCurrency(totals.mrr, true)}
              </td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3 font-mono text-sm text-positive">
                {formatCurrency(totals.upsell, true)}
              </td>
              <td className="px-4 py-3 font-mono text-sm text-negative">
                {formatCurrency(totals.churn, true)}
              </td>
              <td className="px-4 py-3 font-mono text-sm text-text-primary">{totals.renewals}</td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
