"use client"

import { useState } from "react"
import { format, addDays, startOfDay, isSameDay } from "date-fns"
import { fr } from "date-fns/locale"
import { cn } from "@/lib/utils"
import type { RenewalDeal } from "@/lib/types"

interface HeatmapCalendarProps {
  deals: RenewalDeal[]
  days?: number
  onDayClick?: (date: Date, deals: RenewalDeal[]) => void
}

function getHeatColor(count: number): string {
  if (count === 0) return "bg-card"
  if (count <= 2) return "bg-accent/30"
  if (count <= 5) return "bg-accent/60"
  return "bg-accent"
}

export function HeatmapCalendar({ deals, days = 90, onDayClick }: HeatmapCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const today = startOfDay(new Date())

  // Build map of date → deals
  const dealsByDate = new Map<string, RenewalDeal[]>()
  for (const deal of deals) {
    if (!deal.renewalDate) continue
    const key = format(new Date(deal.renewalDate), "yyyy-MM-dd")
    if (!dealsByDate.has(key)) dealsByDate.set(key, [])
    dealsByDate.get(key)!.push(deal)
  }

  // Generate calendar days
  const calendarDays: Date[] = []
  for (let i = 0; i < days; i++) {
    calendarDays.push(addDays(today, i))
  }

  // Group by weeks
  const weeks: Date[][] = []
  let currentWeek: Date[] = []
  for (const day of calendarDays) {
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
    currentWeek.push(day)
  }
  if (currentWeek.length > 0) weeks.push(currentWeek)

  function handleClick(date: Date) {
    setSelectedDate(date)
    const key = format(date, "yyyy-MM-dd")
    const dayDeals = dealsByDate.get(key) ?? []
    onDayClick?.(date, dayDeals)
  }

  return (
    <div>
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
      <div className="flex gap-1 mb-1">
        {["L", "M", "M", "J", "V", "S", "D"].map((day, i) => (
          <div key={i} className="flex-1 text-center text-[10px] text-text-muted">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="space-y-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex gap-1">
            {week.map((day) => {
              const key = format(day, "yyyy-MM-dd")
              const count = dealsByDate.get(key)?.length ?? 0
              const isSelected = selectedDate && isSameDay(day, selectedDate)
              const isToday = isSameDay(day, today)

              return (
                <button
                  key={key}
                  onClick={() => handleClick(day)}
                  className={cn(
                    "flex-1 aspect-square rounded-sm flex items-center justify-center text-[10px] font-mono transition-all duration-150",
                    getHeatColor(count),
                    count > 0 ? "text-text-primary cursor-pointer hover:ring-1 hover:ring-accent" : "text-text-muted",
                    isSelected && "ring-2 ring-accent",
                    isToday && "ring-1 ring-text-muted"
                  )}
                  title={`${format(day, "dd/MM/yyyy")} — ${count} renouvellement${count > 1 ? "s" : ""}`}
                >
                  {count > 0 ? count : ""}
                </button>
              )
            })}
            {/* Pad remaining days */}
            {week.length < 7 &&
              Array.from({ length: 7 - week.length }).map((_, i) => (
                <div key={`pad-${i}`} className="flex-1" />
              ))}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-3 text-[10px] text-text-muted">
        <span>Moins</span>
        <div className="w-3 h-3 rounded-sm bg-card border border-card-border" />
        <div className="w-3 h-3 rounded-sm bg-accent/30" />
        <div className="w-3 h-3 rounded-sm bg-accent/60" />
        <div className="w-3 h-3 rounded-sm bg-accent" />
        <span>Plus</span>
      </div>
    </div>
  )
}
