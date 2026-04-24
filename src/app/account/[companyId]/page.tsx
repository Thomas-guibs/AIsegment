"use client"

import { Suspense, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Header } from "@/components/layout/Header"
import { useFetch } from "@/lib/hooks"
import type { AccountDetail, UpsellSignals } from "@/lib/types"
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
  Sparkles,
  Store,
  Globe,
  Building,
  RefreshCw,
  Flame,
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

      {/* Upsell Signals */}
      <UpsellSignalsCard companyId={company.id} signals={company.upsellSignals} />

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

function UpsellSignalsCard({ companyId, signals: initialSignals }: { companyId: string; signals: UpsellSignals | null }) {
  const [signals, setSignals] = useState<UpsellSignals | null>(initialSignals)
  const [enriching, setEnriching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [debug, setDebug] = useState<Record<string, unknown> | null>(null)

  const handleEnrich = async () => {
    setEnriching(true)
    setError(null)
    try {
      const response = await fetch(`/api/account/${companyId}/enrich`, { method: "POST" })
      const data = await response.json()
      if (data.debug) setDebug(data.debug)
      if (data.success && data.signals) {
        setSignals(data.signals)
      } else {
        setError(data.error ?? "Enrichissement echoue")
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setEnriching(false)
    }
  }

  if (!signals) {
    return (
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-medium text-text-secondary">Upsell Signals</h3>
            </div>
            <p className="text-xs text-text-muted">Ce compte n'a pas encore été enrichi.</p>
          </div>
          <button
            onClick={handleEnrich}
            disabled={enriching}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={cn("w-3 h-3", enriching && "animate-spin")} />
            {enriching ? "Enrichissement..." : "Enrichir maintenant"}
          </button>
        </div>
        {error && <p className="text-xs text-negative mt-2">{error}</p>}
      </div>
    )
  }

  const gradeColors = {
    hot: "bg-red-50 text-red-600 border-red-200",
    warm: "bg-amber-50 text-amber-600 border-amber-200",
    cold: "bg-slate-50 text-slate-500 border-slate-200",
  }

  const gradeIcons = {
    hot: <Flame className="w-3.5 h-3.5" />,
    warm: <TrendingUp className="w-3.5 h-3.5" />,
    cold: <Sparkles className="w-3.5 h-3.5" />,
  }

  const nonClientSiblings = signals.siblingBrands.filter((s) => !s.isClient)
  const clientSiblings = signals.siblingBrands.filter((s) => s.isClient)

  return (
    <div className="card">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium text-text-secondary">Upsell Signals</h3>
          <div className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold", gradeColors[signals.grade])}>
            {gradeIcons[signals.grade]}
            {signals.score}/100
          </div>
        </div>
        <div className="flex items-center gap-2">
          {signals.enrichedAt && (
            <span className="text-2xs text-text-muted">
              Enrichi le {formatDateFR(signals.enrichedAt)}
            </span>
          )}
          <button
            onClick={handleEnrich}
            disabled={enriching}
            className="flex items-center gap-1 px-2 py-1 text-2xs text-text-secondary hover:text-accent hover:bg-card-hover rounded-lg transition-colors disabled:opacity-50"
            title="Rafraichir l'enrichissement"
          >
            <RefreshCw className={cn("w-3 h-3", enriching && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Parent company + siblings */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Building className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-2xs font-medium text-text-muted uppercase tracking-wider">Groupe / maison mere</span>
          </div>
          {signals.parentCompany ? (
            <>
              <div className="text-sm font-medium text-text-primary mb-1">{signals.parentCompany}</div>
              {signals.parentSiren && (
                <a
                  href={`https://www.pappers.fr/entreprise/${signals.parentSiren}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-2xs text-accent hover:underline inline-flex items-center gap-1"
                >
                  SIREN {signals.parentSiren}
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </>
          ) : (
            <div className="text-xs text-text-muted">Aucun groupe detecte (entreprise independante)</div>
          )}

          {/* Related companies via dirigeants — shown regardless of parent group */}
          {nonClientSiblings.length > 0 && (
            <div className="mt-3">
              <div className="text-2xs text-text-muted mb-2">
                {nonClientSiblings.length} entreprise{nonClientSiblings.length > 1 ? "s" : ""} liee{nonClientSiblings.length > 1 ? "s" : ""} via les dirigeants
              </div>
              <div className="space-y-1.5">
                {nonClientSiblings.map((sib) => {
                  const score = sib.icpScore ?? 0
                  const scoreColor = score >= 50 ? "text-positive bg-positive/10 border-positive/20" :
                    score >= 20 ? "text-warning bg-warning/10 border-warning/20" :
                    "text-text-muted bg-gray-100 border-gray-200"
                  return (
                    <div key={sib.siren} className="flex items-center gap-2 text-2xs">
                      <span className={cn("inline-flex items-center justify-center w-8 h-5 rounded border font-mono font-semibold flex-shrink-0", scoreColor)}>
                        {score}
                      </span>
                      <span className={cn("font-medium truncate max-w-[200px]", score >= 50 ? "text-text-primary" : "text-text-secondary")}>
                        {sib.name}
                      </span>
                      {sib.isEcommerce && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full bg-positive/10 text-positive border border-positive/20 flex-shrink-0">
                          <Store className="w-2.5 h-2.5" />Ecommerce
                        </span>
                      )}
                      {sib.icpSignals && sib.icpSignals.length > 0 && (
                        <span className="text-text-muted truncate" title={sib.icpSignals.join(" | ")}>
                          {sib.icpSignals.filter((s) => !s.startsWith("Site:")).slice(0, 1).join(" · ")}
                        </span>
                      )}
                      <a
                        href={`https://www.pappers.fr/entreprise/${sib.siren}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto text-text-muted hover:text-accent flex-shrink-0"
                      >
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {clientSiblings.length > 0 && (
            <div className="mt-2">
              <div className="text-2xs text-text-muted mb-1">
                Deja clientes
              </div>
              <div className="flex flex-wrap gap-1">
                {clientSiblings.map((sib) => (
                  <Link
                    key={sib.siren}
                    href={sib.hubspotCompanyId ? `/account/${sib.hubspotCompanyId}` : "#"}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-positive/10 text-positive text-2xs rounded-full border border-positive/20 hover:bg-positive/20 transition-colors"
                  >
                    {sib.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Stores + Languages */}
        <div className="space-y-3">
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Store className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-2xs font-medium text-text-muted uppercase tracking-wider">Boutiques physiques</span>
            </div>
            <div className="text-sm font-medium text-text-primary">
              {signals.storesCount > 0 ? `${signals.storesCount} boutique${signals.storesCount > 1 ? "s" : ""} detectee${signals.storesCount > 1 ? "s" : ""}` : "Aucune boutique detectee"}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Globe className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-2xs font-medium text-text-muted uppercase tracking-wider">Langues / sous-sites</span>
            </div>
            {signals.languages.length > 0 ? (
              <>
                <div className="flex flex-wrap gap-1 mb-2">
                  {signals.languages.map((lang) => (
                    <span key={lang} className="inline-flex px-2 py-0.5 bg-sky-50 text-sky-600 text-2xs rounded-full border border-sky-200 font-medium uppercase">
                      {lang}
                    </span>
                  ))}
                </div>
                {signals.subsites.length > 0 && (
                  <div className="space-y-0.5">
                    {signals.subsites.slice(0, 5).map((s) => (
                      <a
                        key={s.url}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-2xs text-accent hover:underline inline-flex items-center gap-1 block"
                      >
                        [{s.lang.toUpperCase()}] {new URL(s.url).hostname}{new URL(s.url).pathname !== "/" ? new URL(s.url).pathname : ""}
                        <ExternalLink className="w-2.5 h-2.5 inline" />
                      </a>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-text-muted">Mono-langue</div>
            )}
          </div>
        </div>
      </div>

      {/* Recommendations */}
      {(nonClientSiblings.length > 0 || signals.storesCount > 10 || signals.languages.length > 1) && (
        <div className="mt-4 pt-4 border-t border-card-border">
          <div className="text-2xs font-medium text-text-muted uppercase tracking-wider mb-2">Opportunites identifiees</div>
          <ul className="space-y-1 text-xs text-text-primary">
            {nonClientSiblings.length > 0 && (() => {
              const ecomSiblings = nonClientSiblings.filter((s) => s.isEcommerce)
              return (
                <li className="flex items-start gap-2">
                  <span className="text-accent mt-0.5">•</span>
                  <span>
                    <strong>{nonClientSiblings.length} entreprise{nonClientSiblings.length > 1 ? "s" : ""}</strong> liee{nonClientSiblings.length > 1 ? "s" : ""} via les dirigeants
                    {ecomSiblings.length > 0 && (
                      <>, dont <strong className="text-accent">{ecomSiblings.length} ecommerce{ecomSiblings.length > 1 ? "s" : ""}</strong> (ICP Loyoly)</>
                    )}
                  </span>
                </li>
              )
            })()}
            {signals.storesCount > 10 && (
              <li className="flex items-start gap-2">
                <span className="text-accent mt-0.5">•</span>
                <span>
                  Reseau de <strong>{signals.storesCount} boutiques</strong> — potentiel d'upgrade du plan loyalty
                </span>
              </li>
            )}
            {signals.languages.length > 1 && (
              <li className="flex items-start gap-2">
                <span className="text-accent mt-0.5">•</span>
                <span>
                  Presence sur <strong>{signals.languages.length} marches</strong> ({signals.languages.join(", ").toUpperCase()}) — possible ouverture de programmes par pays
                </span>
              </li>
            )}
          </ul>
        </div>
      )}

      {error && <p className="text-xs text-negative mt-3">{error}</p>}

      {debug && (
        <details className="mt-3 text-2xs">
          <summary className="cursor-pointer text-text-muted hover:text-text-primary">Debug trace</summary>
          <pre className="mt-2 p-2 bg-background rounded border border-card-border overflow-x-auto text-2xs font-mono">
            {JSON.stringify(debug, null, 2)}
          </pre>
        </details>
      )}
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
