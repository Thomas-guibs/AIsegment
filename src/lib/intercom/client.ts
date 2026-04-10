import { getCached, setCache } from "../cache"
import type { IntercomTicket } from "../types"

const INTERCOM_BASE_URL = "https://api.intercom.io"

function getToken(): string | null {
  return process.env.INTERCOM_ACCESS_TOKEN ?? null
}

async function intercomFetch<T>(endpoint: string, body?: unknown): Promise<T> {
  const token = getToken()
  if (!token) throw new Error("INTERCOM_ACCESS_TOKEN not configured")

  const response = await fetch(`${INTERCOM_BASE_URL}${endpoint}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Intercom-Version": "2.11",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error")
    throw new Error(`Intercom API error ${response.status}: ${errorBody}`)
  }

  return response.json()
}

// Search for a company in Intercom by domain
export async function findIntercomCompany(domain: string): Promise<{ id: string; name: string } | null> {
  if (!domain || !getToken()) return null

  const cacheKey = `intercom_company_${domain}`
  const cached = getCached<{ id: string; name: string } | null>(cacheKey)
  if (cached !== null) return cached

  try {
    const response = await intercomFetch<{
      data: Array<{ id: string; name: string; company_id: string; website: string }>
      total_count: number
    }>("/companies", undefined)

    // Search through results for matching domain
    // Intercom list endpoint — we'll scroll through to find the match
    // For better perf, use scroll API or search by company_id if synced
    const companies = response.data ?? []
    const match = companies.find(
      (c) =>
        c.website?.includes(domain) ||
        c.name?.toLowerCase().includes(domain.split(".")[0].toLowerCase())
    )

    const result = match ? { id: match.id, name: match.name } : null
    setCache(cacheKey, result)
    return result
  } catch {
    return null
  }
}

// Fetch open conversations for a company by searching contacts
export async function fetchIntercomTickets(domain: string): Promise<IntercomTicket[]> {
  if (!domain || !getToken()) return []

  const cacheKey = `intercom_tickets_${domain}`
  const cached = getCached<IntercomTicket[]>(cacheKey)
  if (cached) return cached

  try {
    // Search conversations that mention the domain or company name
    const response = await intercomFetch<{
      conversations: Array<{
        id: string
        title: string | null
        state: "open" | "closed" | "snoozed"
        priority: string | null
        created_at: number
        updated_at: number
        source: { subject: string | null; body: string | null }
      }>
      total_count: number
    }>("/conversations/search", {
      query: {
        operator: "AND",
        value: [
          { field: "source.body", operator: "~", value: domain.split(".")[0] },
        ],
      },
      pagination: { per_page: 20 },
    })

    const tickets: IntercomTicket[] = (response.conversations ?? []).map((c) => ({
      id: c.id,
      title: c.source?.subject ?? c.title ?? "Sans titre",
      state: c.state,
      priority: c.priority,
      createdAt: new Date(c.created_at * 1000).toISOString(),
      updatedAt: new Date(c.updated_at * 1000).toISOString(),
      url: `https://app.intercom.com/a/inbox/_/inbox/conversation/${c.id}`,
    }))

    setCache(cacheKey, tickets)
    return tickets
  } catch {
    // Intercom not configured or API error — return empty
    return []
  }
}

// Count open tickets for a domain
export async function countOpenTickets(domain: string): Promise<number> {
  const tickets = await fetchIntercomTickets(domain)
  return tickets.filter((t) => t.state === "open").length
}
