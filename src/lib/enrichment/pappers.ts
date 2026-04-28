// Pappers API integration for French company data
// Docs: https://api.pappers.fr
// Uses the /v2/entreprise endpoint + dirigeants to map related companies

const PAPPERS_BASE = "https://api.pappers.fr/v2"

function getApiKey(): string | null {
  return process.env.PAPPERS_API_KEY ?? null
}

async function pappersFetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T | null> {
  const key = getApiKey()
  if (!key) {
    console.warn("PAPPERS_API_KEY not configured")
    return null
  }

  const url = new URL(`${PAPPERS_BASE}${endpoint}`)
  url.searchParams.set("api_token", key)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }

  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    })
    if (!response.ok) {
      const body = await response.text().catch(() => "")
      console.warn(`[pappers] ${endpoint} → ${response.status} ${response.statusText} body=${body.slice(0, 200)}`)
      return null
    }
    return await response.json()
  } catch (err) {
    console.warn(`[pappers] ${endpoint} → fetch error: ${String(err).slice(0, 200)}`)
    return null
  }
}

export interface RelatedCompany {
  name: string
  siren: string
  role: string
  domain?: string
  isEcommerce?: boolean
  codeNaf?: string
  formeJuridique?: string
  excluded?: boolean
  excludeReason?: string
}

// Company types to exclude (not ICP for ecommerce)
const EXCLUDED_PATTERNS = [
  /\bsci\b/i, /\bscpi\b/i, /\bholding\b/i, /\bimmobili[eè]re?\b/i,
  /\bfoncier[es]?\b/i, /\bgestion\b/i, /\bpatrimoine\b/i,
  /\bassociation\b/i, /\bfondation\b/i, /\bsyndicat\b/i,
  /\bcabinet\b/i, /\bnotaire\b/i, /\bavocat\b/i, /\bexpert.?comptable\b/i,
  /\bfiduciaire\b/i, /\baudit\b/i,
]

// NAF codes that are clearly NOT ecommerce
const EXCLUDED_NAF_PREFIXES = [
  "68", // Immobilier
  "64", // Services financiers (hors assurance)
  "65", // Assurance
  "66", // Activités auxiliaires financières
  "84", // Administration publique
  "94", // Activités des organisations associatives
]

function isExcludedCompany(name: string, codeNaf?: string, formeJuridique?: string): { excluded: boolean; reason?: string } {
  // Check name patterns
  for (const pattern of EXCLUDED_PATTERNS) {
    if (pattern.test(name)) {
      return { excluded: true, reason: `Nom contient "${name.match(pattern)?.[0]}"` }
    }
  }
  // Check NAF code
  if (codeNaf) {
    const prefix = codeNaf.slice(0, 2)
    if (EXCLUDED_NAF_PREFIXES.includes(prefix)) {
      return { excluded: true, reason: `NAF ${codeNaf} (${prefix}xx)` }
    }
  }
  // Check forme juridique
  if (formeJuridique) {
    const lower = formeJuridique.toLowerCase()
    if (lower.includes("sci") || lower.includes("holding") || lower.includes("association")) {
      return { excluded: true, reason: `Forme: ${formeJuridique}` }
    }
  }
  return { excluded: false }
}

// Exported fetch for use in orchestrator
export async function fetchPappersCompany(siren: string): Promise<any> {
  return pappersFetch<any>("/entreprise", { siren })
}

export interface PappersResult {
  raisonSociale: string | null
  parentCompanyName: string | null
  parentCompanySiren: string | null
  relatedCompanies: RelatedCompany[]
  apiCalls: number
}

// =============================================================================
// Recursive cartography BFS
// Calls /v2/entreprise/cartographie on the start company, then on each
// discovered company, until no new ones are found or limits are hit.
// =============================================================================

const MAX_CARTO_API_CALLS = 15
const MAX_CARTO_COMPANIES = 50

// Extract linked companies from a cartographie response
// The response structure may vary — handle multiple possible shapes
function extractLinkedCompanies(data: any): Array<{
  siren: string
  denomination: string
  codeNaf?: string
  formeJuridique?: string
  typeLien?: string
  cessee?: boolean
}> {
  const results: Array<{
    siren: string
    denomination: string
    codeNaf?: string
    formeJuridique?: string
    typeLien?: string
    cessee?: boolean
  }> = []

  // Try known response shapes
  const sources: any[][] = [
    data.entreprises_liees ?? [],
    data.filiales ?? [],
    data.participations ?? [],
    data.liens ?? [],
  ]

  // Also check nested "noeuds" (nodes) if present — graph-style response
  if (Array.isArray(data.noeuds)) {
    for (const noeud of data.noeuds) {
      if (noeud.entreprise) sources.push([noeud.entreprise])
      if (Array.isArray(noeud.entreprises)) sources.push(noeud.entreprises)
    }
  }

  for (const list of sources) {
    for (const ent of list) {
      const siren = ent.siren ?? ent.siren_entreprise
      if (!siren || typeof siren !== "string") continue
      results.push({
        siren,
        denomination: ent.denomination ?? ent.nom_entreprise ?? ent.nom ?? "Unknown",
        codeNaf: ent.code_naf ?? undefined,
        formeJuridique: ent.forme_juridique ?? undefined,
        typeLien: ent.type_lien ?? ent.type ?? undefined,
        cessee: ent.entreprise_cessee ?? ent.cessee ?? false,
      })
    }
  }

  return results
}

async function exploreGroupCartography(
  startSiren: string,
): Promise<{ companies: RelatedCompany[]; apiCalls: number }> {
  const seen = new Set<string>([startSiren])
  const queue: string[] = [startSiren]
  const allCompanies: RelatedCompany[] = []
  let apiCalls = 0

  while (queue.length > 0 && apiCalls < MAX_CARTO_API_CALLS && allCompanies.length < MAX_CARTO_COMPANIES) {
    const siren = queue.shift()!
    apiCalls++

    const data = await pappersFetch<any>("/entreprise/cartographie", { siren })
    if (!data) {
      console.log(`[carto:${siren}] no data (${apiCalls} calls)`)
      continue
    }

    const linked = extractLinkedCompanies(data)
    console.log(`[carto:${siren}] found ${linked.length} linked companies (call ${apiCalls})`)

    let newFound = 0
    for (const ent of linked) {
      if (seen.has(ent.siren)) continue
      if (ent.cessee) continue
      seen.add(ent.siren)

      const { excluded, reason } = isExcludedCompany(ent.denomination, ent.codeNaf, ent.formeJuridique)

      allCompanies.push({
        name: ent.denomination,
        siren: ent.siren,
        role: ent.typeLien ?? "Cartographie",
        codeNaf: ent.codeNaf,
        formeJuridique: ent.formeJuridique,
        excluded,
        excludeReason: reason,
      })

      // Only enqueue non-excluded companies for deeper exploration
      if (!excluded) {
        queue.push(ent.siren)
        newFound++
      }
    }

    console.log(`[carto:${siren}] +${newFound} new (total=${allCompanies.length}, queue=${queue.length})`)
  }

  console.log(`[carto] BFS done: ${allCompanies.length} companies, ${apiCalls} API calls`)
  return { companies: allCompanies, apiCalls }
}

// =============================================================================
// Main enrichment: try cartography BFS first, fallback to dirigeant search
// =============================================================================

export async function enrichWithPappers(siren: string): Promise<PappersResult> {
  const result: PappersResult = {
    raisonSociale: null,
    parentCompanyName: null,
    parentCompanySiren: null,
    relatedCompanies: [],
    apiCalls: 0,
  }

  const cleanSiren = siren.replace(/\D/g, "").slice(0, 9)
  if (cleanSiren.length !== 9) return result

  // Step 1: Get company details (always needed for group info + company fields)
  const company = await pappersFetch<any>("/entreprise", { siren: cleanSiren })
  result.apiCalls++
  if (!company) {
    console.log(`[pappers:${cleanSiren}] no company data returned`)
    return result
  }

  result.raisonSociale = company.denomination ?? company.nom_entreprise ?? null
  const availableFields = Object.keys(company).filter((k) => company[k] !== null && company[k] !== undefined)
  console.log(`[pappers:${cleanSiren}] company=${result.raisonSociale} fields=[${availableFields.join(",")}]`)

  if (company.groupe) {
    result.parentCompanyName = company.groupe.nom_tete_de_groupe ?? company.groupe.nom_groupe ?? null
    result.parentCompanySiren = company.groupe.siren_tete_de_groupe ?? null
    console.log(`[pappers:${cleanSiren}] groupe=${result.parentCompanyName} siren=${result.parentCompanySiren}`)
  }

  // Step 2: Recursive cartography BFS
  console.log(`[pappers:${cleanSiren}] starting cartography BFS`)
  const carto = await exploreGroupCartography(cleanSiren)
  result.apiCalls += carto.apiCalls

  if (carto.companies.length > 0) {
    result.relatedCompanies = carto.companies
    console.log(`[pappers:${cleanSiren}] cartography found ${carto.companies.length} companies in ${carto.apiCalls} calls`)
  } else {
    // Fallback: dirigeant search (cartography may not be available on all plans)
    console.log(`[pappers:${cleanSiren}] cartography returned 0 — falling back to dirigeant search`)
    result.relatedCompanies = await fallbackDirigeantSearch(cleanSiren, company)
  }

  // Log summary
  const relevant = result.relatedCompanies.filter((c) => !c.excluded)
  const excluded = result.relatedCompanies.filter((c) => c.excluded)
  console.log(`[pappers:${cleanSiren}] total=${result.relatedCompanies.length} relevant=${relevant.length} excluded=${excluded.length}`)
  for (const c of excluded.slice(0, 5)) {
    console.log(`[pappers:${cleanSiren}] excluded: ${c.name} (${c.excludeReason})`)
  }

  return result
}

// Legacy dirigeant-based search as fallback when cartography isn't available
async function fallbackDirigeantSearch(cleanSiren: string, company: any): Promise<RelatedCompany[]> {
  const relatedCompanies: RelatedCompany[] = []
  const seenSirens = new Set<string>([cleanSiren])

  const dirigeants = company.representants ?? company.dirigeants ?? []
  for (const dirigeant of dirigeants.slice(0, 3)) {
    const nom = dirigeant.nom ?? dirigeant.nom_complet
    const prenom = dirigeant.prenom
    if (!nom) continue

    const searchQuery = prenom ? `${prenom} ${nom}` : nom
    const searchResults = await pappersFetch<any>("/recherche-dirigeants", {
      q: searchQuery,
      par_page: "10",
    })
    if (!searchResults?.resultats) continue

    for (const match of searchResults.resultats) {
      for (const ent of match.entreprises ?? []) {
        const entSiren = ent.siren
        if (!entSiren || seenSirens.has(entSiren)) continue
        if (ent.entreprise_cessee) continue
        seenSirens.add(entSiren)

        const name = ent.denomination ?? ent.nom_entreprise ?? "Unknown"
        const { excluded, reason } = isExcludedCompany(name, ent.code_naf, ent.forme_juridique)

        relatedCompanies.push({
          name,
          siren: entSiren,
          role: match.qualite ?? dirigeant.qualite ?? "Dirigeant",
          codeNaf: ent.code_naf,
          formeJuridique: ent.forme_juridique,
          excluded,
          excludeReason: reason,
        })
      }
    }
  }

  const beneficiaires = company.beneficiaires_effectifs ?? []
  for (const benef of beneficiaires.slice(0, 3)) {
    const nom = benef.nom_complet ?? benef.nom
    if (!nom) continue

    const searchResults = await pappersFetch<any>("/recherche-dirigeants", {
      q: nom,
      par_page: "5",
    })
    if (!searchResults?.resultats) continue

    for (const match of searchResults.resultats) {
      for (const ent of match.entreprises ?? []) {
        const entSiren = ent.siren
        if (!entSiren || seenSirens.has(entSiren)) continue
        if (ent.entreprise_cessee) continue
        seenSirens.add(entSiren)

        const name = ent.denomination ?? ent.nom_entreprise ?? "Unknown"
        const { excluded, reason } = isExcludedCompany(name, ent.code_naf, ent.forme_juridique)

        relatedCompanies.push({
          name,
          siren: entSiren,
          role: `Bénéficiaire (${benef.pourcentage_parts ?? "?"}%)`,
          codeNaf: ent.code_naf,
          formeJuridique: ent.forme_juridique,
          excluded,
          excludeReason: reason,
        })
      }
    }
  }

  return relatedCompanies
}
