import type { Company, HealthScore, IntercomTicket } from "../types"

// Health Score: 0-100, weighted across 9 signals
// Higher = healthier account

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function calculateHealthScore(
  company: Company,
  openTickets: number,
  daysSinceLastActivity: number | null
): HealthScore {
  const breakdown = {
    roi: scoreRoi(company.roi),
    revenue: scoreRevenue(company.revenueLoyalty, company.revenueReferral),
    missions: scoreMissions(company.totalMissions),
    scoreLoyalty: scoreNormalized(company.scoreLoyalty, 10),
    scoreReferral: scoreNormalized(company.scoreReferral, 10),
    participationRate: scoreParticipation(company.participationRate),
    supportTickets: scoreTickets(openTickets),
    lastActivity: scoreLastActivity(daysSinceLastActivity),
    customerStage: scoreCustomerStage(company.customerStage),
  }

  const total = clamp(
    breakdown.roi +
    breakdown.revenue +
    breakdown.missions +
    breakdown.scoreLoyalty +
    breakdown.scoreReferral +
    breakdown.participationRate +
    breakdown.supportTickets +
    breakdown.lastActivity +
    breakdown.customerStage,
    0,
    100
  )

  const grade: HealthScore["grade"] =
    total >= 75 ? "excellent" :
    total >= 50 ? "good" :
    total >= 30 ? "warning" :
    "critical"

  return { total: Math.round(total), grade, breakdown }
}

// ROI: (revenue loyalty + referral) / MRR — max 20 pts
function scoreRoi(roi: number): number {
  if (roi > 5) return 20
  if (roi > 2) return 15
  if (roi > 1) return 10
  if (roi > 0) return 5
  return 0
}

// Revenue Loyalty + Referral — max 15 pts
function scoreRevenue(loyalty: number, referral: number): number {
  const total = loyalty + referral
  if (total > 5000) return 15
  if (total > 1000) return 12
  if (total > 100) return 8
  if (total > 0) return 4
  return 0
}

// Total missions — max 10 pts
function scoreMissions(missions: number): number {
  if (missions > 10) return 10
  if (missions > 5) return 7
  if (missions > 1) return 4
  if (missions > 0) return 2
  return 0
}

// Normalize a 0-100 score to max points
function scoreNormalized(score: number, maxPoints: number): number {
  if (score <= 0) return 0
  return Math.round((clamp(score, 0, 100) / 100) * maxPoints)
}

// Participation rate — max 10 pts
function scoreParticipation(rate: number): number {
  if (rate > 30) return 10
  if (rate > 10) return 6
  if (rate > 0) return 2
  return 0
}

// Open support tickets — max 10 pts (inverse: fewer = better)
function scoreTickets(openCount: number): number {
  if (openCount === 0) return 10
  if (openCount <= 2) return 6
  if (openCount <= 5) return 3
  return 0
}

// Days since last CSM activity — max 10 pts (inverse: recent = better)
function scoreLastActivity(days: number | null): number {
  if (days === null) return 0
  if (days < 14) return 10
  if (days < 30) return 6
  if (days < 60) return 3
  return 0
}

// Customer stage — max 5 pts
function scoreCustomerStage(stage: string | null): number {
  switch (stage) {
    case "Run": return 5
    case "Activated": return 4
    case "Onboarding": return 3
    case "To come": return 2
    case "New": return 1
    default: return 0
  }
}
