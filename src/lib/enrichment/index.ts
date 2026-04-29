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
import { extractWithClaude, qualifyCompany } from "./claude"
import { saveEnrichment, getEnrichment } from "./storage"
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
  allCustomerDomains: Map<string, { id: string; name: string }>,
  csmId?: string | null,
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

  // Check persistent KV first — costs $0.30 to recompute, never recompute
  const stored = await getEnrichment(companyId).catch(() => null)
  if (stored) {
    console.log(`[enrich:${companyId}] hit KV cache enrichedAt=${stored.enrichedAt}`)
    return { signals: stored.signals, debug }
  }

  // Then in-memory cache (10 min) — useful within a single warm function instance
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

            // Fetch company detail to get website/domain + commercial name
            const companyDetail = await fetchPappersCompany(related.siren)
            const naf = companyDetail?.code_naf ?? related.codeNaf
            const nafSignal = getNafCommerceSignal(naf)
            const forme = companyDetail?.forme_juridique ?? related.formeJuridique

            // Log Pappers response fields for domain discovery debug
            if (companyDetail) {
              console.log(`[domain:${related.siren}] ${related.name} | site_web=${companyDetail.site_web ?? "null"} nom_commercial=${companyDetail.nom_commercial ?? "null"} enseignes=${JSON.stringify(companyDetail.enseignes ?? [])} noms_de_domaine=${JSON.stringify(companyDetail.noms_de_domaine ?? [])}`)
            } else {
              console.log(`[domain:${related.siren}] ${related.name} | no companyDetail`)
            }

            if (companyDetail) {
              // 1. site_web — direct URL (best source)
              const siteWeb: string | null = companyDetail.site_web ?? null
              if (siteWeb) {
                companyDomain = siteWeb.replace(/^https?:\/\//, "").replace(/\/$/, "").split("/")[0]
                domainValidated = true
                icpSignals.push(`Site Pappers: ${companyDomain}`)
              }

              // 2. noms_de_domaine — array of domains registered to the company (RCS data)
              if (!companyDomain && Array.isArray(companyDetail.noms_de_domaine)) {
                const domains: string[] = companyDetail.noms_de_domaine
                if (domains.length > 0) {
                  companyDomain = domains[0].replace(/^https?:\/\//, "").replace(/\/$/, "").split("/")[0]
                  domainValidated = true
                  icpSignals.push(`Domaine RCS: ${companyDomain}`)
                }
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

            // Fallback: infer domain from name
            // Try nom_commercial first (e.g. "Musc Intime" → muscintime.fr)
            // then denomination (e.g. "SEKAYA" → sekaya.fr)
            // SIREN validation eliminates homonyms
            if (!companyDomain) {
              const commercialName: string | null =
                companyDetail?.nom_commercial ??
                (Array.isArray(companyDetail?.enseignes) && companyDetail.enseignes.length > 0
                  ? companyDetail.enseignes[0]
                  : null)

              // Try commercial name first (often matches the real brand domain)
              if (commercialName && commercialName.toLowerCase() !== related.name.toLowerCase()) {
                const guess = await guessDomain(commercialName, related.siren)
                console.log(`[domain:${related.siren}] guess nom_commercial="${commercialName}" → ${guess.domain ?? "null"} validated=${guess.validated} tested=${guess.tested} resolved=${guess.resolved}`)
                if (guess.domain) {
                  companyDomain = guess.domain
                  domainValidated = guess.validated
                  icpSignals.push(
                    guess.validated
                      ? `Domaine (nom commercial) validé: ${guess.domain}`
                      : `Domaine (nom commercial): ${guess.domain}`,
                  )
                }
              }

              // Then try the legal name (denomination)
              if (!companyDomain) {
                const guess = await guessDomain(related.name, related.siren)
                console.log(`[domain:${related.siren}] guess denomination="${related.name}" → ${guess.domain ?? "null"} validated=${guess.validated} tested=${guess.tested} resolved=${guess.resolved}`)
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

              // Last resort: Claude AI with autonomous web search
              // Claude finds the commercial brand name + website + qualifies the company
              // Handles cases where the brand (e.g. "Musc Intime") differs from the
              // legal name (e.g. "SEKAYA") — Claude searches the web and verifies.
              if (!companyDomain) {
                const qualification = await qualifyCompany({
                  denomination: related.name,
                  siren: related.siren,
                  codeNaf: naf ?? undefined,
                  libelleNaf: companyDetail?.libelle_code_naf ?? undefined,
                  objetSocial: companyDetail?.objet_social ?? undefined,
                  formeJuridique: forme ?? undefined,
                })

                if (qualification.domain) {
                  companyDomain = qualification.domain
                  domainValidated = true   // Claude verified via web search
                  icpSignals.push(`Domaine (Claude): ${qualification.domain}`)
                }
                if (qualification.commercialName) {
                  icpSignals.push(`Marque: ${qualification.commercialName}`)
                }
                if (qualification.isEcommerce) {
                  ecommerce = true
                  if (qualification.reasoning) {
                    icpSignals.push(`E-commerce (Claude): ${qualification.reasoning}`)
                  }
                }
                if (qualification.platform) {
                  platform = qualification.platform
                  fit = ["Shopify", "PrestaShop"].includes(qualification.platform)
                    ? "strong"
                    : "partial"
                  icpSignals.push(`Plateforme (Claude): ${qualification.platform}`)
                }
                if (qualification.icpScore > 0) {
                  icpSignals.push(`Score Claude: ${qualification.icpScore}/100`)
                }
              }
            }

            console.log(`[domain:${related.siren}] RESULT domain=${companyDomain ?? "null"} validated=${domainValidated}`)

            // Run HTTP-based ecommerce detection only if we don't already know
            // (Claude qualification already verified ecommerce status via web search)
            if (companyDomain && !ecommerce) {
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

  // Persist to KV with parent metadata for the /upsell-signals view
  await saveEnrichment({
    companyId,
    parentName: companyName,
    parentMrr: mrr,
    parentCsmId: csmId ?? null,
    signals,
    enrichedAt: new Date().toISOString(),
  }).catch((e) => console.warn(`[enrich:${companyId}] KV save failed: ${String(e).slice(0, 200)}`))

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
  allCustomerDomains: Map<string, { id: string; name: string }>,
  csmId?: string | null,
): Promise<UpsellSignals | null> {
  const { signals } = await enrichCompanyWithDebug(companyId, domain, companyName, mrr, plan, allCustomerDomains, csmId)
  return signals
}
