// =============================================================================
// Portfolio analytics — MRR sous gestion, attribution CSM, NRR
//
// Règle métier (Loyoly, sept. 2026) — remplace la lecture de `total_revenue`
// prévue par CALCUL.md §3.3, parce que ce champ HubSpot n'intègre pas les
// downsells :
//
//   MRR(company, T) = Σ amount (signé) des transactions gagnées
//                     (Closed Won + Paiement reçu) dont la date effective < T
//
//   Un compte entre dans le MRR sous gestion à T si :
//     1. un CSM est connu à T (historique point-in-time, spec §2 / §5)
//     2. (filtre optionnel) ce CSM est dans le périmètre demandé
//     3. sa phase_du_client à T ∈ {Onboarding, Activated, Run, Parent company}
//     4. au moins une transaction rattachée porte une date_de_paiement < T
//        (la date_de_paiement de la company n'est pas fiable)
//     5. son MRR à T est strictement positif
//
// `amount` porte le delta de MRR (négatif pour churn / downsell, spec §5),
// donc la somme signée donne directement le MRR net — sans recourir à
// hs_mrr ni à total_revenue.
//
// Le point-in-time (spec §2) reste appliqué sur CSM et phase :
// fetchCompanyHistoryBatch backfille l'historique à hs_createdate quand il
// ne remonte pas assez loin (spec §12 backfill_history).
// =============================================================================

import type { Deal } from "../types"
import type { CompanyHistory } from "../hubspot/history"
import { valueAt } from "../hubspot/history"
import { MRR_PHASES, SALES_STAGES, movementDate } from "../constants"

// ISO for the 1st of a month at 00:00 UTC (spec §3 observation instant)
export function firstOfMonthUTC(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0)).toISOString()
}

// Month key "YYYY-MM" from an ISO timestamp (UTC).
export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7)
}

// Group deals by companyId.
export function dealsByCompany(deals: Deal[]): Map<string, Deal[]> {
  const map = new Map<string, Deal[]>()
  for (const d of deals) {
    if (!d.companyId) continue
    const arr = map.get(d.companyId) ?? []
    arr.push(d)
    map.set(d.companyId, arr)
  }
  return map
}

// Stages « gagnés » dont le montant compte dans le MRR d'un compte.
export const WON_STAGES = new Set<string>([SALES_STAGES.CLOSED_WON, SALES_STAGES.PAIEMENT_RECU])

// Date effective d'une transaction gagnée : date de paiement, sinon date de
// prise en compte, sinon date de clôture HubSpot.
export function wonDealEffectiveDate(d: Deal): string | null {
  return d.paymentDate ?? d.operationDate ?? d.closeDate ?? null
}

// Le compte est-il facturé à T ? Au moins une transaction rattachée porte
// une date_de_paiement antérieure à T. (La date_de_paiement de la company
// n'est pas fiable — celle des transactions fait foi.)
export function hasPaymentBefore(deals: Deal[], t: string): boolean {
  const tDate = t.slice(0, 10)
  return deals.some((d) => d.paymentDate && d.paymentDate.slice(0, 10) < tDate)
}

// Σ amount signé des transactions gagnées (Closed Won + Paiement reçu)
// effectives avant T. Les transactions gagnées mais pas encore passées en
// Paiement reçu comptent — c'est du MRR contractualisé — et sont listées à
// part (unpaidDealIds) pour la transparence.
export function wonMrrAt(
  deals: Deal[],
  t: string
): { mrr: number; dealIds: string[]; unpaidDealIds: string[]; unpaidMrr: number } {
  const tDate = t.slice(0, 10)
  let mrr = 0
  let unpaidMrr = 0
  const dealIds: string[] = []
  const unpaidDealIds: string[] = []
  for (const d of deals) {
    if (!WON_STAGES.has(d.stage)) continue
    if (!d.amount) continue
    const date = wonDealEffectiveDate(d)
    if (!date || date.slice(0, 10) >= tDate) continue
    mrr += d.amount
    dealIds.push(d.id)
    if (!d.paymentDate) {
      unpaidMrr += d.amount
      unpaidDealIds.push(d.id)
    }
  }
  return { mrr, dealIds, unpaidDealIds, unpaidMrr }
}

export interface MrrContribution {
  companyId: string
  companyName: string
  mrr: number
  csm: string
  dealIds: string[]
  unpaidDealIds: string[]
  unpaidMrr: number
}

// -----------------------------------------------------------------------------
// Diagnostics — spec §9 "rien ne doit disparaître en silence".
// -----------------------------------------------------------------------------

export interface Diagnostics {
  excludedNoCsm: string[]        // condition 1 — aucun CSM connu à T
  excludedPhase: string[]        // condition 3 — phase hors périmètre à T
  excludedNoPayment: string[]    // condition 4 — aucune transaction avec date_de_paiement < T
  excludedZeroMrr: string[]      // condition 5 — Σ transactions gagnées ≤ 0 à T
  accountsNoWonDeals: string[]   // phase OK mais aucune transaction gagnée rattachée
  accountsWithUnpaidWon: string[] // retenus avec du Closed Won pas encore payé
  accountsInvisibleTruncatedHistory: string[]  // CSM pris sur le 1er historique (spec §2)
}

export function newDiagnostics(): Diagnostics {
  return {
    excludedNoCsm: [],
    excludedPhase: [],
    excludedNoPayment: [],
    excludedZeroMrr: [],
    accountsNoWonDeals: [],
    accountsWithUnpaidWon: [],
    accountsInvisibleTruncatedHistory: [],
  }
}

// MRR sous gestion à l'instant T.
//   companies     — historiques point-in-time (CSM, phase)
//   wonByCompany  — transactions gagnées (Closed Won + Paiement reçu) par companyId
export function mrrUnderManagement(
  companies: CompanyHistory[],
  wonByCompany: Map<string, Deal[]>,
  t: string,
  csmFilter?: string,
  diagnostics?: Diagnostics
): MrrContribution[] {
  const out: MrrContribution[] = []
  for (const c of companies) {
    // 1. CSM connu à T — repli sur le premier CSM jamais enregistré (spec §5)
    let csm = valueAt(c.csm, t) ?? null
    if (!csm && c.csm.length > 0) {
      csm = c.csm[0].value
      if (c.csm[0].timestamp > t) diagnostics?.accountsInvisibleTruncatedHistory.push(c.id)
    }
    if (!csm) {
      diagnostics?.excludedNoCsm.push(c.id)
      continue
    }
    // 2. CSM dans le périmètre
    if (csmFilter && csm !== csmFilter) continue
    // 3. Phase client à T
    const phase = valueAt(c.phase, t) ?? (c.phase.length > 0 ? c.phase[0].value : null)
    if (!phase || !MRR_PHASES.includes(phase)) {
      diagnostics?.excludedPhase.push(c.id)
      continue
    }
    // 4. Facturé à T — au moins une transaction avec date_de_paiement < T
    const won = wonByCompany.get(c.id) ?? []
    if (!hasPaymentBefore(won, t)) {
      diagnostics?.excludedNoPayment.push(c.id)
      if (won.length === 0) diagnostics?.accountsNoWonDeals.push(c.id)
      continue
    }
    // 5. MRR = Σ transactions gagnées effectives < T
    const { mrr, dealIds, unpaidDealIds, unpaidMrr } = wonMrrAt(won, t)
    if (mrr <= 0) {
      diagnostics?.excludedZeroMrr.push(c.id)
      continue
    }
    if (unpaidDealIds.length > 0) diagnostics?.accountsWithUnpaidWon.push(c.id)
    out.push({ companyId: c.id, companyName: c.name, mrr, csm, dealIds, unpaidDealIds, unpaidMrr })
  }
  return out
}

// Somme du MRR sous gestion par CSM à T.
export function mrrUnderManagementByCsm(
  companies: CompanyHistory[],
  wonByCompany: Map<string, Deal[]>,
  t: string
): Map<string, number> {
  const out = new Map<string, number>()
  for (const c of mrrUnderManagement(companies, wonByCompany, t)) {
    out.set(c.csm, (out.get(c.csm) ?? 0) + c.mrr)
  }
  return out
}

// Spec §5 attribution par défaut : `owner_at_month_start` — le CSM
// propriétaire du compte au 1er du mois du mouvement.
// Replis : premier CSM jamais enregistré → propriétaire du deal → null.
export function ownerAtMonthStart(
  deal: Deal,
  companyHistory: CompanyHistory | undefined,
  refDateOverride?: string | null
): string | null {
  const refDate = refDateOverride ?? movementDate(deal)
  if (!refDate) return deal.ownerId ?? null
  const d = new Date(refDate)
  const t = firstOfMonthUTC(d.getUTCFullYear(), d.getUTCMonth() + 1)

  if (companyHistory) {
    const owner = valueAt(companyHistory.csm, t)
    if (owner) return owner
    if (companyHistory.csm.length > 0) return companyHistory.csm[0].value
  }
  return deal.ownerId ?? null
}

// Spec §6 : NRR mensuel. Non calculable si MRR_début ≤ 0 → null.
export function monthlyNrr(startingMrr: number, upsell: number, churn: number, downsell: number): number | null {
  if (startingMrr <= 0) return null
  return ((startingMrr + upsell - churn - downsell) / startingMrr) * 100
}

// Spec §6 : NRR trimestriel `weighted`
//   (Σ MRR_début + Σ net) / Σ MRR_début   sur les mois où MRR_début > 0
export function weightedQuarterlyNrr(
  months: Array<{ startingMrr: number; upsell: number; churn: number; downsell: number }>
): number | null {
  const eligible = months.filter((m) => m.startingMrr > 0)
  if (eligible.length === 0) return null
  const totalStart = eligible.reduce((s, m) => s + m.startingMrr, 0)
  const totalNet = eligible.reduce((s, m) => s + m.upsell - m.churn - m.downsell, 0)
  return ((totalStart + totalNet) / totalStart) * 100
}
