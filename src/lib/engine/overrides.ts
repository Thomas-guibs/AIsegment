// =============================================================================
// Manual corrections (spec §10)
//
// A wrong entry is fixed in the CRM, but a quarter is paid on a date. Hence an
// override layer indexed by deal id, carrying a retained amount and/or a
// retained attribution.
//
// Three guard rails, because this is about remuneration:
//   - a reason is mandatory — an unexplained correction is refused at load
//     time, not silently ignored;
//   - the original value is kept and displayed next to the retained one, with
//     its author;
//   - an override aiming at no existing deal is reported, instead of letting
//     anyone believe it applied.
//
// The CRM stays the source of truth: fix it in HubSpot, then drop the override.
// =============================================================================

import type { Snapshot } from "./model"

export interface DealOverride {
  dealId: string
  /** Retained amount, replacing `amount`. Absolute value is taken. */
  amount?: number
  /** Retained CSM, replacing the computed attribution. */
  csmId?: string
  /** Mandatory. An override without one is rejected. */
  reason: string
  /** Who decided it. */
  author: string
  /** When it was recorded, ISO-8601. */
  recordedAt?: string
}

export interface LoadedOverride extends DealOverride {
  /** Original values, kept for display alongside the retained ones. */
  originalAmount: number | null
  originalCsmId: string | null
  dealName: string | null
}

export interface OverrideLoadResult {
  /** Overrides that apply, indexed by deal id. */
  applied: Map<string, DealOverride>
  /** Loaded overrides with their original values, for the audit view. */
  details: LoadedOverride[]
  /** Refused at load: no reason, or no author. */
  refused: Array<{ override: Partial<DealOverride>; problem: string }>
  /** Aiming at a deal that does not exist in the snapshot. */
  orphaned: DealOverride[]
}

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0
}

/**
 * Validate a list of overrides against a snapshot.
 * Nothing is applied silently: everything refused or orphaned comes back in the
 * result so the caller can surface it.
 */
export function loadOverrides(
  raw: Array<Partial<DealOverride>>,
  snapshot: Snapshot
): OverrideLoadResult {
  const applied = new Map<string, DealOverride>()
  const details: LoadedOverride[] = []
  const refused: OverrideLoadResult["refused"] = []
  const orphaned: DealOverride[] = []

  const movementsById = new Map(snapshot.movements.map((m) => [m.id, m]))

  for (const candidate of raw) {
    if (isBlank(candidate.dealId)) {
      refused.push({ override: candidate, problem: "identifiant de deal manquant" })
      continue
    }
    // A correction without an explanation is refused, not ignored.
    if (isBlank(candidate.reason)) {
      refused.push({ override: candidate, problem: "motif obligatoire manquant" })
      continue
    }
    if (isBlank(candidate.author)) {
      refused.push({ override: candidate, problem: "auteur obligatoire manquant" })
      continue
    }
    if (candidate.amount == null && isBlank(candidate.csmId)) {
      refused.push({ override: candidate, problem: "ne retient ni montant ni attribution" })
      continue
    }
    if (candidate.amount != null && !Number.isFinite(candidate.amount)) {
      refused.push({ override: candidate, problem: "montant retenu invalide" })
      continue
    }

    const override: DealOverride = {
      dealId: candidate.dealId as string,
      reason: (candidate.reason as string).trim(),
      author: (candidate.author as string).trim(),
      ...(candidate.amount != null ? { amount: candidate.amount } : {}),
      ...(!isBlank(candidate.csmId) ? { csmId: (candidate.csmId as string).trim() } : {}),
      ...(candidate.recordedAt ? { recordedAt: candidate.recordedAt } : {}),
    }

    const movement = movementsById.get(override.dealId)
    if (!movement) {
      // Reported rather than applied to nothing.
      orphaned.push(override)
      continue
    }

    applied.set(override.dealId, override)
    details.push({
      ...override,
      originalAmount: movement.amount,
      originalCsmId: movement.dealOwnerId,
      dealName: movement.name,
    })
  }

  return { applied, details, refused, orphaned }
}

/**
 * Overrides configured for this deployment. Empty by default — corrections are
 * exceptional and each one should be a deliberate, reviewed commit.
 */
export const CONFIGURED_OVERRIDES: Array<Partial<DealOverride>> = []
