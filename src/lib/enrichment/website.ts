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
    "/policies/legal-notice",    // Shopify
    "/policies/terms-of-service", // Shopify
    "/pages/mentions-legales",   // Shopify pages
    "/cgv",
  ]

  // Parallel fetch all candidates
  const results = await Promise.all(
    candidates.map(async (path) => {
      const url = `${base}${path}`
      const html = await fetchPage(url, 3000)
      if (html) {
        const lower = html.toLowerCase()
        if (lower.includes("siren") || lower.includes("siret") ||
            lower.includes("rcs") || lower.includes("tva") ||
            lower.includes("mentions légales") || lower.includes("mentions legales") ||
            lower.includes("capital social")) {
          return { url, html }
        }
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
// Handles: SIREN direct, SIRET (first 9 digits), RCS, TVA intra-communautaire (FR + 2 check digits + 9 SIREN)
export function extractSiren(html: string): string | null {
  // Strip HTML tags for cleaner text matching
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

  const sirenPatterns = [
    // Direct SIREN/SIRET
    /siren\s*[:=]?\s*([\d\s]{9,17})/i,
    /siret\s*[:=]?\s*([\d\s]{9,17})/i,
    // RCS + city + number
    /rcs\s+[a-zéèêëàâ\- ]{2,20}\s*([\d\s]{9,14})/i,
    // TVA intra-communautaire: FR + 2 digits + 9 digits (SIREN)
    /(?:tva|n°\s*tva)[^a-z0-9]*(?:intra[^a-z0-9]*(?:communautaire)?)?[^a-z0-9]*fr\s*(\d{2})\s*(\d{3})\s*(\d{3})\s*(\d{3})/i,
    // Standalone TVA pattern: FR followed by 11 digits
    /fr\s*(\d{11})/i,
    // Capital social section often has SIREN nearby
    /(?:immatricul|enregistr)[^.]{0,60}([\d\s]{9,14})/i,
  ]

  for (const pattern of sirenPatterns) {
    const match = text.match(pattern)
    if (!match) continue

    // TVA intra format: groups are check(2) + 3×3 digits of SIREN
    if (match.length === 5) {
      // Pattern with 4 groups: check + 3 groups of 3
      return `${match[2]}${match[3]}${match[4]}`
    }

    // FR + 11 digits: last 9 = SIREN
    if (match[1] && match[1].length === 11) {
      return match[1].slice(2) // Remove 2 check digits
    }

    // Standard patterns
    const digits = match[1].replace(/\s/g, "")
    if (digits.length >= 9) {
      return digits.slice(0, 9)
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

// Check if a domain looks like an ecommerce site (ICP for Loyoly)
export async function isEcommerceSite(domain: string): Promise<boolean> {
  const html = await fetchPage(`https://${domain}/`, 3000)
  if (!html) return false
  const lower = html.toLowerCase()
  // Platform indicators
  if (lower.includes("shopify") || lower.includes("woocommerce") ||
      lower.includes("prestashop") || lower.includes("magento") ||
      lower.includes("bigcommerce") || lower.includes("shopware")) return true
  // Cart/checkout indicators
  if (lower.includes("/cart") || lower.includes("/panier") ||
      lower.includes("add-to-cart") || lower.includes("ajouter-au-panier") ||
      lower.includes("/checkout") || lower.includes("/commande")) return true
  // Product indicators
  if (lower.includes("/products/") || lower.includes("/produit/") ||
      lower.includes("/collections/") || lower.includes("/categorie-produit/")) return true
  return false
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
