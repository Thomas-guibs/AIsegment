import * as cheerio from "cheerio"

const FETCH_TIMEOUT_MS = 4_000
const USER_AGENT = "Mozilla/5.0 (compatible; LoyolyCSMBot/1.0; +https://loyoly.io)"

// Fetch a web page with timeout and user-agent
export async function fetchPage(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "fr,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    })

    clearTimeout(timeout)

    if (!response.ok) return null
    // Only read first 200KB to keep things fast
    const text = await response.text()
    return text.slice(0, 200_000)
  } catch {
    return null
  }
}

// Normalize domain to https URL
function normalizeDomain(domain: string): string {
  let d = domain.trim().toLowerCase()
  d = d.replace(/^https?:\/\//, "").replace(/\/$/, "")
  return `https://${d}`
}

// Try to find the legal mentions page of a site
// Fetches top candidates in parallel to minimize latency
export async function findLegalPageAndContent(domain: string): Promise<{ url: string; html: string } | null> {
  const base = normalizeDomain(domain)
  const candidates = [
    "/mentions-legales",
    "/legal",
    "/mentions",
    "/fr/mentions-legales",
  ]

  // Parallel fetch all candidates
  const results = await Promise.all(
    candidates.map(async (path) => {
      const url = `${base}${path}`
      const html = await fetchPage(url, 3000)
      if (html && (html.toLowerCase().includes("siren") || html.toLowerCase().includes("rcs") || html.toLowerCase().includes("mentions légales"))) {
        return { url, html }
      }
      return null
    })
  )

  const hit = results.find((r) => r !== null)
  return hit ?? null
}

// Legacy compat wrapper
export async function findLegalPage(domain: string): Promise<string | null> {
  const result = await findLegalPageAndContent(domain)
  return result?.url ?? null
}

// Extract SIREN from HTML using regex
export function extractSiren(html: string): string | null {
  // SIRET = 14 digits, SIREN = 9 digits
  // Pattern: "SIREN 123 456 789" or "SIRET 12345678901234" or "RCS Paris 123456789"
  const sirenPatterns = [
    /siren\s*[:=]?\s*([\d\s]{9,14})/i,
    /siret\s*[:=]?\s*([\d\s]{14,17})/i,
    /rcs[^0-9]*([\d\s]{9,14})/i,
    /n°\s*([\d\s]{9,17})/i,
  ]

  for (const pattern of sirenPatterns) {
    const match = html.match(pattern)
    if (match) {
      const digits = match[1].replace(/\s/g, "")
      if (digits.length >= 9) {
        return digits.slice(0, 9) // SIREN = first 9 digits
      }
    }
  }
  return null
}

// Extract raison sociale from legal mentions
export function extractRaisonSociale(html: string): string | null {
  const $ = cheerio.load(html)
  const text = $("body").text()

  // Patterns like "Société : XXX" or "Raison sociale : XXX"
  const patterns = [
    /(?:raison sociale|d[ée]nomination|soci[ée]t[ée])\s*[:=]?\s*([^\n,;.]+?)(?=[\n,;.]|siren|siret|rcs|$)/i,
    /([A-Z][A-Za-z0-9 &\-'.]{2,50}(?:SAS|SARL|SA|EURL|SCI|SASU))/,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      return match[1].trim().slice(0, 100)
    }
  }
  return null
}

// Count stores/boutiques on a page
export function extractStoresCount(html: string): number {
  const $ = cheerio.load(html)

  // Strategy 1: count postal code patterns (French 5-digit codes)
  const text = $("body").text()
  const frenchPostalPattern = /\b\d{5}\s+[A-Z][a-zéèêëàâäîïôöùûüç\-' ]{2,30}\b/gi
  const postalMatches = text.match(frenchPostalPattern) ?? []

  // Strategy 2: count "boutique", "magasin", "store" occurrences on dedicated pages
  const pageText = text.toLowerCase()
  const keywords = ["boutique", "magasin", "store", "point de vente"]
  let keywordDensity = 0
  for (const k of keywords) {
    keywordDensity += (pageText.match(new RegExp(k, "gi")) ?? []).length
  }

  // If the page mentions store-related keywords heavily AND has addresses, trust postal count
  if (keywordDensity > 5 && postalMatches.length > 1) {
    return Math.min(postalMatches.length, 500)
  }

  return 0
}

// Extract languages from hreflang tags and language switchers
export function extractLanguages(html: string): string[] {
  const $ = cheerio.load(html)
  const languages = new Set<string>()

  // hreflang tags
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const hreflang = $(el).attr("hreflang")
    if (hreflang && hreflang !== "x-default") {
      const lang = hreflang.split("-")[0].toLowerCase()
      if (lang.length === 2) languages.add(lang)
    }
  })

  // HTML lang attribute (always include)
  const htmlLang = $("html").attr("lang")
  if (htmlLang) {
    const lang = htmlLang.split("-")[0].toLowerCase()
    if (lang.length === 2) languages.add(lang)
  }

  return Array.from(languages)
}

// Extract subsites (alternate language URLs)
export function extractSubsites(html: string, baseDomain: string): Array<{ lang: string; url: string }> {
  const $ = cheerio.load(html)
  const subsites: Array<{ lang: string; url: string }> = []
  const seen = new Set<string>()

  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const hreflang = $(el).attr("hreflang")
    const href = $(el).attr("href")
    if (!hreflang || !href || hreflang === "x-default") return

    const lang = hreflang.split("-")[0].toLowerCase()
    try {
      const url = new URL(href, `https://${baseDomain}`).toString()
      if (!seen.has(url)) {
        seen.add(url)
        subsites.push({ lang, url })
      }
    } catch {}
  })

  return subsites
}

// Helper: clean up the domain
export function cleanDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .split("/")[0]
}
