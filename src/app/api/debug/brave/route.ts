export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"

const BRAVE_API = "https://api.search.brave.com/res/v1/web/search"

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name")
  const siren = request.nextUrl.searchParams.get("siren")
  if (!name || !siren) {
    return NextResponse.json({ error: "?name=&siren= required" }, { status: 400 })
  }

  const key = process.env.BRAVE_API_KEY
  if (!key) return NextResponse.json({ error: "BRAVE_API_KEY not set" }, { status: 500 })

  const query = `"${name}" ${siren}`
  const url = new URL(BRAVE_API)
  url.searchParams.set("q", query)
  url.searchParams.set("count", "10")
  url.searchParams.set("country", "FR")
  url.searchParams.set("search_lang", "fr")

  const res = await fetch(url.toString(), {
    headers: { "X-Subscription-Token": key, Accept: "application/json" },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    return NextResponse.json({ error: res.status, body: body.slice(0, 500) }, { status: res.status })
  }

  const data = await res.json()
  const results = (data.web?.results ?? []).map((r: any) => ({
    url: r.url,
    title: r.title,
    description: r.description?.slice(0, 200),
  }))

  return NextResponse.json({ query, count: results.length, results })
}
