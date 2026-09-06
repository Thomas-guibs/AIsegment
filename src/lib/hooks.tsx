"use client"

import { useState, useEffect, useCallback, createContext, useContext } from "react"
import { useSearchParams } from "next/navigation"
import type { PeriodFilter } from "./constants"

// Refresh context — allows the Header button to trigger re-fetch on all hooks
const RefreshContext = createContext<{ tick: number; refresh: () => void }>({
  tick: 0,
  refresh: () => {},
})

export function RefreshProvider({ children }: { children: React.ReactNode }) {
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])
  return (
    <RefreshContext.Provider value={{ tick, refresh }}>
      {children}
    </RefreshContext.Provider>
  )
}

export function useRefresh() {
  return useContext(RefreshContext)
}

interface UseFetchResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useFetch<T>(url: string, params?: Record<string, string>): UseFetchResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const searchParams = useSearchParams()
  const period = searchParams.get("period") ?? "this_month"
  const csmId = searchParams.get("csmId") ?? ""
  const { tick } = useRefresh()

  // Stabilize params to avoid infinite re-render loops
  const paramsString = params ? JSON.stringify(params) : ""

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const extraParams = paramsString ? JSON.parse(paramsString) : {}
    const queryParams = new URLSearchParams({
      period,
      ...(csmId ? { csmId } : {}),
      ...extraParams,
    })
    const fullUrl = `${url}?${queryParams.toString()}`

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(fullUrl)
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`)
        }
        const json = await response.json()
        setData(json)
        setLoading(false)
        return
      } catch (err) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 3000))
        } else {
          setError(err instanceof Error ? err.message : "An error occurred")
          setLoading(false)
        }
      }
    }
  }, [url, period, csmId, paramsString, tick])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, loading, error, refetch: fetchData }
}

export function useGlobalFilters() {
  const searchParams = useSearchParams()

  return {
    period: (searchParams.get("period") ?? "this_month") as PeriodFilter,
    csmId: searchParams.get("csmId") ?? null,
  }
}
