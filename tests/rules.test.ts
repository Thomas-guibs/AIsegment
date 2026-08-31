// =============================================================================
// The rules that the reference cases do not exercise, and the HubSpot traps
// of §8 that would fail silently.
// =============================================================================

import { describe, it, expect } from "vitest"
import { buildTimeline, valueAt, isTruncatedAt } from "@/lib/engine/timeline"
import { computeMetrics } from "@/lib/engine"
import { aggregateNrr, computeMonthly } from "@/lib/engine/metrics"
import { loadOverrides } from "@/lib/engine/overrides"
import { STAGE_CHURN_DOWNSELL, STAGE_CLOSED_WON, STAGE_PAIEMENT_RECU } from "@/lib/engine/config"
import { account, movement, snapshot } from "./helpers"

const CSM_A = "75406611"
const CSM_B = "1331556319"

describe("§2 point-in-time reading", () => {
  // HubSpot renders history newest-first. Fed in that order, a naive reader
  // always answers with the latest value.
  const raw = [
    { value: "300", timestamp: "2026-06-01T00:00:00Z" },
    { value: "200", timestamp: "2026-03-01T00:00:00Z" },
    { value: "100", timestamp: "2026-01-01T00:00:00Z" },
  ]

  it("re-sorts ascending and answers with the version in force", () => {
    const t = buildTimeline(raw, (v) => Number(v))
    expect(valueAt(t, "2026-02-01T00:00:00Z")).toBe(100)
    expect(valueAt(t, "2026-04-01T00:00:00Z")).toBe(200)
    expect(valueAt(t, "2026-08-01T00:00:00Z")).toBe(300)
  })

  it("returns undefined before the history starts, and flags the truncation", () => {
    const t = buildTimeline(raw, (v) => Number(v))
    expect(valueAt(t, "2025-12-01T00:00:00Z")).toBeUndefined()
    expect(isTruncatedAt(t, "2025-12-01T00:00:00Z")).toBe(true)
    expect(isTruncatedAt(t, "2026-04-01T00:00:00Z")).toBe(false)
  })

  it("backfill carries the oldest known value back to the origin", () => {
    const t = buildTimeline(raw, (v) => Number(v), { backfill: true })
    expect(valueAt(t, "2025-12-01T00:00:00Z")).toBe(100)
    expect(isTruncatedAt(t, "2025-12-01T00:00:00Z")).toBe(false)
  })
})

describe("§3 the five conditions of the MRR under management", () => {
  const base = {
    mrr: 1000,
    csm: CSM_A,
    phase: "Run",
    firstPaymentDate: "2025-01-01",
  }

  async function startingMrrOf(acc: ReturnType<typeof account>) {
    const result = await computeMetrics({
      snapshot: snapshot([acc], []),
      months: ["2026-05"],
      csmIds: [CSM_A],
    })
    return result.perCsm[0].months[0].startingMrr
  }

  it("counts an account meeting all five", async () => {
    expect(await startingMrrOf(account({ id: "a", name: "A", ...base }))).toBe(1000)
  })

  it("excludes a zero MRR (condition 3)", async () => {
    expect(await startingMrrOf(account({ id: "a", name: "A", ...base, mrr: 0 }))).toBe(0)
  })

  it("excludes a client first billed during the month (condition 4)", async () => {
    // Reading at the 1st at 00:00 UTC excludes clients signed within the month.
    expect(
      await startingMrrOf(account({ id: "a", name: "A", ...base, firstPaymentDate: "2026-05-15" }))
    ).toBe(0)
  })

  it("excludes a client never billed, and reports it (condition 4)", async () => {
    const result = await computeMetrics({
      snapshot: snapshot([account({ id: "a", name: "A", ...base, firstPaymentDate: null })], []),
      months: ["2026-05"],
      csmIds: [CSM_A],
    })
    expect(result.perCsm[0].months[0].startingMrr).toBe(0)
    expect(result.diagnostics.neverBilled).toHaveLength(1)
    expect(result.diagnostics.neverBilled[0].mrr).toBe(1000)
  })

  it("follows a CSM change point-in-time, not the current owner", async () => {
    const moved = account({
      id: "a",
      name: "A",
      mrr: 1000,
      csm: [
        ["2025-01-01T00:00:00Z", CSM_A],
        ["2026-04-15T00:00:00Z", CSM_B],
      ],
      phase: "Run",
      firstPaymentDate: "2025-01-01",
    })

    const result = await computeMetrics({
      snapshot: snapshot([moved], []),
      months: ["2026-03", "2026-05"],
      csmIds: [CSM_A, CSM_B],
    })
    const a = result.perCsm.find((c) => c.csmId === CSM_A)!
    const b = result.perCsm.find((c) => c.csmId === CSM_B)!

    expect(a.months[0].startingMrr).toBe(1000) // March: still A's
    expect(a.months[1].startingMrr).toBe(0)    // May: handed over
    expect(b.months[0].startingMrr).toBe(0)
    expect(b.months[1].startingMrr).toBe(1000)
  })
})

describe("§4 ghost MRR — total_revenue is never reset", () => {
  it("drops an account whose phase says churn, even with no churn deal", async () => {
    const ghost = account({
      id: "ghost",
      name: "Ghost",
      mrr: 500,
      csm: CSM_A,
      phase: [
        ["2025-01-01T00:00:00Z", "Run"],
        ["2026-02-10T00:00:00Z", "churn"],
      ],
      firstPaymentDate: "2025-01-01",
    })

    const result = await computeMetrics({
      snapshot: snapshot([ghost], []),
      months: ["2026-01", "2026-03"],
      csmIds: [CSM_A],
    })
    expect(result.perCsm[0].months[0].startingMrr).toBe(500)
    expect(result.perCsm[0].months[1].startingMrr).toBe(0)

    // Exited on the phase alone: the NRR never booked the loss, the churn deal
    // is missing from the CRM. That is exactly what §9 asks us to surface.
    const exits = result.diagnostics.churnExits
    expect(exits).toHaveLength(1)
    expect(exits[0].via).toBe("phase")
    expect(result.diagnostics.summary.churnExitsWithoutDealCount).toBe(1)
  })

  it("a churn that is not counted does not evict the account either", async () => {
    // A churn left out of the NRR must not strip the MRR either, otherwise the
    // loss would vanish without ever being counted. Eligibility no longer
    // excludes anything, so the remaining way out is an out-of-scope stage.
    const acc = account({
      id: "a",
      name: "A",
      mrr: 400,
      csm: CSM_A,
      phase: "Run",
      firstPaymentDate: "2025-01-01",
    })
    const negotiating = movement({
      id: "m",
      type: "churn",
      amount: -400,
      operationDate: "2026-02-10",
      stage: "qualifiedtobuy", // still being discussed, not a booked loss
      accountId: "a",
    })

    const notYet = await computeMetrics({
      snapshot: snapshot([acc], [negotiating]),
      months: ["2026-03"],
      csmIds: [CSM_A],
    })
    expect(notYet.perCsm[0].months[0].startingMrr).toBe(400)

    const booked = await computeMetrics({
      snapshot: snapshot([acc], [{ ...negotiating, stage: STAGE_CHURN_DOWNSELL }]),
      months: ["2026-03"],
      csmIds: [CSM_A],
    })
    expect(booked.perCsm[0].months[0].startingMrr).toBe(0)
  })
})

describe("§5 movement pipeline", () => {
  const acc = account({
    id: "a",
    name: "A",
    mrr: 1000,
    csm: CSM_A,
    phase: "Run",
    firstPaymentDate: "2025-01-01",
  })

  it("dates an upsell by its payment, a churn by its operation date", async () => {
    const upsell = movement({
      id: "u",
      type: "upsell",
      amount: 100,
      paymentDate: "2026-05-20",
      operationDate: "2026-04-01", // must be ignored for an upsell
      stage: STAGE_CLOSED_WON,
      accountId: "a",
    })
    const result = await computeMetrics({
      snapshot: snapshot([acc], [upsell]),
      months: ["2026-04", "2026-05"],
      csmIds: [CSM_A],
    })
    expect(result.perCsm[0].months[0].upsell).toBe(0)
    expect(result.perCsm[0].months[1].upsell).toBe(100)
  })

  it("keeps 'Churn & Downsell' — removing it would let almost no churn through", async () => {
    const churn = movement({
      id: "c",
      type: "churn",
      amount: -200,
      operationDate: "2026-05-10",
      eligibility: true,
      stage: STAGE_CHURN_DOWNSELL,
      accountId: "a",
    })

    const kept = await computeMetrics({
      snapshot: snapshot([acc], [churn]),
      months: ["2026-05"],
      csmIds: [CSM_A],
    })
    expect(kept.perCsm[0].months[0].churn).toBe(200)

    const dropped = await computeMetrics({
      snapshot: snapshot([acc], [churn]),
      months: ["2026-05"],
      csmIds: [CSM_A],
      config: { allowedStages: { churn: [STAGE_PAIEMENT_RECU], downsell: [], upsell: [] } },
    })
    // NRR climbs back to a false 100 % — the trap of §8.
    expect(dropped.perCsm[0].months[0].churn).toBe(0)
    expect(dropped.perCsm[0].months[0].nrr).toBe(100)
  })

  it("takes abs(amount), never hs_mrr", async () => {
    const downsell = movement({
      id: "d",
      type: "downsell",
      amount: -75.5,
      operationDate: "2026-05-10",
      eligibility: true,
      stage: STAGE_CHURN_DOWNSELL,
      accountId: "a",
    })
    const result = await computeMetrics({
      snapshot: snapshot([acc], [downsell]),
      months: ["2026-05"],
      csmIds: [CSM_A],
    })
    expect(result.perCsm[0].months[0].downsell).toBe(75.5)
  })

  it("separates out-of-scope stages from data-entry anomalies", async () => {
    const negotiating = movement({
      id: "n",
      type: "upsell",
      amount: 100,
      paymentDate: "2026-05-01",
      stage: "qualifiedtobuy", // still being negotiated
      accountId: "a",
    })
    const undated = movement({
      id: "x",
      type: "upsell",
      amount: 100,
      paymentDate: null,
      stage: STAGE_CLOSED_WON,
      accountId: "a",
    })

    const result = await computeMetrics({
      snapshot: snapshot([acc], [negotiating, undated]),
      months: ["2026-05"],
      csmIds: [CSM_A],
    })
    expect(result.diagnostics.outOfScopeByStage).toHaveLength(1)
    expect(result.diagnostics.outOfScopeByStage[0].count).toBe(1)
    expect(result.diagnostics.summary.anomalyCount).toBe(1)
    expect(result.diagnostics.rejectedByReason[0].reason).toBe("missing_reference_date")
  })

  it("counts every deal whatever its eligibility", async () => {
    // Most churns in this CRM carry no eligibility at all. Filtering on it
    // dropped the majority of the churn and inflated NRR, so it filters nothing.
    const cases: Array<boolean | null> = [true, false, null]
    for (const eligibility of cases) {
      const result = await computeMetrics({
        snapshot: snapshot(
          [acc],
          [
            movement({
              id: "u",
              type: "upsell",
              amount: 100,
              paymentDate: "2026-05-20",
              eligibility,
              stage: STAGE_CLOSED_WON,
              accountId: "a",
            }),
            movement({
              id: "c",
              type: "churn",
              amount: -50,
              operationDate: "2026-05-20",
              eligibility,
              stage: STAGE_CHURN_DOWNSELL,
              accountId: "a",
            }),
          ]
        ),
        months: ["2026-05"],
        csmIds: [CSM_A],
      })
      expect(result.perCsm[0].months[0].upsell).toBe(100)
      expect(result.perCsm[0].months[0].churn).toBe(50)
      expect(result.diagnostics.summary.anomalyCount).toBe(0)
    }
  })

  it("attributes to the owner at month start, not the deal owner", async () => {
    const moved = account({
      id: "a",
      name: "A",
      mrr: 1000,
      csm: [
        ["2025-01-01T00:00:00Z", CSM_A],
        ["2026-05-20T00:00:00Z", CSM_B],
      ],
      phase: "Run",
      firstPaymentDate: "2025-01-01",
    })
    const upsell = movement({
      id: "u",
      type: "upsell",
      amount: 100,
      paymentDate: "2026-05-25",
      stage: STAGE_CLOSED_WON,
      accountId: "a",
      dealOwnerId: CSM_B,
    })

    const atStart = await computeMetrics({
      snapshot: snapshot([moved], [upsell]),
      months: ["2026-05"],
      csmIds: [CSM_A, CSM_B],
    })
    expect(atStart.perCsm.find((c) => c.csmId === CSM_A)!.months[0].upsell).toBe(100)

    const atEvent = await computeMetrics({
      snapshot: snapshot([moved], [upsell]),
      months: ["2026-05"],
      csmIds: [CSM_A, CSM_B],
      config: { movementAttribution: "owner_at_event" },
    })
    expect(atEvent.perCsm.find((c) => c.csmId === CSM_B)!.months[0].upsell).toBe(100)
  })
})

describe("§6 NRR aggregation", () => {
  const months = [
    computeMonthly("2026-01", "janv. 26", 300000, 6000, 0, 0, 100), // 102 %
    computeMonthly("2026-02", "févr. 26", 30000, 0, 0, 3000, 10),   //  90 %
    computeMonthly("2026-03", "mars 26", 0, 0, 0, 0, 0),            //  n/a
  ]

  it("weighted lets the big month dominate", () => {
    const agg = aggregateNrr(months, "weighted")
    // (330 000 + 3 000) / 330 000
    expect(agg.nrr).toBeCloseTo(100.91, 2)
    expect(agg.monthsCounted).toBe(2)
  })

  it("mean gives both months the same say", () => {
    expect(aggregateNrr(months, "mean").nrr).toBeCloseTo(96, 2)
  })

  it("compound multiplies the monthly ratios", () => {
    expect(aggregateNrr(months, "compound").nrr).toBeCloseTo(91.8, 2)
  })

  it("an empty portfolio has an absent NRR, never zero", () => {
    const empty = [computeMonthly("2026-01", "janv. 26", 0, 0, 0, 0, 0)]
    expect(empty[0].nrr).toBeNull()
    expect(aggregateNrr(empty, "weighted").nrr).toBeNull()
  })
})

describe("§10 manual corrections", () => {
  const snap = snapshot(
    [account({ id: "a", name: "A", mrr: 1000, csm: CSM_A, phase: "Run", firstPaymentDate: "2025-01-01" })],
    [movement({ id: "m1", type: "churn", amount: -300, operationDate: "2026-05-10", eligibility: true, stage: STAGE_CHURN_DOWNSELL, accountId: "a" })]
  )

  it("refuses a correction without a reason instead of ignoring it", () => {
    const result = loadOverrides([{ dealId: "m1", amount: 100, author: "thomas" }], snap)
    expect(result.applied.size).toBe(0)
    expect(result.refused).toHaveLength(1)
    expect(result.refused[0].problem).toContain("motif")
  })

  it("reports a correction aiming at no existing deal", () => {
    const result = loadOverrides(
      [{ dealId: "nope", amount: 100, reason: "saisie", author: "thomas" }],
      snap
    )
    expect(result.applied.size).toBe(0)
    expect(result.orphaned).toHaveLength(1)
  })

  it("keeps the original value alongside the retained one, and applies it", async () => {
    const overrides = [{ dealId: "m1", amount: 100, reason: "downsell mal saisi", author: "thomas" }]
    const result = await computeMetrics({
      snapshot: snap,
      months: ["2026-05"],
      csmIds: [CSM_A],
      overrides,
    })
    expect(result.perCsm[0].months[0].churn).toBe(100)
    expect(result.diagnostics.overrides.applied[0].originalAmount).toBe(300)
    expect(result.diagnostics.overrides.applied[0].author).toBe("thomas")
  })
})

describe("§9 nothing disappears in silence", () => {
  it("reports an account whose MRR history does not reach the observed month", async () => {
    // The CSM is known, but the MRR was only ever recorded from April onwards.
    // Reading March must not silently treat that as a MRR of zero.
    const late = account({
      id: "late",
      name: "Late history",
      mrr: [["2026-04-01T00:00:00Z", 800]],
      csm: [["2025-01-01T00:00:00Z", CSM_A]],
      phase: "Run",
      firstPaymentDate: "2025-01-01",
    })

    const result = await computeMetrics({
      snapshot: snapshot([late], []),
      months: ["2026-03", "2026-05"],
      csmIds: [CSM_A],
    })

    expect(result.perCsm[0].months[0].startingMrr).toBe(0)
    expect(result.perCsm[0].months[1].startingMrr).toBe(800)
    expect(result.diagnostics.truncatedHistory).toHaveLength(1)
    expect(result.diagnostics.truncatedHistory[0].accountName).toBe("Late history")
    expect(result.diagnostics.truncatedHistory[0].month).toBe("2026-03")
  })
})
