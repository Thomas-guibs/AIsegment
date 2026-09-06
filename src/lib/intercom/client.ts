import { getCached, setCache } from "../cache"
import type { IntercomTicket } from "../types"

const INTERCOM_BASE_URL = "https://api.intercom.io"

function getToken(): string | null {
  return process.env.INTERCOM_ACCESS_TOKEN ?? null
}

async function intercomFetch<T>(endpoint: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const token = getToken()
  if (!token) throw new Error("INTERCOM_ACCESS_TOKEN not configured")

  const response = await fetch(`${INTERCOM_BASE_URL}${endpoint}`, {
    method: options?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Intercom-Version": "2.11",
    },
    ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error")
    throw new Error(`Intercom API error ${response.status}: ${errorBody}`)
  }

  return response.json()
}

// Search Intercom contacts by email domain, then get their conversations
export async function fetchIntercomTickets(companyName: string, domain?: string | null): Promise<IntercomTicket[]> {
  if (!getToken()) return []
  if (!companyName && !domain) return []

  const cacheKey = `intercom_tickets_v2_${companyName}_${domain ?? ""}`
  const cached = getCached<IntercomTicket[]>(cacheKey)
  if (cached) return cached

  try {
    // Strategy: search contacts by email domain, then get their conversations
    let contactIds: string[] = []

    if (domain) {
      // Search contacts whose email ends with @domain
      const contactResponse = await intercomFetch<{
        type: string
        data: Array<{ id: string; email: string; name: string }>
        total_count: number
      }>("/contacts/search", {
        method: "POST",
        body: {
          query: {
            field: "email",
            operator: "~",
            value: `@${domain}`,
          },
          pagination: { per_page: 50 },
        },
      })
      contactIds = (contactResponse.data ?? []).map((c) => c.id)
    }

    // If no contacts found by domain, try searching by company name in contact data
    if (contactIds.length === 0 && companyName) {
      const contactResponse = await intercomFetch<{
        type: string
        data: Array<{ id: string; email: string; name: string }>
        total_count: number
      }>("/contacts/search", {
        method: "POST",
        body: {
          query: {
            field: "name",
            operator: "~",
            value: companyName,
          },
          pagination: { per_page: 20 },
        },
      })
      contactIds = (contactResponse.data ?? []).map((c) => c.id)
    }

    if (contactIds.length === 0) {
      setCache(cacheKey, [])
      return []
    }

    // Search conversations for these contacts
    const conversationResponse = await intercomFetch<{
      type: string
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
      method: "POST",
      body: {
        query: {
          operator: "OR",
          value: contactIds.slice(0, 25).map((id) => ({
            field: "contact_ids",
            operator: "=",
            value: id,
          })),
        },
        pagination: { per_page: 30 },
        sort: { field: "updated_at", order: "desc" },
      },
    })

    const tickets: IntercomTicket[] = (conversationResponse.conversations ?? []).map((c) => ({
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
  } catch (err) {
    console.error("Intercom fetch error:", err)
    return []
  }
}

// Count open tickets
export async function countOpenTickets(companyName: string, domain?: string | null): Promise<number> {
  const tickets = await fetchIntercomTickets(companyName, domain)
  return tickets.filter((t) => t.state === "open").length
}
