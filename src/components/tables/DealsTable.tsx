"use client"

import { useState } from "react"
import type { Deal } from "@/lib/types"
import { cn, formatCurrency, formatDateFR } from "@/lib/utils"
import {
  ATTRIBUTION_LABELS,
  ATTRIBUTION_COLORS,
  CUSTOMER_STAGE_LABELS,
  getCsmName,
} from "@/lib/constants"

interface DealsTableProps {
  deals: Deal[]
  showStage?: boolean
  showAttribution?: boolean
  emptyMessage?: string
}

type SortKey = "companyName" | "name" | "amount" | "operationDate" | "attribution"
type SortDir = "asc" | "desc"

export function DealsTable({
  deals,
  showStage = true,
  showAttribution = true,
  emptyMessage = "Aucune transaction trouvée",
}: DealsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("operationDate")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const sorted = [...deals].sort((a, b) => {
    let cmp = 0
    switch (sortKey) {
      case "companyName":
        cmp = (a.companyName ?? "").localeCompare(b.companyName ?? "")
        break
      case "name":
        cmp = a.name.localeCompare(b.name)
        break
      case "amount":
        cmp = a.amount - b.amount
        break
      case "operationDate":
        cmp = (a.operationDate ?? "").localeCompare(b.operationDate ?? "")
        break
      case "attribution":
        cmp = (a.attribution ?? "").localeCompare(b.attribution ?? "")
        break
    }
    return sortDir === "asc" ? cmp : -cmp
  })

  if (deals.length === 0) {
    return (
      <div className="card text-center py-12 text-text-muted text-sm">
        {emptyMessage}
      </div>
    )
  }

  const SortHeader = ({ label, sortKeyValue }: { label: string; sortKeyValue: SortKey }) => (
    <th
      className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-secondary transition-colors"
      onClick={() => handleSort(sortKeyValue)}
    >
      <span className="flex items-center gap-1">
        {label}
        {sortKey === sortKeyValue && (
          <span className="text-accent">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>
        )}
      </span>
    </th>
  )

  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-card border-b border-card-border">
            <tr>
              <SortHeader label="Company" sortKeyValue="companyName" />
              <SortHeader label="Deal" sortKeyValue="name" />
              {showAttribution && <SortHeader label="Type" sortKeyValue="attribution" />}
              <SortHeader label="Montant" sortKeyValue="amount" />
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                CSM
              </th>
              <SortHeader label="Date" sortKeyValue="operationDate" />
              {showStage && (
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Stage
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {sorted.map((deal, i) => (
              <tr
                key={deal.id}
                className={cn(
                  "hover:bg-card-hover transition-colors",
                  i % 2 === 1 && "bg-background/30"
                )}
              >
                <td className="px-4 py-3 text-sm text-text-primary font-medium">
                  {deal.companyName ?? "-"}
                </td>
                <td className="px-4 py-3 text-sm text-text-secondary">{deal.name}</td>
                {showAttribution && (
                  <td className="px-4 py-3">
                    {deal.attribution ? (
                      <span
                        className="badge"
                        style={{
                          backgroundColor: `${ATTRIBUTION_COLORS[deal.attribution] ?? "#64748B"}20`,
                          color: ATTRIBUTION_COLORS[deal.attribution] ?? "#64748B",
                        }}
                      >
                        {ATTRIBUTION_LABELS[deal.attribution] ?? deal.attribution}
                      </span>
                    ) : (
                      <span className="text-text-muted text-xs">-</span>
                    )}
                  </td>
                )}
                <td className="px-4 py-3 text-sm font-mono text-text-primary">
                  {formatCurrency(deal.amount)}
                </td>
                <td className="px-4 py-3 text-sm text-text-secondary">
                  {deal.ownerId ? getCsmName(deal.ownerId) : "-"}
                </td>
                <td className="px-4 py-3 text-sm text-text-secondary">
                  {deal.operationDate ? formatDateFR(deal.operationDate) : "-"}
                </td>
                {showStage && (
                  <td className="px-4 py-3 text-xs text-text-muted">
                    {CUSTOMER_STAGE_LABELS[deal.stage] ?? deal.stage}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Skeleton
export function DealsTableSkeleton() {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-card-border">
        <div className="skeleton h-4 w-48" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="px-4 py-3 flex gap-4 border-b border-card-border last:border-0">
          <div className="skeleton h-4 w-24" />
          <div className="skeleton h-4 w-32" />
          <div className="skeleton h-4 w-16" />
          <div className="skeleton h-4 w-20" />
        </div>
      ))}
    </div>
  )
}
