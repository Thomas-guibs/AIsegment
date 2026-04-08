import { CACHE_TTL_MS } from "./constants"

interface CacheEntry<T> {
  data: T
  expiry: number
}

const cache = new Map<string, CacheEntry<unknown>>()

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry || Date.now() > entry.expiry) {
    cache.delete(key)
    return null
  }
  return entry.data as T
}

export function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS })
}

export function invalidateCache(keyPrefix?: string): void {
  if (!keyPrefix) {
    cache.clear()
    return
  }
  cache.forEach((_, key) => {
    if (key.startsWith(keyPrefix)) {
      cache.delete(key)
    }
  })
}
