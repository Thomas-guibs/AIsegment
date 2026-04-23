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
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

export interface RelatedCompany {
  name: string
  siren: string
  role: string // "President", "Gérant", "Associé", etc.
  domain?: string
  isEcommerce?: boolean
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
  if (!company) return result

  result.raisonSociale = company.denomination ?? company.nom_entreprise ?? null

  // Check for group info
  if (company.groupe) {
    result.parentCompanyName = company.groupe.nom_tete_de_groupe ?? company.groupe.nom_groupe ?? null
    result.parentCompanySiren = company.groupe.siren_tete_de_groupe ?? null
  }

  // Step 2: Get dirigeants and find their other companies
  const dirigeants = company.representants ?? company.dirigeants ?? []
  const seenSirens = new Set<string>([cleanSiren])

  for (const dirigeant of dirigeants.slice(0, 3)) { // Limit to top 3 dirigeants
    const nom = dirigeant.nom ?? dirigeant.nom_complet
    const prenom = dirigeant.prenom
    if (!nom) continue

    // Search for other companies led by this person
    const searchQuery = prenom ? `${prenom} ${nom}` : nom
    const searchResults = await pappersFetch<any>("/recherche-dirigeants", {
      q: searchQuery,
      par_page: "10",
    })

    if (!searchResults?.resultats) continue

    for (const match of searchResults.resultats) {
      // Each result has an "entreprises" array
      const entreprises = match.entreprises ?? []
      for (const ent of entreprises) {
        const entSiren = ent.siren
        if (!entSiren || seenSirens.has(entSiren)) continue
        if (ent.entreprise_cessee) continue // Skip closed companies
        seenSirens.add(entSiren)

        result.relatedCompanies.push({
          name: ent.denomination ?? ent.nom_entreprise ?? "Unknown",
          siren: entSiren,
          role: match.qualite ?? dirigeant.qualite ?? "Dirigeant",
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

        result.relatedCompanies.push({
          name: ent.denomination ?? ent.nom_entreprise ?? "Unknown",
          siren: entSiren,
          role: `Bénéficiaire (${benef.pourcentage_parts ?? "?"}%)`,
        })
      }
    }
  }

  return result
}
