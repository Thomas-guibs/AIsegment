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
    const text = await response.text()
    // Strip scripts, styles and inline SVG to drastically reduce size
    // (Shopify pages can be 600KB+ with legal info in footer)
    const cleaned = text
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<svg[\s\S]*?<\/svg>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
    // Keep up to 1MB of cleaned HTML (usually 10-20× smaller than raw)
    return cleaned.slice(0, 1_000_000)
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

export type EcommercePlatform = "Shopify" | "WooCommerce" | "PrestaShop" | "Magento" | "BigCommerce" | "Shopware" | "Generic"

export interface EcommerceDetection {
  isEcommerce: boolean
  platform: EcommercePlatform | null
  fit: "strong" | "partial" | "none"
}

// Check if a domain looks like an ecommerce site (ICP for Loyoly)
export async function isEcommerceSite(domain: string): Promise<boolean> {
  const detection = await detectEcommerce(domain)
  return detection.isEcommerce
}

// Detect ecommerce platform on a domain (Shopify, PrestaShop, WooCommerce...)
export async function detectEcommerce(domain: string): Promise<EcommerceDetection> {
  const html = await fetchPage(`https://${domain}/`, 3000)
  if (!html) return { isEcommerce: false, platform: null, fit: "none" }
  const lower = html.toLowerCase()

  // Strong-fit platforms (high Loyoly conversion intent)
  if (lower.includes("cdn.shopify.com") || lower.includes("shopify.com") || lower.includes("shopify-section")) {
    return { isEcommerce: true, platform: "Shopify", fit: "strong" }
  }
  if (lower.includes("prestashop") || lower.includes("/themes/prestashop")) {
    return { isEcommerce: true, platform: "PrestaShop", fit: "strong" }
  }

  // Partial-fit platforms
  if (lower.includes("woocommerce") || lower.includes("wp-content/plugins/woocommerce")) {
    return { isEcommerce: true, platform: "WooCommerce", fit: "partial" }
  }
  if (lower.includes("magento") || lower.includes("mage/cookies")) {
    return { isEcommerce: true, platform: "Magento", fit: "partial" }
  }
  if (lower.includes("bigcommerce")) {
    return { isEcommerce: true, platform: "BigCommerce", fit: "partial" }
  }
  if (lower.includes("shopware")) {
    return { isEcommerce: true, platform: "Shopware", fit: "partial" }
  }

  // Generic ecommerce signals (cart/checkout/products)
  const cartSignals = lower.includes("/cart") || lower.includes("/panier") ||
    lower.includes("add-to-cart") || lower.includes("ajouter-au-panier") ||
    lower.includes("/checkout") || lower.includes("/commande")
  const productSignals = lower.includes("/products/") || lower.includes("/produit/") ||
    lower.includes("/collections/") || lower.includes("/categorie-produit/")

  if (cartSignals || productSignals) {
    return { isEcommerce: true, platform: "Generic", fit: "partial" }
  }
  return { isEcommerce: false, platform: null, fit: "none" }
}

// Try to guess a company's domain from its name
// Strategy: normalize name (strip legal suffixes, accents, non-alpha) and probe {name}.fr / {name}.com
export async function guessDomain(companyName: string): Promise<string | null> {
  const normalized = companyName
    .replace(/\b(SAS|SARL|SASU|SA|EURL|SNC|GIE|SCI|SCEA|SCM|SELARL)\b/gi, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .trim()

  if (normalized.length < 3) return null

  const candidates = [`${normalized}.fr`, `${normalized}.com`]

  for (const candidate of candidates) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 2000)
      const res = await fetch(`https://${candidate}`, {
        method: "HEAD",
        signal: ctrl.signal,
        redirect: "follow",
        headers: { "User-Agent": USER_AGENT },
      })
      clearTimeout(t)
      // 200 OK, 301/302 redirect, or 405 (HEAD not allowed but server up) = domain is live
      if (res.ok || res.status === 405 || (res.status >= 300 && res.status < 400)) {
        return candidate
      }
    } catch {
      // try next candidate
    }
  }
  return null
}

// NAF prefixes that signal ecommerce / D2C activity (Loyoly ICP)
const ECOMMERCE_NAF_PREFIXES = ["47", "46"] // Commerce de détail, Commerce de gros

export function isEcommerceNaf(codeNaf: string | null | undefined): boolean {
  if (!codeNaf) return false
  return ECOMMERCE_NAF_PREFIXES.includes(codeNaf.slice(0, 2))
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
