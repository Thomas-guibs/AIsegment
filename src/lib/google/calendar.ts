import { getCached, setCache } from "../cache"
import type { CalendarMeeting } from "../types"

// Google Calendar integration for CSM meetings
// Uses Google Calendar API v3 with OAuth2 or service account

const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3"

function getCredentials(): string | null {
  return process.env.GOOGLE_CALENDAR_TOKEN ?? null
}

async function calendarFetch<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  const token = getCredentials()
  if (!token) throw new Error("GOOGLE_CALENDAR_TOKEN not configured")

  const url = new URL(`${GOOGLE_CALENDAR_BASE}${endpoint}`)
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error")
    throw new Error(`Google Calendar API error ${response.status}: ${errorBody}`)
  }

  return response.json()
}

// Search for meetings related to a company (by name or domain in event title/attendees)
export async function fetchMeetingsForCompany(
  companyName: string,
  domain: string | null,
  calendarIds: string[],
  daysBack: number = 90,
  daysForward: number = 30
): Promise<CalendarMeeting[]> {
  if (!getCredentials()) return []

  const cacheKey = `calendar_meetings_${companyName}_${domain}`
  const cached = getCached<CalendarMeeting[]>(cacheKey)
  if (cached) return cached

  const now = new Date()
  const timeMin = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString()
  const timeMax = new Date(now.getTime() + daysForward * 24 * 60 * 60 * 1000).toISOString()

  const allMeetings: CalendarMeeting[] = []

  for (const calendarId of calendarIds) {
    try {
      const response = await calendarFetch<{
        items: Array<{
          id: string
          summary: string
          start: { dateTime?: string; date?: string }
          end: { dateTime?: string; date?: string }
          status: "confirmed" | "cancelled" | "tentative"
          attendees?: Array<{ email: string; responseStatus: string }>
          htmlLink: string
        }>
      }>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
        q: companyName, // Free-text search in event title and description
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "20",
      })

      for (const event of response.items ?? []) {
        // Additional filter: check if company name or domain appears in attendees
        const matchesAttendees =
          domain &&
          event.attendees?.some((a) => a.email.endsWith(`@${domain}`))
        const matchesTitle =
          event.summary?.toLowerCase().includes(companyName.toLowerCase())

        if (matchesTitle || matchesAttendees) {
          allMeetings.push({
            id: event.id,
            summary: event.summary,
            start: event.start.dateTime ?? event.start.date ?? "",
            end: event.end.dateTime ?? event.end.date ?? "",
            status: event.status,
            attendees: (event.attendees ?? []).map((a) => a.email),
            link: event.htmlLink,
          })
        }
      }
    } catch {
      // Calendar not accessible — skip
    }
  }

  // Sort by start date DESC (most recent first)
  allMeetings.sort((a, b) => b.start.localeCompare(a.start))

  setCache(cacheKey, allMeetings)
  return allMeetings
}
