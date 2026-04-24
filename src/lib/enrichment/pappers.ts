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
}

// Get company info + dirigeants, then find their other companies
export async function enrichWithPappers(siren: string): Promise<PappersResult> {
  const result: PappersResult = {
    raisonSociale: null,
    parentCompanyName: null,
    parentCompanySiren: null,
    relatedCompanies: [],
  }

  const cleanSiren = siren.replace(/\D/g, "").slice(0, 9)
  if (cleanSiren.length !== 9) return result

  // Step 1: Get company details + dirigeants
  const company = await pappersFetch<any>("/entreprise", {
    siren: cleanSiren,
  })
  if (!company) {
    console.log(`[pappers:${cleanSiren}] no company data returned`)
    return result
  }

  result.raisonSociale = company.denomination ?? company.nom_entreprise ?? null

  // Log available fields for debugging
  const availableFields = Object.keys(company).filter(k => company[k] !== null && company[k] !== undefined)
  console.log(`[pappers:${cleanSiren}] company=${result.raisonSociale} fields=[${availableFields.join(",")}]`)

  // Check for group info
  if (company.groupe) {
    result.parentCompanyName = company.groupe.nom_tete_de_groupe ?? company.groupe.nom_groupe ?? null
    result.parentCompanySiren = company.groupe.siren_tete_de_groupe ?? null
    console.log(`[pappers:${cleanSiren}] groupe=${result.parentCompanyName} siren=${result.parentCompanySiren}`)
  }

  // Step 2: Get dirigeants and find their other companies
  const dirigeants = company.representants ?? company.dirigeants ?? []
  console.log(`[pappers:${cleanSiren}] dirigeants=${dirigeants.length} (field: ${company.representants ? "representants" : company.dirigeants ? "dirigeants" : "none"})`)

  const seenSirens = new Set<string>([cleanSiren])

  for (const dirigeant of dirigeants.slice(0, 3)) {
    const nom = dirigeant.nom ?? dirigeant.nom_complet
    const prenom = dirigeant.prenom
    console.log(`[pappers:${cleanSiren}] dirigeant: ${prenom ?? ""} ${nom ?? "?"} qualite=${dirigeant.qualite ?? "?"}`)
    if (!nom) continue

    // Search for other companies led by this person
    const searchQuery = prenom ? `${prenom} ${nom}` : nom
    const searchResults = await pappersFetch<any>("/recherche-dirigeants", {
      q: searchQuery,
      par_page: "10",
    })

    console.log(`[pappers:${cleanSiren}] search "${searchQuery}" → ${searchResults ? Object.keys(searchResults).join(",") : "NULL"} resultats=${searchResults?.resultats?.length ?? 0}`)

    if (!searchResults?.resultats) continue

    for (const match of searchResults.resultats) {
      const entreprises = match.entreprises ?? []
      for (const ent of entreprises) {
        const entSiren = ent.siren
        if (!entSiren || seenSirens.has(entSiren)) continue
        if (ent.entreprise_cessee) continue
        seenSirens.add(entSiren)

        const name = ent.denomination ?? ent.nom_entreprise ?? "Unknown"
        const codeNaf = ent.code_naf ?? undefined
        const formeJuridique = ent.forme_juridique ?? undefined
        const domainFromPappers = ent.domaine_activite ?? undefined

        const { excluded, reason } = isExcludedCompany(name, codeNaf, formeJuridique)

        result.relatedCompanies.push({
          name,
          siren: entSiren,
          role: match.qualite ?? dirigeant.qualite ?? "Dirigeant",
          codeNaf,
          formeJuridique,
          excluded,
          excludeReason: reason,
        })
      }
    }
  }

  // Step 3: Also check beneficiaires effectifs for additional links
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
      const entreprises = match.entreprises ?? []
      for (const ent of entreprises) {
        const entSiren = ent.siren
        if (!entSiren || seenSirens.has(entSiren)) continue
        if (ent.entreprise_cessee) continue
        seenSirens.add(entSiren)

        const name = ent.denomination ?? ent.nom_entreprise ?? "Unknown"
        const { excluded, reason } = isExcludedCompany(name, ent.code_naf, ent.forme_juridique)

        result.relatedCompanies.push({
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

  // Log summary
  const relevant = result.relatedCompanies.filter((c) => !c.excluded)
  const excluded = result.relatedCompanies.filter((c) => c.excluded)
  console.log(`[pappers:${cleanSiren}] total=${result.relatedCompanies.length} relevant=${relevant.length} excluded=${excluded.length}`)
  for (const c of excluded.slice(0, 5)) {
    console.log(`[pappers:${cleanSiren}] excluded: ${c.name} (${c.excludeReason})`)
  }

  return result
}
