// =============================================================================
// CSM OS — HubSpot Mappings & Constants
// Source of truth for all HubSpot IDs, labels, and business logic mappings.
// =============================================================================

// -----------------------------------------------------------------------------
// Pipelines
// -----------------------------------------------------------------------------

export const PIPELINES = {
  SALES: "default",
  CUSTOMERS_STAGE: "801956030",
  AGENCY_PARTNER: "473964478",
  TECH_PARTNERS: "508524516",
  PROSPECTION: "572412129",
  PARTNER_INTROS: "2192247019",
} as const

export const PIPELINE_LABELS: Record<string, string> = {
  [PIPELINES.SALES]: "Pipeline des ventes",
  [PIPELINES.CUSTOMERS_STAGE]: "Customers stage",
  [PIPELINES.AGENCY_PARTNER]: "Agency partner pipe",
  [PIPELINES.TECH_PARTNERS]: "Tech Partners Pipe",
  [PIPELINES.PROSPECTION]: "Prospection",
  [PIPELINES.PARTNER_INTROS]: "Partner intros",
}

// -----------------------------------------------------------------------------
// Deal Stages — Customers Stage Pipeline (801956030)
// -----------------------------------------------------------------------------

export const CUSTOMER_STAGES = {
  CSM_A_ATTRIBUER: "1145403589",
  ONBOARDING_PLANIFIE: "1145403590",
  PAIEMENT_REALISE: "1145403591",
  POINT_ONBOARDING: "1145403601",
  POINT_STRATEGIE: "1145403602",
  POINT_PRE_LANCEMENT: "1145403603",
  TO_CONTACT: "725331945",
  DISCUSSING: "1457421517",
  DISCOVERY: "2993846467",
  ONBOARDING_PHASE: "725331947",
  ACTIVES: "771561944",
  INACTIVES: "2918051029",
  CLOSE_LOST: "2918051030",
  NOT_ICP: "3046668506",
} as const

export const CUSTOMER_STAGE_LABELS: Record<string, string> = {
  [CUSTOMER_STAGES.CSM_A_ATTRIBUER]: "CSM à attribuer",
  [CUSTOMER_STAGES.ONBOARDING_PLANIFIE]: "Onboarding planifié",
  [CUSTOMER_STAGES.PAIEMENT_REALISE]: "Paiement réalisé",
  [CUSTOMER_STAGES.POINT_ONBOARDING]: "Point Onboarding",
  [CUSTOMER_STAGES.POINT_STRATEGIE]: "Point Stratégie",
  [CUSTOMER_STAGES.POINT_PRE_LANCEMENT]: "Point Pré-lancement",
  [CUSTOMER_STAGES.TO_CONTACT]: "To contact",
  [CUSTOMER_STAGES.DISCUSSING]: "Discussing",
  [CUSTOMER_STAGES.DISCOVERY]: "Discovery",
  [CUSTOMER_STAGES.ONBOARDING_PHASE]: "Onboarding phase",
  [CUSTOMER_STAGES.ACTIVES]: "Actives",
  [CUSTOMER_STAGES.INACTIVES]: "Inactives",
  [CUSTOMER_STAGES.CLOSE_LOST]: "Close Lost",
  [CUSTOMER_STAGES.NOT_ICP]: "Not ICP",
}

export type StageCategory = "onboarding" | "active" | "at_risk" | "churned" | "disqualified"

export const CUSTOMER_STAGE_CATEGORIES: Record<string, StageCategory> = {
  [CUSTOMER_STAGES.CSM_A_ATTRIBUER]: "onboarding",
  [CUSTOMER_STAGES.ONBOARDING_PLANIFIE]: "onboarding",
  [CUSTOMER_STAGES.PAIEMENT_REALISE]: "onboarding",
  [CUSTOMER_STAGES.POINT_ONBOARDING]: "onboarding",
  [CUSTOMER_STAGES.POINT_STRATEGIE]: "active",
  [CUSTOMER_STAGES.POINT_PRE_LANCEMENT]: "active",
  [CUSTOMER_STAGES.TO_CONTACT]: "active",
  [CUSTOMER_STAGES.DISCUSSING]: "active",
  [CUSTOMER_STAGES.DISCOVERY]: "active",
  [CUSTOMER_STAGES.ONBOARDING_PHASE]: "active",
  [CUSTOMER_STAGES.ACTIVES]: "active",
  [CUSTOMER_STAGES.INACTIVES]: "at_risk",
  [CUSTOMER_STAGES.CLOSE_LOST]: "churned",
  [CUSTOMER_STAGES.NOT_ICP]: "disqualified",
}

export const STAGE_CATEGORY_LABELS: Record<StageCategory, string> = {
  onboarding: "Onboarding",
  active: "Active",
  at_risk: "At Risk",
  churned: "Churned",
  disqualified: "Disqualified",
}

export const STAGE_CATEGORY_COLORS: Record<StageCategory, string> = {
  onboarding: "#2563EB",
  active: "#22C55E",
  at_risk: "#F59E0B",
  churned: "#EF4444",
  disqualified: "#64748B",
}

// Active stages = stages that count as "active" deals (not closed/churned/disqualified)
export const ACTIVE_STAGE_IDS = Object.entries(CUSTOMER_STAGE_CATEGORIES)
  .filter(([, cat]) => cat === "onboarding" || cat === "active" || cat === "at_risk")
  .map(([id]) => id)

// -----------------------------------------------------------------------------
// Deal Stages — Sales Pipeline (default)
// ⚠️ CRITICAL: HubSpot naming is INVERTED for closed stages:
//   - Stage ID "closedlost" → actual label "Closed Won" (deals that were WON)
//   - Stage ID "124302781" → actual label "Closed Lost" (deals that were LOST)
// The code MUST use these constants, never raw stage IDs for closed states.
// -----------------------------------------------------------------------------

export const SALES_STAGES = {
  DISCOVERY_CALL: "qualifiedtobuy",
  QUALIFIED_30: "presentationscheduled",
  EVALUATE_50: "contractsent",
  OFFRE_ENVOYEE_70: "closedwon",
  GO_VERBAL_80: "878353129",
  /** ⚠️ Despite the ID "closedlost", this is actually "Closed Won" in HubSpot */
  CLOSED_WON: "closedlost",
  PAIEMENT_RECU: "143474109",
  /** ⚠️ This is the actual "Closed Lost" stage */
  CLOSED_LOST: "124302781",
  PENDING: "124302782",
  CHURN_DOWNSELL: "1220133077",
  UPSELL: "1246247145",
} as const

export const SALES_STAGE_LABELS: Record<string, string> = {
  [SALES_STAGES.DISCOVERY_CALL]: "Discovery call planned",
  [SALES_STAGES.QUALIFIED_30]: "Qualified (30%)",
  [SALES_STAGES.EVALUATE_50]: "Evaluate (50%)",
  [SALES_STAGES.OFFRE_ENVOYEE_70]: "Offre envoyé (70%)",
  [SALES_STAGES.GO_VERBAL_80]: "Go verbal (80%)",
  [SALES_STAGES.CLOSED_WON]: "Closed Won",
  [SALES_STAGES.PAIEMENT_RECU]: "Paiement reçu",
  [SALES_STAGES.CLOSED_LOST]: "Closed Lost",
  [SALES_STAGES.PENDING]: "Pending",
  [SALES_STAGES.CHURN_DOWNSELL]: "Churn & Downsell",
  [SALES_STAGES.UPSELL]: "Upsell",
}

// -----------------------------------------------------------------------------
// Deal Attribution
// -----------------------------------------------------------------------------

export const ATTRIBUTION = {
  UPSELL: "Upsell",
  DOWNSELL: "Downsell",
  CHURN: "Churn",
  PARTNERS: "Partenaires",
  HUNT: "Chasse",
  INBOUND: "Inobund",
  PAID: "Paid",
  EVENT: "Event",
  PLG: "plg",
} as const

export type AttributionValue = (typeof ATTRIBUTION)[keyof typeof ATTRIBUTION]

export const ATTRIBUTION_LABELS: Record<string, string> = {
  [ATTRIBUTION.UPSELL]: "Upsell",
  [ATTRIBUTION.DOWNSELL]: "Downsell",
  [ATTRIBUTION.CHURN]: "Churn",
  [ATTRIBUTION.PARTNERS]: "Partners",
  [ATTRIBUTION.HUNT]: "Hunt / Chasse",
  [ATTRIBUTION.INBOUND]: "Inbound",
  [ATTRIBUTION.PAID]: "Paid",
  [ATTRIBUTION.EVENT]: "Event",
  [ATTRIBUTION.PLG]: "PLG",
}

export type AttributionCategory = "expansion" | "contraction" | "lost" | "acquisition"

export const ATTRIBUTION_CATEGORIES: Record<string, AttributionCategory> = {
  [ATTRIBUTION.UPSELL]: "expansion",
  [ATTRIBUTION.DOWNSELL]: "contraction",
  [ATTRIBUTION.CHURN]: "lost",
  [ATTRIBUTION.PARTNERS]: "acquisition",
  [ATTRIBUTION.HUNT]: "acquisition",
  [ATTRIBUTION.INBOUND]: "acquisition",
  [ATTRIBUTION.PAID]: "acquisition",
  [ATTRIBUTION.EVENT]: "acquisition",
  [ATTRIBUTION.PLG]: "acquisition",
}

export const ATTRIBUTION_COLORS: Record<string, string> = {
  [ATTRIBUTION.UPSELL]: "#22C55E",
  [ATTRIBUTION.DOWNSELL]: "#F59E0B",
  [ATTRIBUTION.CHURN]: "#EF4444",
  [ATTRIBUTION.PARTNERS]: "#8B5CF6",
  [ATTRIBUTION.HUNT]: "#06B6D4",
  [ATTRIBUTION.INBOUND]: "#2563EB",
  [ATTRIBUTION.PAID]: "#EC4899",
  [ATTRIBUTION.EVENT]: "#F97316",
  [ATTRIBUTION.PLG]: "#14B8A6",
}

// CSM-relevant attributions for revenue tracking
export const CSM_ATTRIBUTIONS = [
  ATTRIBUTION.UPSELL,
  ATTRIBUTION.CHURN,
  ATTRIBUTION.DOWNSELL,
] as const

// -----------------------------------------------------------------------------
// Stages retained per movement type (spec §5)
// -----------------------------------------------------------------------------

export const UPSELL_STAGES: string[] = [
  SALES_STAGES.CLOSED_WON,        // "closedlost" (Closed Won)
  SALES_STAGES.PAIEMENT_RECU,     // "143474109"
]

export const CHURN_DOWNSELL_STAGES: string[] = [
  SALES_STAGES.CHURN_DOWNSELL,    // "1220133077" — where 275/283 churns land
  SALES_STAGES.CLOSED_WON,        // "closedlost"
  SALES_STAGES.PAIEMENT_RECU,     // "143474109"
]

// -----------------------------------------------------------------------------
// Date used to attribute a movement to a month (spec §5)
// -----------------------------------------------------------------------------

export function movementDate(deal: { attribution: string | null; paymentDate: string | null; operationDate: string | null }): string | null {
  if (deal.attribution === ATTRIBUTION.UPSELL) return deal.paymentDate
  return deal.operationDate
}

export function movementStages(attribution: string | null): string[] | null {
  if (attribution === ATTRIBUTION.UPSELL) return UPSELL_STAGES
  if (attribution === ATTRIBUTION.CHURN || attribution === ATTRIBUTION.DOWNSELL) return CHURN_DOWNSELL_STAGES
  return null
}

export function isRetainedMovement(deal: { attribution: string | null; stage: string; paymentDate: string | null; operationDate: string | null; amount: number }): boolean {
  const stages = movementStages(deal.attribution)
  if (!stages || !stages.includes(deal.stage)) return false
  if (!movementDate(deal)) return false
  if (deal.amount === 0) return false
  return true
}

// -----------------------------------------------------------------------------
// Booked vs Billed — dashboard calculation modes
// -----------------------------------------------------------------------------

export type CalcMethod = "booked" | "billed"

export function movementDateFor(
  deal: { attribution: string | null; paymentDate: string | null; operationDate: string | null },
  method: CalcMethod
): string | null {
  if (method === "booked") return deal.operationDate
  // billed: upsell by payment, churn/downsell by operation (default spec §5)
  return movementDate(deal)
}

// -----------------------------------------------------------------------------
// Countries / Regions (spec: FR / GB / ES from `code_pays_region`)
// -----------------------------------------------------------------------------

export const COUNTRIES = ["FR", "GB", "ES"] as const
export type Country = (typeof COUNTRIES)[number]

export function normalizeCountry(raw: string | null | undefined): Country | null {
  if (!raw) return null
  const v = raw.trim().toUpperCase()
  if (v === "FR" || v === "UK" || v === "GB" || v === "ES") {
    // "UK" label sometimes appears in HubSpot data even though the ISO code is GB
    if (v === "UK") return "GB"
    return v as Country
  }
  return null
}

// -----------------------------------------------------------------------------
// Tiers (customer_revenue_tiers)
// Canonical values: "T1", "T2", "T3", "T4" — but we also accept and pass
// through any other tier name HubSpot uses (Bronze/Silver/Gold, SMB/Mid/Ent…)
// so the dashboard doesn't silently drop them.
// -----------------------------------------------------------------------------

export const TIERS = ["T1", "T2", "T3", "T4"] as const
export type Tier = string  // widened — the raw HubSpot value is kept as-is

// Normalize a HubSpot tier value. If it clearly maps to T1..T4 (contains a
// matching digit), returns that canonical label. Otherwise returns the raw
// string trimmed — never null when input is non-empty.
export function normalizeTier(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = raw.trim()
  if (!v) return null
  const upper = v.toUpperCase()
  if (upper.includes("T1") || upper === "1" || upper.includes("TIER 1")) return "T1"
  if (upper.includes("T2") || upper === "2" || upper.includes("TIER 2")) return "T2"
  if (upper.includes("T3") || upper === "3" || upper.includes("TIER 3")) return "T3"
  if (upper.includes("T4") || upper === "4" || upper.includes("TIER 4")) return "T4"
  return v
}

// -----------------------------------------------------------------------------
// CSM Team
// Add a new CSM = add a new entry. That's it.
// -----------------------------------------------------------------------------

export interface CSMMember {
  id: string
  name: string
  role: string
  initials: string
  color: string
}

export const CSM_TEAM: CSMMember[] = [
  { id: "1331556319", name: "Farah Bahoui", role: "Senior CSM", initials: "FB", color: "#8B5CF6" },
  { id: "75406611", name: "Antoine de Chanaleilles", role: "Senior CSM", initials: "AC", color: "#06B6D4" },
  { id: "78820483", name: "Marthe Potin", role: "CSM", initials: "MP", color: "#EC4899" },
  { id: "31564081", name: "Fatima Hilmi", role: "CSM", initials: "FH", color: "#F97316" },
  { id: "1949410186", name: "Antoine Rivaud", role: "CSM", initials: "AR", color: "#14B8A6" },
  { id: "44919918", name: "Thomas Prouveur", role: "COO (backup)", initials: "TP", color: "#64748B" },
]

export const CSM_TEAM_IDS = CSM_TEAM.map((m) => m.id)

// CSMs who appear as chart series (excludes backup/COO)
export const CHART_CSMS = CSM_TEAM
  .filter((m) => m.role !== "COO (backup)")
  .map((m) => ({ name: m.name, color: m.color }))

export function getCsmById(id: string): CSMMember | undefined {
  return CSM_TEAM.find((m) => m.id === id)
}

export function getCsmName(id: string): string {
  return getCsmById(id)?.name ?? "Unknown"
}

// -----------------------------------------------------------------------------
// Time / Period
// -----------------------------------------------------------------------------

export type PeriodFilter = "this_week" | "this_month" | "this_quarter" | "custom"

export const PERIOD_LABELS: Record<PeriodFilter, string> = {
  this_week: "Cette semaine",
  this_month: "Ce mois",
  this_quarter: "Ce trimestre",
  custom: "Personnalisé",
}

// Cache TTL
export const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

// HubSpot API pagination limit
export const HUBSPOT_PAGE_LIMIT = 200

// Deal properties to fetch
export const DEAL_PROPERTIES = [
  "dealname",
  "amount",
  "hs_mrr",
  "hs_arr",
  "hs_acv",
  "attribution",
  "renewall_date",
  "renewall_strategy",
  "date_de_prise_en_compte",
  "date_de_paiement",
  "expected_closing_date",
  "closedate",
  "dealstage",
  "pipeline",
  "hubspot_owner_id",
  "createdate",
  "hs_lastmodifieddate",
  "hs_deal_stage_probability",
  "deal_eligibility",
] as const

// Company properties to fetch
export const COMPANY_PROPERTIES = [
  "name",
  "domain",
  "total_revenue",
  "plan",
  "client_revenue_tiers",
  "code_pays_region",
  "hubspot_owner_id",
  "proprietaire_de_l_entreprise__csm_",
  "lifecyclestage",
  "phase_du_client",
  "num_associated_deals",
  // Product data (synced from Loyoly)
  "revenue_loyalty",
  "revenue_referral",
  "roi",
  "total_missions",
  "total_orders",
  "score_loyalty",
  "score_referral",
  "participation_rate__loyalty_",
  "rewards_conversion_rate__loyalty_",
  "points_usage_rate__loyalty_",
  "referral_conversion_rate",
  "new_clients_rate__referral_",
  "total_asked_referral",
  // CSM metadata
  "compte_strategique",
  "cs_accompagnement",
  "reason_churn",
  "customers_situation",
] as const

// Customer stage (phase_du_client) — active values for CSM dashboard
export const ACTIVE_CUSTOMER_STAGES = ["New", "To come", "Onboarding", "Activated", "Run"] as const

export const CUSTOMER_PHASE_LABELS: Record<string, string> = {
  "New": "Signed",
  "To come": "Engaged",
  "Onboarding": "Onboarding",
  "Activated": "Activated",
  "Run": "Run",
  "churn": "Churn",
  "trial": "Trial",
  "Lead": "Lead",
  "Parent company": "Parent company",
}
