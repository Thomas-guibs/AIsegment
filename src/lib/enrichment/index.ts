import {
  fetchPage,
  findLegalPageAndContent,
  extractSiren,
  extractStoresCount,
  extractLanguages,
  extractSubsites,
  cleanDomain,
  detectEcommerce,
  guessDomain,
  getNafCommerceSignal,
} from "./website"
import { enrichWithPappers, fetchPappersCompany } from "./pappers"
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
  let siblingBrands: UpsellSignals["siblingBrands"] = []

  if (siren) {
    debug.pappersCalled = true
    try {
      const pappers = await enrichWithPappers(siren)
      parentCompany = pappers.parentCompanyName
      parentSiren = pappers.parentCompanySiren
      debug.pappersRelatedCount = pappers.relatedCompanies.length

      if (pappers.relatedCompanies.length > 0) {
        const clientsList = Array.from(allCustomerDomains.values())

        // Filter out excluded companies (SCI, holdings, etc.), keep relevant ones
        const relevant = pappers.relatedCompanies.filter((c) => !c.excluded)

        // For each relevant company: check ICP fit via website scraping
        // Limit to top 10 to avoid timeout
        const topRelevant = relevant.slice(0, 10)

        siblingBrands = await Promise.all(
          topRelevant.map(async (related) => {
            // Check if already a Loyoly client
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

            // Try to find company website via Pappers company detail
            let companyDomain: string | null = null
            let domainValidated = false
            let ecommerce = false
            let platform: string | null = null
            let fit: "strong" | "partial" | "none" = "none"
            const icpSignals: string[] = []

            // Fetch company detail to get website/domain
            const companyDetail = await fetchPappersCompany(related.siren)
            const naf = companyDetail?.code_naf ?? related.codeNaf
            const nafSignal = getNafCommerceSignal(naf)
            const forme = companyDetail?.forme_juridique ?? related.formeJuridique

            if (companyDetail) {
              // site_web only — domaine_activite is the NAF description, not a URL
              const siteWeb: string | null = companyDetail.site_web ?? null
              if (siteWeb) {
                companyDomain = siteWeb.replace(/^https?:\/\//, "").replace(/\/$/, "").split("/")[0]
                domainValidated = true   // Pappers-sourced → trust it
                icpSignals.push(`Site Pappers: ${companyDomain}`)
              }
            }

            // NAF signal
            if (nafSignal === "strong") {
              icpSignals.push(`NAF ${naf} — Vente à distance`)
            } else if (nafSignal === "weak" && naf) {
              icpSignals.push(`Commerce (NAF ${naf})`)
            }
            if (forme && (forme.includes("SAS") || forme.includes("SARL"))) {
              icpSignals.push(`Societe commerciale (${forme})`)
            }

            // Fallback: if Pappers has no site_web, infer the domain from the name
            // SIREN validation eliminates homonyms (a key false-positive risk)
            if (!companyDomain) {
              const guess = await guessDomain(related.name, related.siren)
              if (guess.domain) {
                companyDomain = guess.domain
                domainValidated = guess.validated
                icpSignals.push(
                  guess.validated
                    ? `Domaine inferé + validé SIREN: ${guess.domain}`
                    : `Domaine inferé (non validé): ${guess.domain}`,
                )
              }
            }

            // Check ecommerce platform on the resolved domain
            if (companyDomain) {
              const detection = await detectEcommerce(companyDomain)
              ecommerce = detection.isEcommerce
              platform = detection.platform
              fit = detection.fit
              if (ecommerce && platform) icpSignals.push(`Plateforme: ${platform}`)
            }

            // ICP Score calculation (0-100)
            let icpScore = 0
            if (fit === "strong") icpScore += 60                            // Shopify / PrestaShop
            else if (fit === "partial") icpScore += 40                      // WooCommerce / generic
            if (nafSignal === "strong") icpScore += 30                      // NAF 47.91
            else if (nafSignal === "weak") icpScore += 15                   // NAF 47.xx / 46.xx
            if (companyDomain && domainValidated) icpScore += 10            // Validated website
            else if (companyDomain) icpScore += 5                           // Unvalidated guess
            if (forme && (forme.includes("SAS") || forme.includes("SARL"))) icpScore += 5
            if (isClient) icpScore = 100                                    // Already a client
            if (icpScore > 100) icpScore = 100

            return {
              name: related.name,
              siren: related.siren,
              isClient,
              hubspotCompanyId,
              isEcommerce: ecommerce,
              platform,
              fit,
              domain: companyDomain,
              role: related.role,
              icpScore,
              icpSignals,
              excluded: false,
            }
          })
        )

        // Sort by ICP score descending (best fits first)
        siblingBrands.sort((a, b) => (b.icpScore ?? 0) - (a.icpScore ?? 0))
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

  // Log each debug field separately (Vercel truncates long log messages)
  console.log(`[enrich:${companyId}] domain=${debug.domain}`)
  console.log(`[enrich:${companyId}] homepage=${debug.homepageFetched} legal=${debug.legalPageFetched} legalUrl=${debug.legalPageUrl}`)
  console.log(`[enrich:${companyId}] siren=${debug.sirenFound} method=${debug.sirenMethod}`)
  console.log(`[enrich:${companyId}] pappersCalled=${debug.pappersCalled} relatedCount=${debug.pappersRelatedCount} pappersError=${debug.pappersError}`)
  console.log(`[enrich:${companyId}] finalSignals parent=${signals.parentCompany} siblings=${signals.siblingBrands.length} stores=${signals.storesCount} languages=${signals.languages.length}`)

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
