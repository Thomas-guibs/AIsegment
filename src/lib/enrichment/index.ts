import {
  fetchPage,
  findLegalPageAndContent,
  extractSiren,
  extractStoresCount,
  extractLanguages,
  extractSubsites,
  cleanDomain,
  isEcommerceSite,
} from "./website"
import { enrichWithPappers } from "./pappers"
import { extractWithClaude } from "./claude"
import type { UpsellSignals } from "../types"
import { buildUpsellSignals } from "../scoring/upsell"
import { getCached, setCache } from "../cache"

export function getCachedEnrichment(companyId: string): UpsellSignals | null {
  return getCached<UpsellSignals>(`enrich_${companyId}`)
}

function setCachedEnrichment(companyId: string, signals: UpsellSignals): void {
  setCache(`enrich_${companyId}`, signals)
}

// Orchestrate enrichment for a single company
export async function enrichCompany(
  companyId: string,
  domain: string,
  companyName: string,
  mrr: number,
  plan: string | null,
  allCustomerDomains: Map<string, { id: string; name: string }>
): Promise<UpsellSignals | null> {
  const cached = getCachedEnrichment(companyId)
  if (cached) return cached

  const cleaned = cleanDomain(domain)
  if (!cleaned) return null
  const base = `https://${cleaned}`

  // PARALLEL: homepage + legal page + stores page
  const [homeHtml, legalResult, storesPageHtml] = await Promise.all([
    fetchPage(`${base}/`, 4000),
    findLegalPageAndContent(cleaned),
    fetchPage(`${base}/boutiques`, 3000).then(async (h) =>
      h ?? fetchPage(`${base}/stores`, 3000).then((h2) => h2 ?? fetchPage(`${base}/magasins`, 3000))
    ),
  ])

  // Extract from homepage
  const languages = homeHtml ? extractLanguages(homeHtml) : []
  const subsites = homeHtml ? extractSubsites(homeHtml, cleaned) : []

  // Stores count
  let storesCount = 0
  if (storesPageHtml) storesCount = extractStoresCount(storesPageHtml)
  if (storesCount === 0 && homeHtml) storesCount = extractStoresCount(homeHtml)

  // Extract SIREN from legal page
  let siren: string | null = null
  if (legalResult?.html) {
    siren = extractSiren(legalResult.html)
    if (!siren) {
      const claudeResult = await extractWithClaude(legalResult.html, companyName)
      if (claudeResult.siren) siren = claudeResult.siren
    }
  }

  // Enrich with Pappers cartography if we have SIREN
  let parentCompany: string | null = null
  let parentSiren: string | null = null
  let siblingBrands: Array<{ name: string; siren: string; isClient: boolean; hubspotCompanyId?: string; isEcommerce?: boolean; role?: string }> = []

  if (siren) {
    const pappers = await enrichWithPappers(siren)
    parentCompany = pappers.parentCompanyName
    parentSiren = pappers.parentCompanySiren

    if (pappers.relatedCompanies.length > 0) {
      const clientsList = Array.from(allCustomerDomains.values())

      // Check ICP (ecommerce) for top related companies — limit to 5 to avoid timeout
      const topRelated = pappers.relatedCompanies.slice(0, 8)

      siblingBrands = await Promise.all(
        topRelated.map(async (related) => {
          // Check if already a client
          let hubspotCompanyId: string | undefined
          let isClient = false
          const relLower = related.name.toLowerCase()
          for (const client of clientsList) {
            const clientLower = client.name.toLowerCase()
            if (clientLower.includes(relLower) || relLower.includes(clientLower)) {
              hubspotCompanyId = client.id
              isClient = true
              break
            }
          }

          // ICP check: if related company has a domain, check if it's ecommerce
          let ecommerce = related.isEcommerce
          if (ecommerce === undefined && related.domain) {
            ecommerce = await isEcommerceSite(related.domain)
          }

          return {
            name: related.name,
            siren: related.siren,
            isClient,
            hubspotCompanyId,
            isEcommerce: ecommerce,
            role: related.role,
          }
        })
      )
    }
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
