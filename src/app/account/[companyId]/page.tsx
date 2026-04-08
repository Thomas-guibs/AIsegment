"use client"

import { Suspense } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Header } from "@/components/layout/Header"
import { useFetch } from "@/lib/hooks"
import type { AccountDetail } from "@/lib/types"
import { cn, formatCurrency, formatDateFR } from "@/lib/utils"
import { getCsmName, ATTRIBUTION_COLORS, ATTRIBUTION_LABELS, SALES_STAGE_LABELS, CUSTOMER_PHASE_LABELS } from "@/lib/constants"
import {
  ArrowLeft,
  Heart,
  TrendingUp,
  Gift,
  Users,
  Target,
  Star,
  MessageSquare,
  Calendar,
  ExternalLink,
} from "lucide-react"

function HealthBadge({ score, grade }: { score: number; grade: string }) {
  const colors = {
    excellent: "bg-positive/15 text-positive border-positive/30",
    good: "bg-accent/15 text-accent border-accent/30",
    warning: "bg-warning/15 text-warning border-warning/30",
    critical: "bg-negative/15 text-negative border-negative/30",
  }
  return (
    <div className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-semibold", colors[grade as keyof typeof colors] ?? colors.warning)}>
      <Heart className="w-4 h-4" />
      {score}/100
    </div>
  )
}

function AccountContent() {
  const params = useParams()
  const companyId = params.companyId as string
  const { data, loading, error } = useFetch<AccountDetail>(`/api/account/${companyId}`)

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="skeleton h-24" />
        <div className="grid grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-20" />)}
        </div>
        <div className="skeleton h-64" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="card text-center py-12">
          <p className="text-negative text-sm">Erreur: {error ?? "Company non trouvee"}</p>
          <Link href="/portfolio" className="text-accent text-sm mt-2 inline-block hover:underline">
            Retour au portefeuille
          </Link>
        </div>
      </div>
    )
  }

  const { company, healthScore, deals, tickets, meetings } = data
  const csmName = company.ownerId ? getCsmName(company.ownerId) : "Non assigne"

  return (
    <div className="p-6 space-y-6">
      {/* Back link */}
      <Link href="/portfolio" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-primary transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Retour
      </Link>

      {/* Header */}
      <div className="card flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-xl font-semibold text-text-primary">{company.name}</h2>
            <HealthBadge score={healthScore.total} grade={healthScore.grade} />
            {company.isStrategic && (
              <span className="badge bg-accent/15 text-accent"><Star className="w-3 h-3 mr-1" />Strategique</span>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm text-text-secondary">
            <span>Plan: <strong className="text-text-primary">{company.plan ?? "—"}</strong></span>
            <span>Stage: <strong className="text-text-primary">{CUSTOMER_PHASE_LABELS[company.customerStage ?? ""] ?? company.customerStage}</strong></span>
            <span>CSM: <strong className="text-text-primary">{csmName}</strong></span>
            <span>Accompagnement: <strong className="text-text-primary">{company.accompagnement ?? "—"}</strong></span>
            {company.domain && <span className="text-text-muted">{company.domain}</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono font-semibold text-text-primary">{formatCurrency(company.mrr)}</div>
          <div className="text-xs text-text-muted">MRR</div>
        </div>
      </div>

      {/* Product KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiMini icon={<TrendingUp className="w-4 h-4" />} label="ROI" value={`${company.roi.toFixed(1)}x`} color={company.roi > 2 ? "text-positive" : company.roi > 1 ? "text-text-primary" : "text-warning"} />
        <KpiMini icon={<Gift className="w-4 h-4" />} label="Rev. Loyalty" value={formatCurrency(company.revenueLoyalty, true)} />
        <KpiMini icon={<Users className="w-4 h-4" />} label="Rev. Referral" value={formatCurrency(company.revenueReferral, true)} />
        <KpiMini icon={<Target className="w-4 h-4" />} label="Missions" value={String(company.totalMissions)} />
        <KpiMini icon={<Star className="w-4 h-4" />} label="Score Loyalty" value={`${company.scoreLoyalty.toFixed(0)}/100`} color={company.scoreLoyalty > 50 ? "text-positive" : "text-warning"} />
        <KpiMini icon={<Star className="w-4 h-4" />} label="Score Referral" value={`${company.scoreReferral.toFixed(0)}/100`} color={company.scoreReferral > 50 ? "text-positive" : "text-warning"} />
      </div>

      {/* Health Score Breakdown */}
      <div className="card">
        <h3 className="text-sm font-medium text-text-secondary mb-3">Health Score — Breakdown</h3>
        <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
          {Object.entries(healthScore.breakdown).map(([key, value]) => (
            <div key={key} className="text-center">
              <div className={cn("text-lg font-mono font-semibold", value > 6 ? "text-positive" : value > 3 ? "text-warning" : "text-negative")}>
                {value}
              </div>
              <div className="text-[10px] text-text-muted capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Two columns: Deals + Tickets/Meetings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Deals timeline */}
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-card-border">
            <h3 className="text-sm font-medium text-text-secondary">
              Historique deals ({deals.length})
            </h3>
          </div>
          <div className="divide-y divide-card-border max-h-[400px] overflow-y-auto">
            {deals.length === 0 ? (
              <div className="p-4 text-sm text-text-muted text-center">Aucun deal</div>
            ) : deals.map((deal) => (
              <div key={deal.id} className="px-4 py-3 hover:bg-card-hover transition-colors">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-medium text-text-primary">{deal.name}</div>
                    <div className="flex items-center gap-2 mt-1">
                      {deal.attribution && (
                        <span
                          className="badge text-[10px]"
                          style={{
                            backgroundColor: `${ATTRIBUTION_COLORS[deal.attribution] ?? "#64748B"}20`,
                            color: ATTRIBUTION_COLORS[deal.attribution] ?? "#64748B",
                          }}
                        >
                          {ATTRIBUTION_LABELS[deal.attribution] ?? deal.attribution}
                        </span>
                      )}
                      <span className="text-xs text-text-muted">
                        {SALES_STAGE_LABELS[deal.stage] ?? deal.stage}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={cn("text-sm font-mono font-medium", deal.amount >= 0 ? "text-positive" : "text-negative")}>
                      {formatCurrency(deal.amount)}
                    </div>
                    <div className="text-[10px] text-text-muted">
                      {deal.operationDate ? formatDateFR(deal.operationDate) : deal.closeDate ? formatDateFR(deal.closeDate) : "—"}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tickets + Meetings */}
        <div className="space-y-4">
          {/* Intercom Tickets */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-card-border flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-text-muted" />
              <h3 className="text-sm font-medium text-text-secondary">
                Tickets support ({tickets.length})
              </h3>
            </div>
            <div className="divide-y divide-card-border max-h-[180px] overflow-y-auto">
              {tickets.length === 0 ? (
                <div className="p-4 text-sm text-text-muted text-center">
                  {process.env.NEXT_PUBLIC_INTERCOM_ENABLED === "true" ? "Aucun ticket" : "Intercom non configure"}
                </div>
              ) : tickets.map((ticket) => (
                <a
                  key={ticket.id}
                  href={ticket.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-4 py-2 hover:bg-card-hover transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "w-2 h-2 rounded-full",
                      ticket.state === "open" ? "bg-warning" : ticket.state === "snoozed" ? "bg-accent" : "bg-positive"
                    )} />
                    <span className="text-xs text-text-primary truncate max-w-[200px]">{ticket.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-muted">{formatDateFR(ticket.updatedAt)}</span>
                    <ExternalLink className="w-3 h-3 text-text-muted" />
                  </div>
                </a>
              ))}
            </div>
          </div>

          {/* Google Calendar Meetings */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-card-border flex items-center gap-2">
              <Calendar className="w-4 h-4 text-text-muted" />
              <h3 className="text-sm font-medium text-text-secondary">
                Meetings ({meetings.length})
              </h3>
            </div>
            <div className="divide-y divide-card-border max-h-[180px] overflow-y-auto">
              {meetings.length === 0 ? (
                <div className="p-4 text-sm text-text-muted text-center">
                  {process.env.NEXT_PUBLIC_GCAL_ENABLED === "true" ? "Aucun meeting" : "Google Calendar non configure"}
                </div>
              ) : meetings.map((meeting) => {
                const isPast = new Date(meeting.start) < new Date()
                return (
                  <div key={meeting.id} className="px-4 py-2 hover:bg-card-hover transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "w-2 h-2 rounded-full",
                          meeting.status === "cancelled" ? "bg-negative" : isPast ? "bg-positive" : "bg-accent"
                        )} />
                        <span className="text-xs text-text-primary truncate max-w-[200px]">{meeting.summary}</span>
                      </div>
                      <span className="text-[10px] text-text-muted">{formatDateFR(meeting.start)}</span>
                    </div>
                    {meeting.attendees.length > 0 && (
                      <div className="text-[10px] text-text-muted mt-0.5 pl-4 truncate">
                        {meeting.attendees.slice(0, 3).join(", ")}
                        {meeting.attendees.length > 3 && ` +${meeting.attendees.length - 3}`}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Product Scores Detail */}
      <div className="card">
        <h3 className="text-sm font-medium text-text-secondary mb-3">Metriques produit detaillees</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricRow label="Participation Rate (Loyalty)" value={`${company.participationRate.toFixed(1)}%`} />
          <MetricRow label="Rewards Conversion Rate" value={`${company.rewardsConversionRate.toFixed(1)}%`} />
          <MetricRow label="Points Usage Rate" value={`${company.pointsUsageRate.toFixed(1)}%`} />
          <MetricRow label="Referral Conversion Rate" value={`${company.referralConversionRate.toFixed(1)}%`} />
          <MetricRow label="New Clients (Referral)" value={`${company.newClientsRateReferral.toFixed(1)}%`} />
          <MetricRow label="Total Asked Referral" value={String(company.totalAskedReferral)} />
          <MetricRow label="Total Orders" value={String(company.totalOrders)} />
          <MetricRow label="Total Missions" value={String(company.totalMissions)} />
        </div>
      </div>
    </div>
  )
}

function KpiMini({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color?: string }) {
  return (
    <div className="card py-3 px-4">
      <div className="flex items-center gap-2 mb-1 text-text-muted">{icon}<span className="text-[10px] uppercase tracking-wider">{label}</span></div>
      <div className={cn("text-lg font-mono font-semibold", color ?? "text-text-primary")}>{value}</div>
    </div>
  )
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-text-muted">{label}</div>
      <div className="text-sm font-mono text-text-primary">{value}</div>
    </div>
  )
}

export default function AccountPage() {
  return (
    <div>
      <Suspense>
        <Header title="Fiche Client" subtitle="Detail du compte" />
      </Suspense>
      <Suspense>
        <AccountContent />
      </Suspense>
    </div>
  )
}
