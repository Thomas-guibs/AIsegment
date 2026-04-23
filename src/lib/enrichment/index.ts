import {
  fetchPage,
  findLegalPageAndContent,
  extractSiren,
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

export function getCachedEnrichment(companyId: string): UpsellSignals | null {
  return getCached<UpsellSignals>(`enrich_${companyId}`)
}

function setCachedEnrichment(companyId: string, signals: UpsellSignals): void {
  setCache(`enrich_${companyId}`, signals)
}

// Orchestrate enrichment for a single company — parallel fetching to stay under Vercel timeout
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

  // PARALLEL FETCH: homepage + legal page + one stores page (most common)
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

  // Extract stores count (try both homepage and stores page)
  let storesCount = 0
  if (storesPageHtml) {
    storesCount = extractStoresCount(storesPageHtml)
  }
  if (storesCount === 0 && homeHtml) {
    storesCount = extractStoresCount(homeHtml)
  }

  // Extract SIREN from legal page (regex first, Claude fallback only if needed)
  let siren: string | null = null
  if (legalResult?.html) {
    siren = extractSiren(legalResult.html)
    if (!siren) {
      const claudeResult = await extractWithClaude(legalResult.html, companyName)
      if (claudeResult.siren) siren = claudeResult.siren
    }
  }

  // Enrich with Pappers if we have a SIREN
  let parentCompany: string | null = null
  let parentSiren: string | null = null
  let siblingBrands: Array<{ name: string; siren: string; isClient: boolean; hubspotCompanyId?: string }> = []

  if (siren) {
    const pappers = await enrichWithPappers(siren)
    parentCompany = pappers.parentCompanyName
    parentSiren = pappers.parentCompanySiren

    const clientsList = Array.from(allCustomerDomains.values())
    siblingBrands = pappers.subsidiaries.map((sub) => {
      let hubspotCompanyId: string | undefined
      let isClient = false
      const subLower = sub.name.toLowerCase()
      for (const client of clientsList) {
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
