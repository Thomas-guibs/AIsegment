// Pappers API integration for French company data
// Free tier: 100 requests/day with API key
// Docs: https://api.pappers.fr

const PAPPERS_BASE = "https://api.pappers.fr/v2"

function getApiKey(): string | null {
  return process.env.PAPPERS_API_KEY ?? null
}

interface PappersCompany {
  siren: string
  nom_entreprise: string
  denomination: string | null
  sigle: string | null
  entreprise_cessee: boolean
  // Group info
  groupe?: {
    nom_groupe: string
    siren_tete_de_groupe: string | null
    nom_tete_de_groupe: string | null
  }
  // Subsidiaries (filiales)
  liste_etablissements?: Array<{
    siret: string
    siege: boolean
    denomination: string | null
    adresse_ligne_1: string
    code_postal: string
    ville: string
  }>
  // Related entities by ownership
  representants?: Array<{
    nom: string
    prenom: string
    qualite: string
  }>
  // Sometimes a "beneficiaires_effectifs" or owner list
  beneficiaires_effectifs?: Array<{
    nom_complet: string
    pourcentage_parts: number
  }>
}

export interface PappersResult {
  raisonSociale: string | null
  parentCompanyName: string | null
  parentCompanySiren: string | null
  subsidiaries: Array<{ name: string; siren: string }>
}

// Fetch Pappers data for a SIREN
export async function getCompanyBySiren(siren: string): Promise<PappersResult | null> {
  const key = getApiKey()
  if (!key) {
    console.warn("PAPPERS_API_KEY not configured")
    return null
  }

  const cleanSiren = siren.replace(/\D/g, "").slice(0, 9)
  if (cleanSiren.length !== 9) return null

  try {
    const url = `${PAPPERS_BASE}/entreprise?siren=${cleanSiren}&api_token=${key}`
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    })
    if (!response.ok) return null

    const data = (await response.json()) as PappersCompany

    return {
      raisonSociale: data.denomination ?? data.nom_entreprise ?? null,
      parentCompanyName: data.groupe?.nom_tete_de_groupe ?? null,
      parentCompanySiren: data.groupe?.siren_tete_de_groupe ?? null,
      subsidiaries: [], // Direct subsidiaries require a separate endpoint
    }
  } catch {
    return null
  }
}

// Fetch subsidiaries of a parent company
// Uses the "filiales" endpoint
export async function getSubsidiariesOfParent(parentSiren: string): Promise<Array<{ name: string; siren: string }>> {
  const key = getApiKey()
  if (!key) return []

  try {
    const url = `${PAPPERS_BASE}/entreprise?siren=${parentSiren}&api_token=${key}`
    const response = await fetch(url, { headers: { Accept: "application/json" } })
    if (!response.ok) return []

    const data = await response.json()
    // Pappers returns "filiales" or linked entities in different shapes depending on endpoint
    const filiales: Array<{ name: string; siren: string }> = []

    // Check for filiales array
    const arr = data.filiales ?? data.liste_filiales ?? []
    for (const f of arr) {
      if (f.siren && f.denomination) {
        filiales.push({ name: f.denomination, siren: f.siren })
      }
    }

    return filiales
  } catch {
    return []
  }
}

// Complete enrichment: get parent + siblings
export async function enrichWithPappers(siren: string): Promise<PappersResult> {
  const result: PappersResult = {
    raisonSociale: null,
    parentCompanyName: null,
    parentCompanySiren: null,
    subsidiaries: [],
  }

  const company = await getCompanyBySiren(siren)
  if (!company) return result

  result.raisonSociale = company.raisonSociale
  result.parentCompanyName = company.parentCompanyName
  result.parentCompanySiren = company.parentCompanySiren

  // If there's a parent, fetch its subsidiaries (siblings)
  if (result.parentCompanySiren) {
    const siblings = await getSubsidiariesOfParent(result.parentCompanySiren)
    // Exclude self
    result.subsidiaries = siblings.filter((s) => s.siren !== siren)
  }

  return result
}
