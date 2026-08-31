// =============================================================================
// Snapshot extraction against realistic HubSpot payloads.
//
// This is where a wrong assumption about the API's response shape would break
// everything downstream in silence, so the shapes here mirror what the portal
// actually returns — history newest-first included.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { valueAt } from "@/lib/engine/timeline"
import { invalidateCache } from "@/lib/cache"

const CSM_A = "75406611"
const CSM_B = "1331556319"

/** Route a fetch by URL to the right canned payload. */
function mockHubSpot() {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString()
    const body = init?.body ? JSON.parse(String(init.body)) : {}

    const json = (data: unknown) =>
      ({ ok: true, status: 200, json: async () => data }) as unknown as Response

    if (href.includes("/objects/deals/search")) {
      return json({
        total: 2,
        results: [
          {
            id: "deal-churn",
            properties: {
              dealname: "Acme - Churn",
              amount: "-450",
              attribution: "Churn",
              dealstage: "1220133077",
              deal_eligibility: "true",
              date_de_paiement: null,
              date_de_prise_en_compte: "2026-05-10",
              hubspot_owner_id: CSM_B,
            },
          },
          {
            id: "deal-newbiz",
            properties: {
              dealname: "Acme - Demo Request",
              amount: "1000",
              attribution: "Inobund",
              dealstage: "143474109",
              // The first billing comes from the new-business deal, not a movement.
              date_de_paiement: "2025-02-25",
              date_de_prise_en_compte: "2025-02-17",
              hubspot_owner_id: CSM_A,
            },
          },
        ],
      })
    }

    if (href.includes("/objects/companies/search")) {
      return json({ total: 1, results: [{ id: "900001", properties: { name: "Acme" } }] })
    }

    if (href.includes("/associations/deals/companies/batch/read")) {
      return json({
        results: body.inputs.map((i: { id: string }) => ({
          from: { id: i.id },
          to: [{ toObjectId: 900001 }], // numeric, as HubSpot returns it
        })),
      })
    }

    if (href.includes("/objects/companies/batch/read")) {
      return json({
        results: [
          {
            id: "900001",
            properties: {
              name: "Acme",
              total_revenue: "1450.0",
              proprietaire_de_l_entreprise__csm_: CSM_B,
              phase_du_client: "Run",
            },
            // HubSpot renders history NEWEST FIRST.
            propertiesWithHistory: {
              total_revenue: [
                { value: "1450.0", timestamp: "2026-04-01T00:00:00Z" },
                { value: "1000.0", timestamp: "2025-02-25T00:00:00Z" },
              ],
              proprietaire_de_l_entreprise__csm_: [
                { value: CSM_B, timestamp: "2026-03-15T00:00:00Z" },
                { value: CSM_A, timestamp: "2025-02-25T00:00:00Z" },
              ],
              phase_du_client: [
                { value: "Run", timestamp: "2025-06-01T00:00:00Z" },
                { value: "Onboarding", timestamp: "2025-02-25T00:00:00Z" },
              ],
            },
          },
        ],
      })
    }

    throw new Error(`unexpected request: ${href}`)
  })
}

describe("snapshot extraction", () => {
  beforeEach(() => {
    invalidateCache()
    process.env.HUBSPOT_ACCESS_TOKEN = "test-token"
    vi.stubGlobal("fetch", mockHubSpot())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    invalidateCache()
  })

  it("builds accounts whose histories read correctly at a past date", async () => {
    const { buildSnapshot } = await import("@/lib/engine/snapshot")
    const snapshot = await buildSnapshot({ refresh: true })

    expect(snapshot.accounts).toHaveLength(1)
    const acme = snapshot.accounts[0]

    // Ascending re-sort: at March the account was still on 1 000 € and CSM A.
    expect(valueAt(acme.mrr, "2026-03-01T00:00:00Z")).toBe(1000)
    expect(valueAt(acme.csm, "2026-03-01T00:00:00Z")).toBe(CSM_A)
    // After both changes: 1 450 € and CSM B.
    expect(valueAt(acme.mrr, "2026-05-01T00:00:00Z")).toBe(1450)
    expect(valueAt(acme.csm, "2026-05-01T00:00:00Z")).toBe(CSM_B)
    // Phase is lower-cased so the config's stage lists can match it.
    expect(valueAt(acme.phase, "2026-05-01T00:00:00Z")).toBe("run")
    expect(valueAt(acme.phase, "2025-03-01T00:00:00Z")).toBe("onboarding")
  })

  it("takes the first billing from the new-business deal, not the movement", async () => {
    const { buildSnapshot } = await import("@/lib/engine/snapshot")
    const snapshot = await buildSnapshot({ refresh: true })
    expect(snapshot.accounts[0].firstPaymentDate).toBe("2025-02-25")
  })

  it("keeps only attributed deals as movements, and links them to their account", async () => {
    const { buildSnapshot } = await import("@/lib/engine/snapshot")
    const snapshot = await buildSnapshot({ refresh: true })

    // The Inbound deal fed the first billing date but is not a MRR movement.
    expect(snapshot.movements).toHaveLength(1)
    const churn = snapshot.movements[0]
    expect(churn.type).toBe("churn")
    expect(churn.amount).toBe(450)      // abs()
    expect(churn.rawAmount).toBe(-450)  // signed, kept for diagnostics
    expect(churn.eligibility).toBe(true)
    expect(churn.operationDate).toBe("2026-05-10")
    expect(churn.accountId).toBe("900001")
  })

  it("computes the month end to end from the extracted snapshot", async () => {
    const { buildSnapshot } = await import("@/lib/engine/snapshot")
    const { computeMetrics } = await import("@/lib/engine")

    const snapshot = await buildSnapshot({ refresh: true })

    const result = await computeMetrics({
      snapshot,
      months: ["2026-05", "2026-06"],
      csmIds: [CSM_A, CSM_B],
    })

    const b = result.perCsm.find((c) => c.csmId === CSM_B)!
    expect(b.months[0].startingMrr).toBe(1450)
    expect(b.months[0].churn).toBe(450)
    expect(b.months[0].nrr).toBeCloseTo(68.97, 2)

    // June: the churn cleared only part of the MRR and the phase is active,
    // so the veto keeps the account — it is a downsell wearing the wrong label.
    expect(b.months[1].startingMrr).toBe(1450)
    expect(result.diagnostics.churnVetoes).toHaveLength(1)
  })
})
