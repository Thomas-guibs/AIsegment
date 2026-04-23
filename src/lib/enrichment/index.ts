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

export interface EnrichmentDebug {
  domain: string
  homepageFetched: boolean
  legalPageUrl: string | null
  legalPageFetched: boolean
  sirenFound: string | null
  sirenMethod: "regex" | "claude" | "none"
  pappersCalled: boolean
  pappersRelatedCount: number
  pappersError: string | null
}

// Enrichment with optional debug output
export async function enrichCompanyWithDebug(
  companyId: string,
  domain: string,
  companyName: string,
  mrr: number,
  plan: string | null,
  allCustomerDomains: Map<string, { id: string; name: string }>
): Promise<{ signals: UpsellSignals | null; debug: EnrichmentDebug }> {
  const debug: EnrichmentDebug = {
    domain,
    homepageFetched: false,
    legalPageUrl: null,
    legalPageFetched: false,
    sirenFound: null,
    sirenMethod: "none",
    pappersCalled: false,
    pappersRelatedCount: 0,
    pappersError: null,
  }

  const cached = getCachedEnrichment(companyId)
  if (cached) return { signals: cached, debug }

  const cleaned = cleanDomain(domain)
  if (!cleaned) return { signals: null, debug }
  const base = `https://${cleaned}`

  // PARALLEL: homepage + legal page + stores page
  const [homeHtml, legalResult, storesPageHtml] = await Promise.all([
    fetchPage(`${base}/`, 4000),
    findLegalPageAndContent(cleaned),
    fetchPage(`${base}/boutiques`, 3000).then(async (h) =>
      h ?? fetchPage(`${base}/stores`, 3000).then((h2) => h2 ?? fetchPage(`${base}/magasins`, 3000))
    ),
  ])

  debug.homepageFetched = !!homeHtml
  debug.legalPageUrl = legalResult?.url ?? null
  debug.legalPageFetched = !!legalResult?.html

  // Extract from homepage
  const languages = homeHtml ? extractLanguages(homeHtml) : []
  const subsites = homeHtml ? extractSubsites(homeHtml, cleaned) : []

  // Stores count
  let storesCount = 0
  if (storesPageHtml) storesCount = extractStoresCount(storesPageHtml)
  if (storesCount === 0 && homeHtml) storesCount = extractStoresCount(homeHtml)

  // Extract SIREN from legal page, fallback to homepage
  let siren: string | null = null
  if (legalResult?.html) {
    siren = extractSiren(legalResult.html)
    if (siren) debug.sirenMethod = "regex"

    if (!siren) {
      const claudeResult = await extractWithClaude(legalResult.html, companyName)
      if (claudeResult.siren) {
        siren = claudeResult.siren
        debug.sirenMethod = "claude"
      }
    }
  }

  // Fallback: try extracting SIREN from homepage (some sites put legal info in footer)
  if (!siren && homeHtml) {
    siren = extractSiren(homeHtml)
    if (siren) debug.sirenMethod = "regex"
  }

  debug.sirenFound = siren

  // Enrich with Pappers
  let parentCompany: string | null = null
  let parentSiren: string | null = null
  let siblingBrands: Array<{ name: string; siren: string; isClient: boolean; hubspotCompanyId?: string; isEcommerce?: boolean; role?: string }> = []

  if (siren) {
    debug.pappersCalled = true
    try {
      const pappers = await enrichWithPappers(siren)
      parentCompany = pappers.parentCompanyName
      parentSiren = pappers.parentCompanySiren
      debug.pappersRelatedCount = pappers.relatedCompanies.length

      if (pappers.relatedCompanies.length > 0) {
        const clientsList = Array.from(allCustomerDomains.values())
        const topRelated = pappers.relatedCompanies.slice(0, 8)

        siblingBrands = await Promise.all(
          topRelated.map(async (related) => {
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
    } catch (err) {
      debug.pappersError = String(err).slice(0, 200)
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

  // Log the debug trace for investigation
  console.log(`[enrichment:${companyId}]`, JSON.stringify(debug))

  return { signals, debug }
}

// Wrapper for backwards compatibility
export async function enrichCompany(
  companyId: string,
  domain: string,
  companyName: string,
  mrr: number,
  plan: string | null,
  allCustomerDomains: Map<string, { id: string; name: string }>
): Promise<UpsellSignals | null> {
  const { signals } = await enrichCompanyWithDebug(companyId, domain, companyName, mrr, plan, allCustomerDomains)
  return signals
}
