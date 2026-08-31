// =============================================================================
// The reference cases of spec §11. If these stop being true, the test breaks.
// The commission cases (§11.4) are out of scope for this tool.
// =============================================================================

import { describe, it, expect } from "vitest"
import { computeMetrics } from "@/lib/engine"
import { account, movement, snapshot } from "./helpers"
import { STAGE_CHURN_DOWNSELL } from "@/lib/engine/config"

const CSM = "75406611" // Antoine de Chanaleilles

/** Round a NRR the way the spec quotes it: one decimal. */
function nrrOf(months: Array<{ month: string; nrr: number | null }>, key: string): number | null {
  const found = months.find((m) => m.month === key)
  if (!found || found.nrr == null) return null
  return Math.round(found.nrr * 10) / 10
}

function monthOf<T extends { month: string }>(months: T[], key: string): T {
  const found = months.find((m) => m.month === key)
  if (!found) throw new Error(`month ${key} not in result`)
  return found
}

describe("§11.1 Cocorico SAS — total churn, MRR never reset", () => {
  const cocorico = account({
    id: "cocorico",
    name: "Cocorico SAS",
    mrr: [["2025-02-25T00:00:00Z", 1941]],
    csm: [["2025-02-25T00:00:00Z", CSM]],
    phase: [["2025-02-25T00:00:00Z", "Run"]],
    firstPaymentDate: "2025-02-25",
  })

  const churn = movement({
    id: "cocorico-churn",
    type: "churn",
    amount: -1941,
    operationDate: "2026-02-25",
    eligibility: true,
    stage: STAGE_CHURN_DOWNSELL,
    accountId: "cocorico",
  })

  it("reproduces the spec's monthly table", async () => {
    const result = await computeMetrics({
      snapshot: snapshot([cocorico], [churn]),
      months: ["2026-01", "2026-02", "2026-03", "2026-04"],
      csmIds: [CSM],
    })
    const months = result.perCsm[0].months

    // 2026-01: 1 941 € of MRR, no churn, 100.0 %
    expect(monthOf(months, "2026-01").startingMrr).toBe(1941)
    expect(monthOf(months, "2026-01").churn).toBe(0)
    expect(nrrOf(months, "2026-01")).toBe(100)

    // 2026-02: still in the base — it was there on the 1st — and the churn hits.
    expect(monthOf(months, "2026-02").startingMrr).toBe(1941)
    expect(monthOf(months, "2026-02").churn).toBe(1941)
    expect(nrrOf(months, "2026-02")).toBe(0)

    // 2026-03 and after: out of the base. Not a zero NRR — an absent one.
    expect(monthOf(months, "2026-03").startingMrr).toBe(0)
    expect(monthOf(months, "2026-03").nrr).toBeNull()
    expect(monthOf(months, "2026-04").nrr).toBeNull()
  })

  it("reports the exit and the ghost MRR it removed", async () => {
    const result = await computeMetrics({
      snapshot: snapshot([cocorico], [churn]),
      months: ["2026-01", "2026-02", "2026-03"],
      csmIds: [CSM],
    })
    const exits = result.diagnostics.churnExits
    expect(exits).toHaveLength(1)
    expect(exits[0].accountName).toBe("Cocorico SAS")
    expect(exits[0].mrr).toBe(1941)
    expect(exits[0].via).toBe("deal")
  })
})

describe("§11.2 Maison Berger Paris — a downsell labelled Churn", () => {
  const berger = account({
    id: "berger",
    name: "Maison Berger Paris",
    mrr: [["2025-01-01T00:00:00Z", 1186.25]],
    csm: [["2025-01-01T00:00:00Z", CSM]],
    phase: [["2025-01-01T00:00:00Z", "Run"]],
    firstPaymentDate: "2025-01-01",
  })

  const churn = movement({
    id: "berger-churn",
    type: "churn",
    amount: -150,
    operationDate: "2026-03-25",
    eligibility: true,
    stage: STAGE_CHURN_DOWNSELL,
    accountId: "berger",
  })

  it("reproduces the spec's monthly table and keeps the account", async () => {
    const result = await computeMetrics({
      snapshot: snapshot([berger], [churn]),
      months: ["2026-03", "2026-04", "2026-05"],
      csmIds: [CSM],
    })
    const months = result.perCsm[0].months

    expect(monthOf(months, "2026-03").startingMrr).toBe(1186.25)
    expect(monthOf(months, "2026-03").churn).toBe(150)
    expect(nrrOf(months, "2026-03")).toBe(87.4)

    // The account STAYS: active phase AND partial loss.
    expect(monthOf(months, "2026-04").startingMrr).toBe(1186.25)
    expect(monthOf(months, "2026-04").churn).toBe(0)
    expect(nrrOf(months, "2026-04")).toBe(100)
    expect(nrrOf(months, "2026-05")).toBe(100)
  })

  it("flags it as a mis-attributed downsell, and does not report it as an exit", async () => {
    const result = await computeMetrics({
      snapshot: snapshot([berger], [churn]),
      months: ["2026-03", "2026-04"],
      csmIds: [CSM],
    })
    expect(result.diagnostics.churnExits).toHaveLength(0)
    expect(result.diagnostics.churnVetoes).toHaveLength(1)
    expect(result.diagnostics.churnVetoes[0].accountName).toBe("Maison Berger Paris")
    expect(result.diagnostics.churnVetoes[0].churnedAmount).toBe(150)
  })
})

describe("§11.3 sunii — stale phase, the veto must NOT apply", () => {
  const sunii = account({
    id: "sunii",
    name: "sunii",
    mrr: [["2025-01-01T00:00:00Z", 108.4]],
    csm: [["2025-01-01T00:00:00Z", CSM]],
    phase: [["2025-01-01T00:00:00Z", "Run"]], // never updated after the departure
    firstPaymentDate: "2025-01-01",
  })

  const churn = movement({
    id: "sunii-churn",
    type: "churn",
    amount: -108.4,
    operationDate: "2026-01-15",
    eligibility: true,
    stage: STAGE_CHURN_DOWNSELL,
    accountId: "sunii",
  })

  it("exits in February: the churn clears the whole MRR, so the veto is void", async () => {
    const result = await computeMetrics({
      snapshot: snapshot([sunii], [churn]),
      months: ["2026-01", "2026-02", "2026-03"],
      csmIds: [CSM],
    })
    const months = result.perCsm[0].months

    expect(monthOf(months, "2026-01").startingMrr).toBe(108.4)
    expect(monthOf(months, "2026-01").churn).toBe(108.4)
    expect(nrrOf(months, "2026-01")).toBe(0)

    expect(monthOf(months, "2026-02").startingMrr).toBe(0)
    expect(monthOf(months, "2026-02").nrr).toBeNull()

    expect(result.diagnostics.churnVetoes).toHaveLength(0)
    expect(result.diagnostics.churnExits).toHaveLength(1)
    expect(result.diagnostics.churnExits[0].mrr).toBe(108.4)
    // It IS reported as still carrying an active phase — that is the CRM to fix.
    expect(result.diagnostics.churnExits[0].phase).toBe("run")
  })
})
