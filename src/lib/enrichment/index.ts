import {
  fetchPage,
  findLegalPage,
  extractSiren,
  extractRaisonSociale,
  extractStoresCount,
  extractLanguages,
  extractSubsites,
  cleanDomain,
} from "./website"
import { enrichWithPappers } from "./pappers"
import { extractWithClaude } from "./claude"
import type { UpsellSignals } from "../types"
import { buildUpsellSignals } from "../scoring/upsell"
import { getCached, setCache } from "../cache"

// Cache enrichment results (longer TTL — 24h)
const ENRICHMENT_TTL_MS = 24 * 60 * 60 * 1000

export function getCachedEnrichment(companyId: string): UpsellSignals | null {
  return getCached<UpsellSignals>(`enrich_${companyId}`)
}

function setCachedEnrichment(companyId: string, signals: UpsellSignals): void {
  setCache(`enrich_${companyId}`, signals)
}

// Orchestrate enrichment for a single company — NO HubSpot writes
export async function enrichCompany(
  companyId: string,
  domain: string,
  companyName: string,
  mrr: number,
  plan: string | null,
  allCustomerDomains: Map<string, { id: string; name: string }>
): Promise<UpsellSignals | null> {
  // Check cache first
  const cached = getCachedEnrichment(companyId)
  if (cached) return cached

  const cleaned = cleanDomain(domain)
  if (!cleaned) return null

  // Try /boutiques, /stores pages for store count
  const storePages = ["/boutiques", "/magasins", "/stores", "/store-locator", "/nos-boutiques", "/find-a-store", "/where-to-buy"]
  let storesCount = 0
  for (const path of storePages) {
    const html = await fetchPage(`https://${cleaned}${path}`)
    if (html) {
      const count = extractStoresCount(html)
      if (count > storesCount) storesCount = count
      break // Take the first page that returns a count
    }
  }

  // Fetch homepage for languages & subsites
  const homeHtml = await fetchPage(`https://${cleaned}/`)
  let languages: string[] = []
  let subsites: Array<{ lang: string; url: string }> = []
  if (homeHtml) {
    languages = extractLanguages(homeHtml)
    subsites = extractSubsites(homeHtml, cleaned)
  }

  // Find legal page and extract SIREN
  const legalUrl = await findLegalPage(cleaned)
  let siren: string | null = null
  let legalHtml: string | null = null

  if (legalUrl) {
    legalHtml = await fetchPage(legalUrl)
    if (legalHtml) {
      siren = extractSiren(legalHtml)
    }
  }

  // Fallback: if regex failed, try Claude extraction on the legal HTML
  if (!siren && legalHtml) {
    const claudeResult = await extractWithClaude(legalHtml, companyName)
    if (claudeResult.siren) siren = claudeResult.siren
    if (claudeResult.storesCount !== null && claudeResult.storesCount > storesCount) {
      storesCount = claudeResult.storesCount
    }
  }

  // If still no SIREN and we have homepage, try Claude on homepage
  if (!siren && homeHtml) {
    const claudeResult = await extractWithClaude(homeHtml, companyName)
    if (claudeResult.siren) siren = claudeResult.siren
  }

  // Enrich with Pappers if we have SIREN
  let parentCompany: string | null = null
  let parentSiren: string | null = null
  let siblingBrands: Array<{ name: string; siren: string; isClient: boolean; hubspotCompanyId?: string }> = []

  if (siren) {
    const pappers = await enrichWithPappers(siren)
    parentCompany = pappers.parentCompanyName
    parentSiren = pappers.parentCompanySiren

    // Cross-reference subsidiaries with HubSpot customers
    const clientsList = Array.from(allCustomerDomains.values())
    siblingBrands = pappers.subsidiaries.map((sub) => {
      let hubspotCompanyId: string | undefined
      let isClient = false
      for (const client of clientsList) {
        const subLower = sub.name.toLowerCase()
        const clientLower = client.name.toLowerCase()
        if (clientLower.includes(subLower) || subLower.includes(clientLower)) {
          hubspotCompanyId = client.id
          isClient = true
          break
        }
      }
      return { name: sub.name, siren: sub.siren, isClient, hubspotCompanyId }
    })
  }

  const signals = buildUpsellSignals({
    parentCompany,
    parentSiren,
    siblingBrands,
    storesCount,
    languages,
    subsites,
    mrr,
    plan,
  })

  setCachedEnrichment(companyId, signals)
  return signals
}
