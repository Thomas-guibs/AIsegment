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
import type { UpsellSignals, Company } from "../types"
import { buildUpsellSignals } from "../scoring/upsell"
import { hubspotFetch } from "../hubspot/client"

// Orchestrate enrichment for a single company
export async function enrichCompany(
  companyId: string,
  domain: string,
  companyName: string,
  mrr: number,
  plan: string | null,
  allCustomerDomains: Map<string, { id: string; name: string }>
): Promise<UpsellSignals | null> {
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

  return buildUpsellSignals({
    parentCompany,
    parentSiren,
    siblingBrands,
    storesCount,
    languages,
    subsites,
    mrr,
    plan,
  })
}

// Serialize UpsellSignals into HubSpot property values
export function serializeForHubSpot(signals: UpsellSignals): Record<string, string> {
  return {
    upsell_parent_company: signals.parentCompany ?? "",
    upsell_parent_siren: signals.parentSiren ?? "",
    upsell_sibling_brands: JSON.stringify(signals.siblingBrands),
    upsell_stores_count: String(signals.storesCount),
    upsell_languages: JSON.stringify(signals.languages),
    upsell_subsites: JSON.stringify(signals.subsites),
    upsell_enriched_at: signals.enrichedAt ? signals.enrichedAt.slice(0, 10) : "",
    upsell_score: String(signals.score),
  }
}

// Write enrichment results to HubSpot
export async function writeEnrichmentToHubSpot(companyId: string, signals: UpsellSignals): Promise<void> {
  const properties = serializeForHubSpot(signals)
  await hubspotFetch(`/crm/v3/objects/companies/${companyId}`, {
    method: "PATCH",
    body: { properties },
  } as any)
}

// Parse HubSpot stored values back to UpsellSignals
export function parseUpsellSignalsFromHubSpot(props: Record<string, string | null>): UpsellSignals | null {
  if (!props.upsell_enriched_at) return null

  const safeParse = <T>(json: string | null | undefined, fallback: T): T => {
    if (!json) return fallback
    try { return JSON.parse(json) as T } catch { return fallback }
  }

  const score = parseInt(props.upsell_score ?? "0", 10)
  const grade: UpsellSignals["grade"] = score > 70 ? "hot" : score >= 40 ? "warm" : "cold"

  return {
    parentCompany: props.upsell_parent_company || null,
    parentSiren: props.upsell_parent_siren || null,
    siblingBrands: safeParse(props.upsell_sibling_brands, []),
    storesCount: parseInt(props.upsell_stores_count ?? "0", 10) || 0,
    languages: safeParse(props.upsell_languages, []),
    subsites: safeParse(props.upsell_subsites, []),
    enrichedAt: props.upsell_enriched_at,
    score,
    grade,
  }
}
