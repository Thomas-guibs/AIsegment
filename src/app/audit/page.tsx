"use client"

import { Suspense, useState } from "react"
import { Header } from "@/components/layout/Header"
import { useFetch } from "@/lib/hooks"
import { formatCurrency, cn } from "@/lib/utils"
import { getCsmName, SALES_STAGE_LABELS } from "@/lib/constants"
import type { MetricsResponse } from "@/lib/engine/client-types"
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileWarning,
  Filter,
  History,
  LogOut,
  ShieldCheck,
  Wallet,
} from "lucide-react"

/**
 * Spec §9 — a remuneration calculation must account for everything it sets
 * aside. Six families of signals, each one a different fix in the CRM.
 */

function Section({
  icon,
  title,
  explanation,
  count,
  tone = "neutral",
  children,
}: {
  icon: React.ReactNode
  title: string
  explanation: string
  count: number
  tone?: "neutral" | "warning" | "danger" | "info"
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(count > 0 && tone !== "info")

  const toneClass = {
    neutral: "text-text-secondary",
    warning: "text-warning",
    danger: "text-negative",
    info: "text-accent",
  }[tone]

  return (
    <div className="card p-0 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-card-hover transition-colors"
      >
        <span className={cn("flex-shrink-0 mt-0.5", toneClass)}>{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-text-primary">{title}</h3>
            <span
              className={cn(
                "px-1.5 py-0.5 rounded text-[10px] font-mono font-medium",
                count === 0 ? "bg-card text-text-muted" : "bg-card-hover " + toneClass
              )}
            >
              {count}
            </span>
          </div>
          <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">{explanation}</p>
        </div>
        <span className="text-text-muted flex-shrink-0 mt-0.5">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
      </button>
      {open && <div className="border-t border-card-border">{children}</div>}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-xs text-text-muted text-center">{children}</p>
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={cn(
        "px-4 py-2 text-[10px] uppercase tracking-wide text-text-muted",
        right ? "text-right" : "text-left"
      )}
    >
      {children}
    </th>
  )
}

function AuditContent() {
  const [range, setRange] = useState<"6" | "12">("6")
  const [eligibility, setEligibility] = useState("strict")
  const { data, loading } = useFetch<MetricsResponse>("/api/metrics", {
    months: range,
    eligibility,
  })

  if (loading || !data) {
    return (
      <div className="p-6 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card skeleton h-24" />
        ))}
      </div>
    )
  }

  const d = data.diagnostics
  const s = d.summary

  return (
    <div className="p-6 space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-0.5 bg-card rounded-lg p-0.5 border border-card-border">
          {(["6", "12"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "px-2.5 py-1 text-[11px] rounded-md font-medium transition-colors",
                range === r ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"
              )}
            >
              {r} mois
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-text-muted">Eligibility</span>
          <div className="flex items-center gap-0.5 bg-card rounded-lg p-0.5 border border-card-border">
            {[
              { value: "strict", label: "Strict" },
              { value: "include_unset", label: "+ non renseigné" },
              { value: "all", label: "Tous" },
            ].map((o) => (
              <button
                key={o.value}
                onClick={() => setEligibility(o.value)}
                className={cn(
                  "px-2.5 py-1 text-[11px] rounded-md font-medium transition-colors whitespace-nowrap",
                  eligibility === o.value
                    ? "bg-accent text-white"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <span className="text-[10px] text-text-muted ml-auto font-mono">
          Snapshot du {new Date(data.capturedAt).toLocaleString("fr-FR")}
        </span>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Anomalies de saisie", value: s.anomalyCount, tone: "text-negative" },
          { label: "Hors périmètre", value: s.outOfScopeCount, tone: "text-text-secondary" },
          { label: "Sorties après churn", value: s.churnExitCount, tone: "text-warning" },
          { label: "Retenus malgré churn", value: s.churnVetoCount, tone: "text-warning" },
          {
            label: "MRR fantôme retiré",
            value: formatCurrency(s.ghostMrrRemoved, true),
            tone: "text-accent",
          },
        ].map((item) => (
          <div key={item.label} className="card">
            <p className="text-[10px] uppercase tracking-wide text-text-muted">{item.label}</p>
            <p className={cn("text-xl font-semibold font-mono mt-1", item.tone)}>{item.value}</p>
          </div>
        ))}
      </div>

      {/* 1 — data-entry anomalies */}
      <Section
        icon={<AlertTriangle className="w-4 h-4" />}
        title="Mouvements écartés, par motif"
        explanation="Anomalies de saisie : date de référence absente, eligibility manquante, montant nul, CSM non identifiable. Chacune est une correction à faire dans HubSpot."
        count={s.anomalyCount}
        tone="danger"
      >
        {d.rejectedByReason.length === 0 ? (
          <Empty>Aucun mouvement écarté pour anomalie sur la période.</Empty>
        ) : (
          <div className="divide-y divide-card-border">
            {d.rejectedByReason.map((group) => (
              <div key={group.reason} className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-text-primary">{group.label}</span>
                  <span className="text-xs font-mono text-text-muted">
                    {group.count} deal{group.count > 1 ? "s" : ""} ·{" "}
                    {formatCurrency(group.totalAmount, true)}
                  </span>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full">
                    <tbody className="divide-y divide-card-border/50">
                      {group.deals.map((deal) => (
                        <tr key={deal.id}>
                          <td className="py-1.5 pr-3 text-xs text-text-primary">
                            {deal.accountName ?? deal.name}
                          </td>
                          <td className="py-1.5 pr-3 text-xs text-text-muted capitalize">
                            {deal.type}
                          </td>
                          <td className="py-1.5 pr-3 text-xs font-mono text-text-muted">
                            {deal.operationDate ?? deal.paymentDate ?? "sans date"}
                          </td>
                          <td className="py-1.5 text-xs font-mono text-text-secondary text-right">
                            {formatCurrency(deal.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 2 — out of scope: information, NOT a defect */}
      <Section
        icon={<Filter className="w-4 h-4" />}
        title="Deals hors périmètre, par stage"
        explanation="Information de pipeline, PAS un défaut : un deal en cours de négociation n'a simplement pas à compter. Listé séparément pour ne pas polluer le rapport qualité."
        count={s.outOfScopeCount}
        tone="info"
      >
        {d.outOfScopeByStage.length === 0 ? (
          <Empty>Aucun deal hors périmètre sur la période.</Empty>
        ) : (
          <table className="w-full">
            <thead className="bg-background/50">
              <tr>
                <Th>Stage</Th>
                <Th>Identifiant interne</Th>
                <Th right>Deals</Th>
                <Th right>Montant</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {d.outOfScopeByStage.map((group) => (
                <tr key={group.stage}>
                  <td className="px-4 py-2 text-xs text-text-primary">
                    {SALES_STAGE_LABELS[group.stage] ?? group.label}
                  </td>
                  <td className="px-4 py-2 text-xs font-mono text-text-muted">{group.stage}</td>
                  <td className="px-4 py-2 text-xs font-mono text-text-secondary text-right">
                    {group.count}
                  </td>
                  <td className="px-4 py-2 text-xs font-mono text-text-secondary text-right">
                    {formatCurrency(group.totalAmount, true)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* 3 — never billed */}
      <Section
        icon={<Wallet className="w-4 h-4" />}
        title="Comptes sans facturation"
        explanation="Ils portent un MRR et un CSM, mais aucune effective payment date sur aucun de leurs deals : ils ne sont comptés nulle part."
        count={s.neverBilledCount}
        tone="warning"
      >
        {d.neverBilled.length === 0 ? (
          <Empty>Tous les comptes du périmètre ont une date de facturation.</Empty>
        ) : (
          <table className="w-full">
            <thead className="bg-background/50">
              <tr>
                <Th>Compte</Th>
                <Th>CSM</Th>
                <Th right>MRR porté</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {d.neverBilled.map((item) => (
                <tr key={item.accountId}>
                  <td className="px-4 py-2 text-xs text-text-primary">{item.accountName}</td>
                  <td className="px-4 py-2 text-xs text-text-muted">{getCsmName(item.csmId)}</td>
                  <td className="px-4 py-2 text-xs font-mono text-text-secondary text-right">
                    {formatCurrency(item.mrr)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* 4 — churn exits */}
      <Section
        icon={<LogOut className="w-4 h-4" />}
        title="Comptes sortis après churn"
        explanation={`total_revenue n'est jamais remis à zéro quand un client part. Ces comptes ont été retirés du portefeuille — ${formatCurrency(s.ghostMrrRemoved, true)} de MRR fantôme. Ceux sortis sur la seule phase (${s.churnExitsWithoutDealCount}) n'ont aucun deal de churn décompté : le NRR n'a jamais enregistré la perte, il manque le deal dans le CRM.`}
        count={s.churnExitCount}
        tone="warning"
      >
        {d.churnExits.length === 0 ? (
          <Empty>Aucune sortie de portefeuille sur la période.</Empty>
        ) : (
          <table className="w-full">
            <thead className="bg-background/50">
              <tr>
                <Th>Compte</Th>
                <Th>CSM</Th>
                <Th>Phase</Th>
                <Th>Sorti sur</Th>
                <Th>Mois</Th>
                <Th right>MRR retiré</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {d.churnExits.map((exit) => (
                <tr key={exit.accountId}>
                  <td className="px-4 py-2 text-xs text-text-primary">{exit.accountName}</td>
                  <td className="px-4 py-2 text-xs text-text-muted">
                    {exit.csmId ? getCsmName(exit.csmId) : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-text-muted capitalize">
                    {exit.phase ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {exit.via === "phase" ? (
                      <span className="text-negative" title="Aucun deal de churn décompté — la perte n'a jamais frappé le NRR.">
                        phase seule
                      </span>
                    ) : exit.via === "both" ? (
                      <span className="text-text-muted">deal + phase</span>
                    ) : (
                      <span className="text-text-muted">deal de churn</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs font-mono text-text-muted">{exit.month}</td>
                  <td className="px-4 py-2 text-xs font-mono text-text-secondary text-right">
                    {formatCurrency(exit.mrr)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* 5 — vetoes */}
      <Section
        icon={<ShieldCheck className="w-4 h-4" />}
        title="Comptes retenus malgré un churn"
        explanation="Phase active ET perte partielle : le deal est attribué Churn alors qu'il n'est qu'une baisse de MRR. Le montant reste soustrait du NRR, seule la sortie est annulée. À repasser en Downsell dans HubSpot."
        count={s.churnVetoCount}
        tone="warning"
      >
        {d.churnVetoes.length === 0 ? (
          <Empty>Aucun churn mal attribué détecté sur la période.</Empty>
        ) : (
          <table className="w-full">
            <thead className="bg-background/50">
              <tr>
                <Th>Compte</Th>
                <Th>CSM</Th>
                <Th>Phase</Th>
                <Th right>Churn décompté</Th>
                <Th right>MRR du compte</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {d.churnVetoes.map((veto) => (
                <tr key={veto.accountId}>
                  <td className="px-4 py-2 text-xs text-text-primary">{veto.accountName}</td>
                  <td className="px-4 py-2 text-xs text-text-muted">
                    {veto.csmId ? getCsmName(veto.csmId) : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-text-muted capitalize">
                    {veto.phase ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-xs font-mono text-warning text-right">
                    {formatCurrency(veto.churnedAmount)}
                  </td>
                  <td className="px-4 py-2 text-xs font-mono text-text-secondary text-right">
                    {formatCurrency(veto.mrr)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* 6 — truncated history */}
      <Section
        icon={<History className="w-4 h-4" />}
        title="Comptes invisibles faute d'historique"
        explanation="Leur historique de propriété ou de MRR ne remonte pas jusqu'au mois observé. C'est une limite de la donnée, pas une décision de calcul — l'option backfill fait remonter la plus ancienne valeur connue."
        count={s.truncatedCount}
        tone="info"
      >
        {d.truncatedHistory.length === 0 ? (
          <Empty>Tous les historiques couvrent la période analysée.</Empty>
        ) : (
          <table className="w-full">
            <thead className="bg-background/50">
              <tr>
                <Th>Compte</Th>
                <Th>Mois observé</Th>
                <Th>Historique à partir de</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {d.truncatedHistory.map((item) => (
                <tr key={item.accountId}>
                  <td className="px-4 py-2 text-xs text-text-primary">{item.accountName}</td>
                  <td className="px-4 py-2 text-xs font-mono text-text-muted">{item.month}</td>
                  <td className="px-4 py-2 text-xs font-mono text-text-muted">
                    {item.earliest?.slice(0, 10) ?? "inconnu"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Manual corrections (§10) */}
      <Section
        icon={<FileWarning className="w-4 h-4" />}
        title="Corrections manuelles"
        explanation="Une saisie fausse se corrige dans le CRM, mais une période se lit à date. Chaque correction porte un motif obligatoire et conserve la valeur d'origine. La source de vérité reste HubSpot."
        count={
          d.overrides.applied.length + d.overrides.refused.length + d.overrides.orphaned.length
        }
        tone="info"
      >
        {d.overrides.applied.length === 0 &&
        d.overrides.refused.length === 0 &&
        d.overrides.orphaned.length === 0 ? (
          <Empty>Aucune correction manuelle en vigueur — le calcul lit le CRM tel quel.</Empty>
        ) : (
          <div className="divide-y divide-card-border">
            {d.overrides.applied.length > 0 && (
              <table className="w-full">
                <thead className="bg-background/50">
                  <tr>
                    <Th>Deal</Th>
                    <Th>Motif</Th>
                    <Th>Auteur</Th>
                    <Th right>Origine</Th>
                    <Th right>Retenu</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {d.overrides.applied.map((o) => (
                    <tr key={o.dealId}>
                      <td className="px-4 py-2 text-xs text-text-primary">
                        {o.dealName ?? o.dealId}
                      </td>
                      <td className="px-4 py-2 text-xs text-text-secondary">{o.reason}</td>
                      <td className="px-4 py-2 text-xs text-text-muted">{o.author}</td>
                      <td className="px-4 py-2 text-xs font-mono text-text-muted text-right line-through">
                        {o.originalAmount != null ? formatCurrency(o.originalAmount) : "—"}
                      </td>
                      <td className="px-4 py-2 text-xs font-mono text-accent text-right">
                        {o.amount != null ? formatCurrency(o.amount) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {d.overrides.refused.map((r, i) => (
              <p key={i} className="px-4 py-2 text-xs text-negative">
                Refusée au chargement : {r.problem}
              </p>
            ))}
            {d.overrides.orphaned.map((o) => (
              <p key={o.dealId} className="px-4 py-2 text-xs text-warning">
                Correction sans deal correspondant : {o.dealId} ({o.reason})
              </p>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

export default function AuditPage() {
  return (
    <div>
      <Suspense>
        <Header
          title="Audit"
          subtitle="Tout ce que le calcul écarte, et pourquoi"
        />
      </Suspense>
      <Suspense>
        <AuditContent />
      </Suspense>
    </div>
  )
}
