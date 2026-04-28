// Brave Search API integration for company website discovery
// Used as a last-resort fallback when Pappers has no site_web/nom_commercial
// and domain inference from the company name doesn't resolve.
//
// Free tier: 2000 queries/month, 1 req/sec.
// Get a key at https://api.search.brave.com/

import { getCached, setCache } from "../cache"

const BRAVE_API = "https://api.search.brave.com/res/v1/web/search"

// Directory and aggregator sites — never the company's own website
const DIRECTORY_DOMAINS = [
  "pappers.fr",
  "societe.com",
  "verif.com",
  "infogreffe.fr",
  "annuaire-entreprises.data.gouv.fr",
  "data.gouv.fr",
  "bodacc.fr",
  "manageo.fr",
  "score3.fr",
  "bilans-entreprises.fr",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "indeed.com",
  "glassdoor.fr",
  "glassdoor.com",
  "youtube.com",
  "wikipedia.org",
  "lefigaro.fr",
  "lemonde.fr",
  "lesechos.fr",
  "challenges.fr",
  "usine-digitale.fr",
  "usinenouvelle.com",
  "google.com",
  "google.fr",
  "yelp.com",
  "yelp.fr",
  "trustpilot.com",
  "amazon.fr",
  "amazon.com",
]

interface BraveResult {
  url: string
  title: string
  description: string
}

async function braveSearch(query: string, count = 10): Promise<BraveResult[]> {
  const key = process.env.BRAVE_API_KEY
  if (!key) {
    console.warn("[brave] BRAVE_API_KEY not configured")
    return []
  }

  const url = new URL(BRAVE_API)
  url.searchParams.set("q", query)
  url.searchParams.set("count", String(count))
  url.searchParams.set("country", "FR")
  url.searchParams.set("search_lang", "fr")

  try {
    const response = await fetch(url.toString(), {
      headers: {
        "X-Subscription-Token": key,
        Accept: "application/json",
      },
    })
    if (!response.ok) {
      const body = await response.text().catch(() => "")
      console.warn(`[brave] ${response.status} ${response.statusText} body=${body.slice(0, 200)}`)
      return []
    }
    const data = await response.json()
    const results = data.web?.results ?? []
    return results.map((r: any) => ({
      url: r.url ?? "",
      title: r.title ?? "",
      description: r.description ?? "",
    }))
  } catch (err) {
    console.warn(`[brave] error: ${String(err).slice(0, 200)}`)
    return []
  }
}

function isDirectorySite(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase()
    return DIRECTORY_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))
  } catch {
    return false
  }
}

function extractHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return null
  }
}

export interface BraveDomainResult {
  domain: string | null
  url: string | null          // Full URL of the matching result (for debugging)
  source: "brave" | null
}

// Find a company's website via Brave Search.
// Query strategy: `"NAME" SIREN` — the SIREN forces the search to land on the
// company's legal mentions / about page, which is on their actual website.
// Returns the first non-directory hostname found.
export async function findDomainViaBrave(
  companyName: string,
  siren: string,
): Promise<BraveDomainResult> {
  if (!companyName || !siren || siren.length !== 9) {
    return { domain: null, url: null, source: null }
  }

  // Cache by SIREN — websites change rarely (TTL handled by cache module)
  const cacheKey = `brave_domain_${siren}`
  const cached = getCached<BraveDomainResult>(cacheKey)
  if (cached) {
    console.log(`[brave:${siren}] cache hit → ${cached.domain ?? "null"}`)
    return cached
  }

  // Build query: prefer SIREN-based query (highest precision)
  const query = `"${companyName}" ${siren}`
  console.log(`[brave:${siren}] search "${query}"`)

  const results = await braveSearch(query, 10)
  console.log(`[brave:${siren}] ${results.length} results`)

  // Find first non-directory hit
  const seenHosts = new Set<string>()
  for (const r of results) {
    if (isDirectorySite(r.url)) continue
    const host = extractHost(r.url)
    if (!host || seenHosts.has(host)) continue
    seenHosts.add(host)

    const result: BraveDomainResult = {
      domain: host,
      url: r.url,
      source: "brave",
    }
    console.log(`[brave:${siren}] → ${host} (${r.url})`)
    setCache(cacheKey, result)
    return result
  }

  // No non-directory hits — cache the negative
  const negative: BraveDomainResult = { domain: null, url: null, source: null }
  console.log(`[brave:${siren}] no non-directory hits`)
  setCache(cacheKey, negative)
  return negative
}
