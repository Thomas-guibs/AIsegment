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

// Step 1: Find Intercom company by name
async function findCompanyByName(companyName: string): Promise<string | null> {
  try {
    const response = await intercomFetch<{
      type: string
      data: Array<{ id: string; name: string; company_id: string }>
      total_count: number
    }>(`/companies?name=${encodeURIComponent(companyName)}`)

    if (response.data && response.data.length > 0) {
      return response.data[0].id
    }
    // If exact match fails, try without case sensitivity
    return null
  } catch {
    return null
  }
}

// Step 2: Get contacts for a company
async function getCompanyContacts(companyId: string): Promise<string[]> {
  try {
    const response = await intercomFetch<{
      type: string
      data: Array<{ id: string; email: string }>
      total_count: number
    }>(`/companies/${companyId}/contacts?per_page=50`)

    return (response.data ?? []).map((c) => c.id)
  } catch {
    return []
  }
}

// Step 3: Search conversations by contact IDs
async function searchConversationsByContacts(contactIds: string[]): Promise<IntercomTicket[]> {
  if (contactIds.length === 0) return []

  try {
    const response = await intercomFetch<{
      type: string
      conversations: Array<{
        id: string
        title: string | null
        state: "open" | "closed" | "snoozed"
        priority: string | null
        created_at: number
        updated_at: number
        source: { subject: string | null; body: string | null }
        statistics?: { time_to_first_close?: number }
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
        pagination: { per_page: 50 },
        sort: { field: "updated_at", order: "desc" },
      },
    })

    return (response.conversations ?? []).map((c) => ({
      id: c.id,
      title: c.source?.subject ?? c.title ?? "Sans titre",
      state: c.state,
      priority: c.priority,
      createdAt: new Date(c.created_at * 1000).toISOString(),
      updatedAt: new Date(c.updated_at * 1000).toISOString(),
      url: `https://app.intercom.com/a/inbox/_/inbox/conversation/${c.id}`,
    }))
  } catch {
    return []
  }
}

// Main function: fetch tickets for a company by name
export async function fetchIntercomTickets(companyName: string): Promise<IntercomTicket[]> {
  if (!companyName || !getToken()) return []

  const cacheKey = `intercom_tickets_${companyName}`
  const cached = getCached<IntercomTicket[]>(cacheKey)
  if (cached) return cached

  try {
    // 1. Find the company in Intercom
    const intercomCompanyId = await findCompanyByName(companyName)
    if (!intercomCompanyId) return []

    // 2. Get contacts of that company
    const contactIds = await getCompanyContacts(intercomCompanyId)
    if (contactIds.length === 0) return []

    // 3. Search conversations for those contacts
    const tickets = await searchConversationsByContacts(contactIds)

    setCache(cacheKey, tickets)
    return tickets
  } catch {
    return []
  }
}

// Count open tickets for a company
export async function countOpenTickets(companyName: string): Promise<number> {
  const tickets = await fetchIntercomTickets(companyName)
  return tickets.filter((t) => t.state === "open").length
}
