export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextRequest, NextResponse } from "next/server"
import { qualifyCompany } from "@/lib/enrichment/claude"
import { fetchPappersCompany } from "@/lib/enrichment/pappers"

export async function GET(request: NextRequest) {
  const siren = request.nextUrl.searchParams.get("siren")
  const nameParam = request.nextUrl.searchParams.get("name")
  if (!siren) {
    return NextResponse.json({ error: "?siren= required (and optional &name=)" }, { status: 400 })
  }

  // Pull Pappers info first to give Claude full context (NAF + objet_social)
  const company = await fetchPappersCompany(siren).catch(() => null)
  const denomination = nameParam ?? company?.denomination ?? company?.nom_entreprise
  if (!denomination) {
    return NextResponse.json({ error: "no name found, pass &name=" }, { status: 400 })
  }

  const t0 = Date.now()
  const result = await qualifyCompany({
    denomination,
    siren,
    codeNaf: company?.code_naf ?? undefined,
    libelleNaf: company?.libelle_code_naf ?? undefined,
    objetSocial: company?.objet_social ?? undefined,
    formeJuridique: company?.forme_juridique ?? undefined,
  })
  const elapsed = Date.now() - t0

  return NextResponse.json({
    input: {
      denomination,
      siren,
      codeNaf: company?.code_naf ?? null,
      libelleNaf: company?.libelle_code_naf ?? null,
      objetSocial: company?.objet_social ?? null,
      formeJuridique: company?.forme_juridique ?? null,
    },
    result,
    elapsedMs: elapsed,
  })
}
