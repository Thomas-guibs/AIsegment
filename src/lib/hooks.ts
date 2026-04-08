"use client"

import { useState, useEffect, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import type { PeriodFilter } from "./constants"

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

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const queryParams = new URLSearchParams({
        period,
        ...(csmId ? { csmId } : {}),
        ...params,
      })

      const response = await fetch(`${url}?${queryParams.toString()}`)
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const json = await response.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setLoading(false)
    }
  }, [url, period, csmId, params])

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
