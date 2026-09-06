"use client"

import { useState, useMemo } from "react"
import { format, addDays, addMonths, startOfDay, startOfMonth, endOfMonth, isSameDay, isSameMonth, getDaysInMonth, eachDayOfInterval, eachMonthOfInterval, startOfQuarter, endOfQuarter, addQuarters, eachWeekOfInterval } from "date-fns"
import { fr } from "date-fns/locale"
import { cn } from "@/lib/utils"
import type { RenewalDeal } from "@/lib/types"

interface HeatmapCalendarProps {
  deals: RenewalDeal[]
  onDayClick?: (date: Date, deals: RenewalDeal[]) => void
}

type ViewMode = "month" | "quarter" | "year"

// Status color based on deal stage
// Green = Closed Won or Go Verbal (deal secured)
// Red = Churn & Downsell
// Orange = everything else (open / in progress)
const WON_STAGES = ["closedlost", "143474109", "878353129"] // Closed Won, Paiement reçu, Go verbal
const CHURN_STAGES = ["1220133077", "124302781"] // Churn & Downsell, Closed Lost

function getDealStatus(deal: RenewalDeal): "won" | "churn" | "open" {
  if (WON_STAGES.includes(deal.stage)) return "won"
  if (CHURN_STAGES.includes(deal.stage)) return "churn"
  return "open"
}

// Dominant color for a group of deals on a given day
function getDayCellColor(dayDeals: RenewalDeal[]): string {
  if (dayDeals.length === 0) return "bg-card"
  const statuses = dayDeals.map(getDealStatus)
  if (statuses.some((s) => s === "churn")) return "bg-negative/70"
  if (statuses.every((s) => s === "won")) return "bg-positive/70"
  if (statuses.some((s) => s === "won")) return "bg-positive/40"
  return "bg-warning/60" // open deals
}

function getDayCellBorder(dayDeals: RenewalDeal[]): string {
  if (dayDeals.length === 0) return ""
  const statuses = dayDeals.map(getDealStatus)
  if (statuses.some((s) => s === "churn")) return "ring-1 ring-negative/50"
  if (statuses.every((s) => s === "won")) return "ring-1 ring-positive/50"
  return ""
}

export function HeatmapCalendar({ deals, onDayClick }: HeatmapCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>("quarter")
  const today = startOfDay(new Date())

  // Build map of date → deals
  const dealsByDate = useMemo(() => {
    const map = new Map<string, RenewalDeal[]>()
    for (const deal of deals) {
      if (!deal.renewalDate) continue
      const key = format(new Date(deal.renewalDate), "yyyy-MM-dd")
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(deal)
    }
    return map
  }, [deals])

  // Calculate days based on view mode
  const days = viewMode === "month" ? 31 : viewMode === "quarter" ? 90 : 365

  // Generate calendar days
  const calendarDays = useMemo(() => {
    const result: Date[] = []
    for (let i = 0; i < days; i++) {
      result.push(addDays(today, i))
    }
    return result
  }, [days, today])

  // Group by weeks
  const weeks = useMemo(() => {
    const result: Date[][] = []
    let currentWeek: Date[] = []
    for (const day of calendarDays) {
      if (currentWeek.length === 7) {
        result.push(currentWeek)
        currentWeek = []
      }
      currentWeek.push(day)
    }
    if (currentWeek.length > 0) result.push(currentWeek)
    return result
  }, [calendarDays])

  const handleClick = (date: Date) => {
    setSelectedDate(date)
    const key = format(date, "yyyy-MM-dd")
    const dayDeals = dealsByDate.get(key) ?? []
    onDayClick?.(date, dayDeals)
  }

  // For year view, use a more compact display
  const isCompact = viewMode === "year"

  return (
    <div>
      {/* View mode toggle */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1 bg-background rounded-lg p-0.5 border border-card-border">
          {(["month", "quarter", "year"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={cn(
                "px-3 py-1 text-xs rounded-md transition-colors font-medium",
                viewMode === mode ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"
              )}
            >
              {mode === "month" ? "1 mois" : mode === "quarter" ? "3 mois" : "1 an"}
            </button>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-[10px] text-text-muted">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-positive/70" /> Won / Go verbal</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-warning/60" /> En cours</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-negative/70" /> Churn</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-card border border-card-border" /> Aucun</span>
        </div>
      </div>

      {/* Month labels */}
      <div className="flex gap-1 mb-2 text-xs text-text-muted">
        {weeks.map((week, i) => {
          const firstDay = week[0]
          const showLabel = i === 0 || firstDay.getDate() <= 7
          return (
            <div key={i} className="flex-1 text-center">
              {showLabel ? format(firstDay, "MMM", { locale: fr }) : ""}
            </div>
          )
        })}
      </div>

      {/* Day names */}
      {!isCompact && (
        <div className="flex gap-1 mb-1">
          {["L", "M", "M", "J", "V", "S", "D"].map((day, i) => (
            <div key={i} className="flex-1 text-center text-[10px] text-text-muted">
              {day}
            </div>
          ))}
        </div>
      )}

      {/* Calendar grid */}
      <div className={cn("space-y-1", isCompact && "space-y-0.5")}>
        {weeks.map((week, wi) => (
          <div key={wi} className="flex gap-1" style={isCompact ? { gap: "2px" } : undefined}>
            {week.map((day) => {
              const key = format(day, "yyyy-MM-dd")
              const dayDeals = dealsByDate.get(key) ?? []
              const count = dayDeals.length
              const isSelected = selectedDate && isSameDay(day, selectedDate)
              const isToday = isSameDay(day, today)

              return (
                <button
                  key={key}
                  onClick={() => handleClick(day)}
                  className={cn(
                    "flex-1 rounded-sm flex items-center justify-center font-mono transition-all duration-150",
                    isCompact ? "aspect-square text-[7px]" : "aspect-square text-[10px]",
                    getDayCellColor(dayDeals),
                    getDayCellBorder(dayDeals),
                    count > 0 ? "text-white cursor-pointer hover:brightness-110" : "text-text-muted",
                    isSelected && "ring-2 ring-accent",
                    isToday && !isSelected && "ring-1 ring-text-muted"
                  )}
                  title={`${format(day, "dd/MM/yyyy")} — ${count} renouvellement${count > 1 ? "s" : ""}${
                    count > 0 ? ` (${dayDeals.map(getDealStatus).join(", ")})` : ""
                  }`}
                >
                  {count > 0 ? count : ""}
                </button>
              )
            })}
            {week.length < 7 &&
              Array.from({ length: 7 - week.length }).map((_, i) => (
                <div key={`pad-${i}`} className="flex-1" />
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}
