import type { UpsellSignals } from "../types"

// Compute upsell score 0-100 from enriched signals
// Pattern follows src/lib/scoring/health.ts

export interface UpsellScoreInput {
  nonClientSiblings: number
  storesCount: number
  languagesCount: number
  mrr: number
  plan: string | null
}

export interface UpsellScoreResult {
  total: number
  grade: "hot" | "warm" | "cold"
  breakdown: {
    siblings: number
    stores: number
    languages: number
    mrr: number
    plan: number
  }
}

function scoreSiblings(count: number): number {
  // 40 pts max, 10 pts per non-client sibling, capped at 40
  return Math.min(40, count * 10)
}

function scoreStores(count: number): number {
  if (count > 50) return 25
  if (count >= 10) return 15
  if (count >= 3) return 8
  return 0
}

function scoreLanguages(count: number): number {
  if (count > 3) return 20
  if (count >= 2) return 12
  return 0
}

function scoreMrr(mrr: number): number {
  if (mrr > 1000) return 10
  if (mrr >= 500) return 6
  if (mrr > 0) return 2
  return 0
}

function scorePlan(plan: string | null): number {
  // Enterprise already at top, Lite/Premium have upgrade room
  if (!plan || plan === "Enterprise") return 0
  return 5
}

export function computeUpsellScore(input: UpsellScoreInput): UpsellScoreResult {
  const breakdown = {
    siblings: scoreSiblings(input.nonClientSiblings),
    stores: scoreStores(input.storesCount),
    languages: scoreLanguages(input.languagesCount),
    mrr: scoreMrr(input.mrr),
    plan: scorePlan(input.plan),
  }

  const total = Math.min(
    100,
    breakdown.siblings + breakdown.stores + breakdown.languages + breakdown.mrr + breakdown.plan
  )

  const grade: "hot" | "warm" | "cold" = total > 70 ? "hot" : total >= 40 ? "warm" : "cold"

  return { total, grade, breakdown }
}

// Build the UpsellSignals object from raw enrichment + score
export function buildUpsellSignals(params: {
  parentCompany: string | null
  parentSiren: string | null
  siblingBrands: Array<{ name: string; siren: string; isClient: boolean; hubspotCompanyId?: string; isEcommerce?: boolean; role?: string; icpScore?: number; icpSignals?: string[]; excluded?: boolean; excludeReason?: string }>
  storesCount: number
  languages: string[]
  subsites: Array<{ lang: string; url: string }>
  mrr: number
  plan: string | null
}): UpsellSignals {
  const nonClientSiblings = params.siblingBrands.filter((s) => !s.isClient).length

  const score = computeUpsellScore({
    nonClientSiblings,
    storesCount: params.storesCount,
    languagesCount: params.languages.length,
    mrr: params.mrr,
    plan: params.plan,
  })

  return {
    parentCompany: params.parentCompany,
    parentSiren: params.parentSiren,
    siblingBrands: params.siblingBrands,
    storesCount: params.storesCount,
    languages: params.languages,
    subsites: params.subsites,
    enrichedAt: new Date().toISOString(),
    score: score.total,
    grade: score.grade,
  }
}
