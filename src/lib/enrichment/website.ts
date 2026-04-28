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
// Checks homepage + /shop + /boutique in parallel to catch sites where
// the homepage is marketing-only and the shop lives on a sub-path.
export async function detectEcommerce(domain: string): Promise<EcommerceDetection> {
  const base = `https://${domain}`
  const [home, shopHtml, boutiqueHtml] = await Promise.all([
    fetchPage(`${base}/`, 3000),
    fetchPage(`${base}/shop`, 2000),
    fetchPage(`${base}/boutique`, 2000),
  ])

  const html = [home, shopHtml, boutiqueHtml].filter(Boolean).join("\n")
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

  // Schema.org / Open Graph product markup
  if (/"@type"\s*:\s*"(product|offer|onlinestore|store)"/i.test(html) ||
      /<meta[^>]+(?:property|name)=["']og:type["'][^>]+content=["']product["']/i.test(html)) {
    return { isEcommerce: true, platform: "Generic", fit: "partial" }
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

// =============================================================================
// Domain inference: guess a company website from its name
// =============================================================================

const LEGAL_SUFFIX_RE = /\b(SAS|SASU|SARL|SA|EURL|SNC|GIE|SCI|SCEA|SCM|SELARL|SCOP|SCIC|SE|EI|EIRL)\b/gi
const ARTICLE_PREFIX_RE = /^(le|la|les|l['']|the)\s+/i
const FILLER_WORDS_RE = /\b(et|and|de|du|des|la|le|les)\b/gi

function deaccent(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "")
}

// Generate ordered candidate domains from a company name
// e.g. "Côté Maison SAS" -> ["cotemaison.fr", "cote-maison.fr", "cotemaison.com", ...]
export function generateDomainCandidates(companyName: string): string[] {
  const stripped = companyName.replace(LEGAL_SUFFIX_RE, "").replace(/&/g, " et ").trim()
  if (!stripped) return []

  const noArticle = stripped.replace(ARTICLE_PREFIX_RE, "")

  // Tokenize each variant
  const toTokens = (s: string) =>
    deaccent(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean)

  const tokensWithArticle = toTokens(stripped)
  const tokensNoArticle = toTokens(noArticle)
  // "Atelier de la Vigne" -> "ateliervigne" (drop fillers)
  const tokensCore = tokensNoArticle.filter((t) => !FILLER_WORDS_RE.test(t))

  const bases = new Set<string>()
  for (const tokens of [tokensNoArticle, tokensWithArticle, tokensCore]) {
    if (tokens.length === 0) continue
    const concat = tokens.join("")
    const hyphen = tokens.join("-")
    if (concat.length >= 3) bases.add(concat)
    if (hyphen.length >= 3 && tokens.length > 1) bases.add(hyphen)
  }

  // Domain candidates: French companies → .fr first, then .com, then commerce-specific TLDs
  const tlds = [".fr", ".com", ".shop", ".store", ".boutique"]
  const candidates: string[] = []
  for (const base of Array.from(bases)) {
    for (const tld of tlds) {
      candidates.push(base + tld)
    }
  }
  return Array.from(new Set(candidates))
}

// Quick HEAD/GET check to see if a domain serves HTTP
async function domainResolves(domain: string): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 1500)
    const res = await fetch(`https://${domain}`, {
      method: "HEAD",
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT },
    })
    clearTimeout(t)
    // Live server: 2xx, 3xx, 401/403 (auth), 405 (HEAD not allowed)
    return res.status < 500 && res.status !== 404
  } catch {
    return false
  }
}

// Verify that a domain belongs to the given company by finding the SIREN in the HTML
async function validateDomainOwnership(domain: string, siren: string): Promise<boolean> {
  if (!siren || siren.length !== 9) return false
  const cleanSiren = siren.replace(/\s/g, "")
  const sirenSpaced = `${cleanSiren.slice(0, 3)} ${cleanSiren.slice(3, 6)} ${cleanSiren.slice(6, 9)}`

  const home = await fetchPage(`https://${domain}/`, 2500)
  if (home && (home.includes(cleanSiren) || home.includes(sirenSpaced))) return true

  const legal = await findLegalPageAndContent(domain)
  if (legal?.html && (legal.html.includes(cleanSiren) || legal.html.includes(sirenSpaced))) return true

  return false
}

export interface GuessDomainResult {
  domain: string | null
  validated: boolean         // true if SIREN was found on the site
  tested: number             // how many candidates were probed
  resolved: number           // how many resolved (live)
}

// Try to find a company's website by inferring from its name.
// If `siren` is provided, validates ownership by checking the SIREN appears
// on the homepage or legal page → eliminates homonyms / squatters.
// Without SIREN, returns the first resolving candidate (best-effort).
export async function guessDomain(
  companyName: string,
  siren?: string,
): Promise<GuessDomainResult> {
  const candidates = generateDomainCandidates(companyName)
  if (candidates.length === 0) {
    return { domain: null, validated: false, tested: 0, resolved: 0 }
  }

  // Phase 1: parallel resolve check (~1.5s for the whole batch)
  const resolveResults = await Promise.all(
    candidates.map(async (c) => ({ domain: c, ok: await domainResolves(c) })),
  )
  const resolved = resolveResults.filter((r) => r.ok).map((r) => r.domain)

  if (resolved.length === 0) {
    return { domain: null, validated: false, tested: candidates.length, resolved: 0 }
  }

  // Phase 2: SIREN validation — sequential, bail on first match
  if (siren) {
    for (const domain of resolved) {
      if (await validateDomainOwnership(domain, siren)) {
        return { domain, validated: true, tested: candidates.length, resolved: resolved.length }
      }
    }
  }

  // No SIREN match (or no SIREN provided): keep best candidate, prefer .fr
  const fallback = resolved.find((d) => d.endsWith(".fr")) ?? resolved[0]
  return { domain: fallback, validated: false, tested: candidates.length, resolved: resolved.length }
}

// =============================================================================
// NAF code → ecommerce signal level
// =============================================================================

export type NafSignal = "strong" | "weak" | "none"

// 47.91 = "Vente à distance" (mail order / online retail) → near-certain ecommerce
// 47.xx = Commerce de détail (some online, some not)
// 46.xx = Commerce de gros (B2B, weaker fit for Loyoly)
export function getNafCommerceSignal(codeNaf: string | null | undefined): NafSignal {
  if (!codeNaf) return "none"
  const normalized = codeNaf.replace(/[^0-9A-Z]/gi, "").toUpperCase()
  if (normalized.startsWith("4791")) return "strong"
  const prefix = normalized.slice(0, 2)
  if (prefix === "47" || prefix === "46") return "weak"
  return "none"
}

// Backwards-compatible boolean helper
export function isEcommerceNaf(codeNaf: string | null | undefined): boolean {
  return getNafCommerceSignal(codeNaf) !== "none"
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
