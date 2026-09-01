export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"

const PAPPERS_BASE = "https://api.pappers.fr/v2"

export async function GET(request: NextRequest) {
  const siren = request.nextUrl.searchParams.get("siren")
  if (!siren) return NextResponse.json({ error: "?siren= required" }, { status: 400 })

  const key = process.env.PAPPERS_API_KEY
  if (!key) return NextResponse.json({ error: "PAPPERS_API_KEY not set" }, { status: 500 })

  const url = new URL(`${PAPPERS_BASE}/entreprise`)
  url.searchParams.set("api_token", key)
  url.searchParams.set("siren", siren.replace(/\D/g, "").slice(0, 9))

  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    return NextResponse.json({ error: res.status, body: body.slice(0, 500) }, { status: res.status })
  }

  const data = await res.json()

  // Also fetch cartographie for this SIREN
  const cartoUrl = new URL(`${PAPPERS_BASE}/entreprise/cartographie`)
  cartoUrl.searchParams.set("api_token", key)
  cartoUrl.searchParams.set("siren", siren.replace(/\D/g, "").slice(0, 9))

  let carto = null
  try {
    const cartoRes = await fetch(cartoUrl.toString(), { headers: { Accept: "application/json" } })
    if (cartoRes.ok) {
      carto = await cartoRes.json()
    } else {
      carto = { error: cartoRes.status, body: (await cartoRes.text().catch(() => "")).slice(0, 300) }
    }
  } catch (e) {
    carto = { error: String(e).slice(0, 200) }
  }

  // Inspect etablissements for enseigne / nom_commercial
  const etabSample = Array.isArray(data.etablissements)
    ? data.etablissements.slice(0, 5).map((e: any) => ({
        siret: e.siret ?? null,
        siege: e.siege ?? null,
        enseigne: e.enseigne ?? null,
        nom_commercial: e.nom_commercial ?? null,
        etablissement_employeur: e.etablissement_employeur ?? null,
        all_keys: Object.keys(e),
      }))
    : null

  return NextResponse.json({
    entreprise: {
      siren: data.siren,
      denomination: data.denomination ?? null,
      nom_commercial: data.nom_commercial ?? null,
      nom_entreprise: data.nom_entreprise ?? null,
      sigle: data.sigle ?? null,
      site_web: data.site_web ?? null,
      noms_de_domaine: data.noms_de_domaine ?? null,
      enseignes: data.enseignes ?? null,
      code_naf: data.code_naf ?? null,
      libelle_code_naf: data.libelle_code_naf ?? null,
      forme_juridique: data.forme_juridique ?? null,
      objet_social: data.objet_social?.slice(0, 300) ?? null,
      etablissements_count: Array.isArray(data.etablissements) ? data.etablissements.length : 0,
      etablissements_sample: etabSample,
      all_keys: Object.keys(data).sort(),
    },
    cartographie: carto,
  })
}
