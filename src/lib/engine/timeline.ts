// =============================================================================
// Point-in-time reading (spec §2)
//
// A client can change CSM mid-flight. The whole calculation hinges on never
// reading a property's *current* value, only its value **at the observed date**:
//
//     value_at(T) = value of the last version whose timestamp <= T
//
// Two traps this module exists to handle:
//   1. HubSpot returns history newest-first. Re-sorting ascending is mandatory,
//      otherwise value_at() always answers with the latest value.
//   2. History can be truncated. When it does not reach back to the observed
//      month, value_at() finds nothing and the account silently drops out of
//      the portfolio — with no business rule having excluded it. We surface it.
// =============================================================================

export interface TimelineEntry<T> {
  /** ISO-8601 timestamp of the version. */
  timestamp: string
  value: T
}

export interface Timeline<T> {
  /** Versions sorted **ascending** — oldest first. Never trust the source order. */
  entries: TimelineEntry<T>[]
  /** Oldest timestamp known, `null` when the timeline is empty. */
  earliest: string | null
  /** When true, `valueAt` carries the oldest known value back to the origin of time. */
  backfilled: boolean
}

export const EMPTY_TIMELINE: Timeline<never> = { entries: [], earliest: null, backfilled: false }

/**
 * Build a timeline from raw HubSpot history versions.
 * `parse` maps the raw string to the domain value; returning `undefined` drops
 * the version (an unparseable number, an empty enum...).
 */
export function buildTimeline<T>(
  versions: Array<{ value: string | null; timestamp: string }> | undefined,
  parse: (raw: string) => T | undefined,
  options: { backfill?: boolean } = {}
): Timeline<T> {
  const entries: TimelineEntry<T>[] = []

  for (const version of versions ?? []) {
    if (version?.timestamp == null) continue
    const parsed = version.value == null ? undefined : parse(version.value)
    if (parsed === undefined) continue
    entries.push({ timestamp: version.timestamp, value: parsed })
  }

  // HubSpot hands history back newest-first. Sort ascending before anything else.
  entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  return {
    entries,
    earliest: entries.length > 0 ? entries[0].timestamp : null,
    backfilled: options.backfill ?? false,
  }
}

/** A timeline holding a single value known since the beginning of time. */
export function constantTimeline<T>(value: T | undefined, timestamp = "1970-01-01T00:00:00Z"): Timeline<T> {
  if (value === undefined) return EMPTY_TIMELINE as unknown as Timeline<T>
  return { entries: [{ timestamp, value }], earliest: timestamp, backfilled: true }
}

/**
 * The value in force at `at` — the last version whose timestamp is <= `at`.
 *
 * Returns `undefined` when the timeline starts *after* `at`: the value is not
 * unknown-because-absent, it is unknown-because-untracked. Callers must
 * distinguish the two — see `isTruncatedAt`.
 *
 * With `backfilled`, the oldest known value is carried back instead.
 */
export function valueAt<T>(timeline: Timeline<T>, at: Date | string): T | undefined {
  const cutoff = typeof at === "string" ? at : at.toISOString()
  const { entries } = timeline
  if (entries.length === 0) return undefined

  // Binary search for the last entry with timestamp <= cutoff.
  let lo = 0
  let hi = entries.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (entries[mid].timestamp <= cutoff) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  if (found >= 0) return entries[found].value
  return timeline.backfilled ? entries[0].value : undefined
}

/**
 * True when the timeline holds versions but none of them reaches back to `at`
 * — i.e. the account exists, yet its history does not cover the observed month.
 * That is a data limit, not a business decision, and must be reported (spec §9).
 */
export function isTruncatedAt<T>(timeline: Timeline<T>, at: Date | string): boolean {
  if (timeline.entries.length === 0) return false
  if (timeline.backfilled) return false
  const cutoff = typeof at === "string" ? at : at.toISOString()
  return timeline.entries[0].timestamp > cutoff
}

/** The first value ever recorded — the fallback when no owner is known at a date. */
export function firstValue<T>(timeline: Timeline<T>): T | undefined {
  return timeline.entries[0]?.value
}

/** The latest value recorded, whatever the date. */
export function latestValue<T>(timeline: Timeline<T>): T | undefined {
  return timeline.entries[timeline.entries.length - 1]?.value
}
