import type { StageCategory, AttributionValue, PeriodFilter } from "./constants"

// =============================================================================
// HubSpot raw types
// =============================================================================

export interface HubSpotDeal {
  id: string
  properties: {
    dealname: string
    amount: string | null
    hs_mrr: string | null
    hs_arr: string | null
    hs_acv: string | null
    attribution: string | null
    renewall_date: string | null
    renewall_strategy: string | null
    date_de_prise_en_compte: string | null
    closedate: string | null
    dealstage: string
    pipeline: string
    hubspot_owner_id: string | null
    createdate: string | null
    hs_lastmodifieddate: string | null
    [key: string]: string | null
  }
  associations?: {
    companies?: {
      results: Array<{ id: string; type: string }>
    }
  }
}

export interface HubSpotCompany {
  id: string
  properties: {
    name: string | null
    domain: string | null
    total_revenue: string | null
    plan: string | null
    client_revenue_tiers: string | null
    hubspot_owner_id: string | null
    proprietaire_de_l_entreprise__csm_: string | null
    lifecyclestage: string | null
    phase_du_client: string | null
    num_associated_deals: string | null
    [key: string]: string | null
  }
}

export interface HubSpotOwner {
  id: string
  email: string
  firstName: string
  lastName: string
}

export interface HubSpotEngagement {
  id: string
  properties: {
    hs_engagement_type: string | null
    hs_timestamp: string | null
    hubspot_owner_id: string | null
    hs_body_preview: string | null
    [key: string]: string | null
  }
}

export interface HubSpotSearchResponse<T> {
  total: number
  results: T[]
  paging?: {
    next?: {
      after: string
    }
  }
}

// =============================================================================
// Application domain types
// =============================================================================

export interface Deal {
  id: string
  name: string
  amount: number
  mrr: number
  arr: number
  acv: number
  attribution: string | null
  renewalDate: string | null
  renewalStrategy: string | null
  operationDate: string | null
  paymentDate: string | null
  closeDate: string | null
  stage: string
  pipeline: string
  ownerId: string | null
  createdAt: string | null
  lastModified: string | null
  companyId?: string
  companyName?: string
  companyRevenueTier?: string
}

export interface Company {
  id: string
  name: string
  domain: string | null
  mrr: number // total_revenue from HubSpot ("Chiffre d'affaire total")
  plan: string | null
  revenueTier: string | null // client_revenue_tiers (custom HubSpot property)
  ownerId: string | null
  lifecycleStage: string | null
  customerStage: string | null // phase_du_client
  numDeals: number
  // Product data
  revenueLoyalty: number
  revenueReferral: number
  roi: number
  totalMissions: number
  totalOrders: number
  scoreLoyalty: number
  scoreReferral: number
  participationRate: number
  rewardsConversionRate: number
  pointsUsageRate: number
  referralConversionRate: number
  newClientsRateReferral: number
  totalAskedReferral: number
  // CSM metadata
  isStrategic: boolean
  accompagnement: string | null
  reasonChurn: string | null
  customerSituation: string | null
  // Upsell enrichment signals
  upsellSignals: UpsellSignals | null
}

export interface UpsellSignals {
  parentCompany: string | null
  parentSiren: string | null
  siblingBrands: Array<{
    name: string
    siren: string
    isClient: boolean
    hubspotCompanyId?: string
    isEcommerce?: boolean
    platform?: string | null              // Shopify / PrestaShop / WooCommerce / Magento / BigCommerce / Shopware / Generic
    fit?: "strong" | "partial" | "none"   // Loyoly fit based on platform detected
    domain?: string | null                // Resolved domain (from Pappers or inferred)
    role?: string
    icpScore?: number      // 0-100 ICP fit score
    icpSignals?: string[]  // signals that contribute to the score
    excluded?: boolean
    excludeReason?: string
  }>
  storesCount: number
  languages: string[]
  subsites: Array<{ lang: string; url: string }>
  enrichedAt: string | null
  score: number
  grade: "hot" | "warm" | "cold"
}

export interface IntercomTicket {
  id: string
  title: string
  state: "open" | "closed" | "snoozed"
  priority: string | null
  createdAt: string
  updatedAt: string
  url: string
}

export interface CalendarMeeting {
  id: string
  summary: string
  start: string
  end: string
  status: "confirmed" | "cancelled" | "tentative"
  attendees: string[]
  link: string | null
}

export interface HealthScore {
  total: number // 0-100
  grade: "excellent" | "good" | "warning" | "critical"
  breakdown: {
    roi: number
    revenue: number
    missions: number
    scoreLoyalty: number
    scoreReferral: number
    participationRate: number
    supportTickets: number
    lastActivity: number
    customerStage: number
  }
}

export interface AccountDetail {
  company: Company
  healthScore: HealthScore
  deals: Deal[]
  tickets: IntercomTicket[]
  meetings: CalendarMeeting[]
}

export interface Engagement {
  id: string
  type: string
  timestamp: string
  ownerId: string | null
  preview: string | null
}

// =============================================================================
// KPI / Metric types
// =============================================================================

export interface KpiValue {
  value: number
  previousValue: number
  delta: number // percentage change
  deltaDirection: "up" | "down" | "flat"
  label: string
  format: "currency" | "percent" | "number"
}

export interface DashboardKpis {
  mrrUnderManagement: KpiValue
  nrr: KpiValue
  churnRate: KpiValue
  upsellRevenue: KpiValue
  activeDeals: KpiValue & {
    breakdown: Record<StageCategory, number>
  }
  renewals30d: KpiValue
}

export interface RenewalKpis {
  thisMonth: { count: number; mrr: number }
  nextMonth: { count: number; mrr: number }
  next90Days: { count: number; mrr: number }
  renewalRate: number
}

export interface WeeklyMovement {
  week: string // ISO week start date
  weekLabel: string
  upsell: number
  churn: number
  downsell: number
}

export interface NrrDataPoint {
  month: string
  monthLabel: string
  nrr: number
  csmId?: string
  csmName?: string
}

export interface PipelineFunnelStep {
  category: StageCategory
  label: string
  dealCount: number
  totalMrr: number
  conversionRate: number | null
  color: string
}

export interface StageAging {
  stageId: string
  stageLabel: string
  avgDays: number
  dealCount: number
  isOverThreshold: boolean
}

export interface CsmPortfolio {
  csmId: string
  csmName: string
  csmRole: string
  initials: string
  color: string
  accountCount: number
  totalMrr: number
  nrr: number
  upsellThisMonth: number
  churnThisMonth: number
  renewals30d: number
  healthPercent: number
  stageBreakdown: Record<StageCategory, number>
}

export interface RenewalDeal extends Deal {
  daysUntilRenewal: number
  lastContactDate?: string | null
}

// =============================================================================
// Filter / query types
// =============================================================================

export interface GlobalFilters {
  period: PeriodFilter
  csmId: string | null // null = all CSMs
  dateFrom?: string
  dateTo?: string
}

export interface DateRange {
  from: Date
  to: Date
  previousFrom: Date
  previousTo: Date
}
