import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  subMonths,
  subWeeks,
  subQuarters,
  format,
  differenceInDays,
} from "date-fns"
import { fr } from "date-fns/locale"
import type { DateRange } from "./types"
import type { PeriodFilter } from "./constants"

// Tailwind class merge helper
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// -----------------------------------------------------------------------------
// Currency / Number formatting
// -----------------------------------------------------------------------------

export function formatCurrency(value: number, compact = false): string {
  if (compact && Math.abs(value) >= 1000) {
    const formatted = new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value)
    return formatted
  }
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("fr-FR").format(value)
}

export function formatDelta(current: number, previous: number): { delta: number; direction: "up" | "down" | "flat" } {
  if (previous === 0) {
    return { delta: current > 0 ? 100 : 0, direction: current > 0 ? "up" : "flat" }
  }
  const delta = ((current - previous) / Math.abs(previous)) * 100
  const direction = delta > 0.5 ? "up" : delta < -0.5 ? "down" : "flat"
  return { delta, direction }
}

// -----------------------------------------------------------------------------
// Date / Period helpers
// Weeks start on Monday (FR convention)
// -----------------------------------------------------------------------------

export function getDateRange(period: PeriodFilter, customFrom?: string, customTo?: string): DateRange {
  const now = new Date()

  switch (period) {
    case "this_week": {
      const from = startOfWeek(now, { weekStartsOn: 1 })
      const to = endOfWeek(now, { weekStartsOn: 1 })
      const previousFrom = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 })
      const previousTo = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 })
      return { from, to, previousFrom, previousTo }
    }
    case "this_month": {
      const from = startOfMonth(now)
      const to = endOfMonth(now)
      const previousFrom = startOfMonth(subMonths(now, 1))
      const previousTo = endOfMonth(subMonths(now, 1))
      return { from, to, previousFrom, previousTo }
    }
    case "this_quarter": {
      const from = startOfQuarter(now)
      const to = endOfQuarter(now)
      const previousFrom = startOfQuarter(subQuarters(now, 1))
      const previousTo = endOfQuarter(subQuarters(now, 1))
      return { from, to, previousFrom, previousTo }
    }
    case "custom": {
      const from = customFrom ? new Date(customFrom) : startOfMonth(now)
      const to = customTo ? new Date(customTo) : endOfMonth(now)
      const durationMs = to.getTime() - from.getTime()
      const previousFrom = new Date(from.getTime() - durationMs)
      const previousTo = new Date(from.getTime() - 1)
      return { from, to, previousFrom, previousTo }
    }
  }
}

export function formatDateFR(date: string | Date): string {
  return format(new Date(date), "dd MMM yyyy", { locale: fr })
}

export function formatDateShort(date: string | Date): string {
  return format(new Date(date), "dd/MM", { locale: fr })
}

export function daysFromNow(date: string | Date): number {
  return differenceInDays(new Date(date), new Date())
}

export function getWeekLabel(date: Date): string {
  return `S${format(date, "ww", { locale: fr })}`
}

export function getMonthLabel(date: Date): string {
  return format(date, "MMM yyyy", { locale: fr })
}

// -----------------------------------------------------------------------------
// Parse helpers for HubSpot string values
// -----------------------------------------------------------------------------

export function parseNumber(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = parseFloat(value)
  return isNaN(parsed) ? 0 : parsed
}

// Normalize a HubSpot date/datetime value to an ISO string.
// HubSpot returns either ISO ("2025-06-01T12:00:00.000Z" or "2025-06-01")
// or epoch millis ("1717239600000") depending on the property and account
// format. String comparisons ("2025-06-01" < "2026-09-01") only work on
// ISO — a millis string collates lexicographically with anything, so we
// normalize both shapes to ISO before returning.
export function parseDate(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null
  const s = String(value).trim()
  if (!s) return null
  // Epoch millis (all digits, 10+ chars)
  if (/^\d{10,}$/.test(s)) {
    const n = Number(s)
    if (!Number.isNaN(n)) {
      const d = new Date(n)
      if (!Number.isNaN(d.getTime())) return d.toISOString()
    }
  }
  // Already ISO or ISO-like — leave as is
  return s
}
