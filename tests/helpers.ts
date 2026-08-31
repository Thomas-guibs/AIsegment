// Builders for the reference cases of spec §11, so a test reads like the spec.

import { buildTimeline, constantTimeline, type Timeline } from "@/lib/engine/timeline"
import type { Account, Movement, Snapshot } from "@/lib/engine/model"
import type { MovementType } from "@/lib/engine/config"

export function timeline<T>(versions: Array<[string, T]>): Timeline<T> {
  // Deliberately fed newest-first, the way HubSpot hands history back, so the
  // ascending re-sort of §2 is exercised on every build.
  const reversed = [...versions].reverse()
  return buildTimeline(
    reversed.map(([timestamp, value]) => ({ timestamp, value: String(value) })),
    (raw) => {
      if (typeof versions[0][1] === "number") {
        const n = Number(raw)
        return (Number.isFinite(n) ? n : undefined) as T | undefined
      }
      return (raw.length > 0 ? raw : undefined) as T | undefined
    }
  )
}

export function account(input: {
  id: string
  name: string
  mrr: number | Array<[string, number]>
  csm: string | Array<[string, string]>
  phase: string | Array<[string, string]>
  firstPaymentDate: string | null
}): Account {
  const mrr = Array.isArray(input.mrr)
    ? timeline(input.mrr)
    : constantTimeline(input.mrr)
  const csm = Array.isArray(input.csm) ? timeline(input.csm) : constantTimeline(input.csm)
  const phase = Array.isArray(input.phase)
    ? timeline(input.phase.map(([t, v]) => [t, v.toLowerCase()] as [string, string]))
    : constantTimeline(input.phase.toLowerCase())

  return {
    id: input.id,
    name: input.name,
    mrr,
    csm,
    phase,
    firstPaymentDate: input.firstPaymentDate,
    currentMrr: 0,
    currentCsm: null,
    currentPhase: null,
  }
}

export function movement(input: {
  id: string
  name?: string
  type: MovementType
  amount: number
  paymentDate?: string | null
  operationDate?: string | null
  eligibility?: boolean | null
  stage: string
  accountId: string
  dealOwnerId?: string | null
}): Movement {
  return {
    id: input.id,
    name: input.name ?? input.id,
    type: input.type,
    amount: Math.abs(input.amount),
    rawAmount: input.amount,
    paymentDate: input.paymentDate ?? null,
    operationDate: input.operationDate ?? null,
    eligibility: input.eligibility ?? null,
    stage: input.stage,
    dealOwnerId: input.dealOwnerId ?? null,
    accountId: input.accountId,
    accountName: null,
  }
}

export function snapshot(accounts: Account[], movements: Movement[]): Snapshot {
  return {
    capturedAt: "2026-08-31T00:00:00.000Z",
    accounts,
    movements,
    accountsById: new Map(accounts.map((a) => [a.id, a])),
  }
}
