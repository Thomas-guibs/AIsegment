"use client"

import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { CSM_TEAM, PERIOD_LABELS, type PeriodFilter } from "@/lib/constants"

export function FilterBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const currentPeriod = (searchParams.get("period") ?? "this_month") as PeriodFilter
  const currentCsm = searchParams.get("csmId") ?? ""

  function updateParams(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex items-center gap-3">
      {/* Period filter */}
      <select
        value={currentPeriod}
        onChange={(e) => updateParams("period", e.target.value)}
        className="h-8 px-3 rounded-lg bg-card border border-card-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
      >
        {(Object.entries(PERIOD_LABELS) as [PeriodFilter, string][]).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      {/* CSM filter */}
      <select
        value={currentCsm}
        onChange={(e) => updateParams("csmId", e.target.value)}
        className="h-8 px-3 rounded-lg bg-card border border-card-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
      >
        <option value="">Tous les CSM</option>
        {CSM_TEAM.map((csm) => (
          <option key={csm.id} value={csm.id}>
            {csm.name}
          </option>
        ))}
      </select>
    </div>
  )
}
