"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { Header } from "@/components/layout/Header"
import { useFetch } from "@/lib/hooks"
import { cn, formatCurrency } from "@/lib/utils"
import { CSM_TEAM } from "@/lib/constants"
import { Sparkles, Flame, ExternalLink, Users, ShoppingCart, Loader2, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react"
import { toast } from "sonner"

interface UpsellSignal {
  parentCompanyId: string
  parentName: string
  parentMrr: number
  parentCsmId: string | null
  parentCsmName: string | null
  enrichedAt: string
  siblingName: string
  siblingSiren: string
  domain: string | null
  isClient: boolean
  isEcommerce: boolean
  platform: string | null
  fit: "strong" | "partial" | "none" | null
  icpScore: number
  icpSignals: string[]
  role: string | null
}

interface EmptyEnrichment {
  parentCompanyId: string
  parentName: string
  parentMrr: number
  parentCsmName: string | null
  enrichedAt: string
  totalSiblings: number
  excludedCount: number
  clientCount: number
  reason: string
}

interface UpsellSignalsData {
  dbConfigured: boolean
  kpis: {
    totalSignals: number
    hot: number
    warm: number
    cold: number
    ecommerceConfirmed: number
    enrichedCompanies: number
    pendingCompanies: number
  }
  signals: UpsellSignal[]
  enrichedWithoutSignals: EmptyEnrichment[]
}

function scoreColor(score: number, isClient: boolean): string {
  if (isClient) return "bg-accent text-white"
  if (score >= 70) return "bg-positive/20 text-positive"
  if (score >= 40) return "bg-warning/20 text-warning"
  return "bg-card-hover text-text-muted"
}

function ScoreBadge({ score, isClient }: { score: number; isClient: boolean }) {
  return (
    <span className={cn("inline-flex items-center justify-center w-10 h-7 rounded-md text-xs font-semibold font-mono", scoreColor(score, isClient))}>
      {isClient ? "✓" : score}
    </span>
  )
}

function PlatformBadge({ platform }: { platform: string | null }) {
  if (!platform) return <span className="text-2xs text-text-muted">—</span>
  const isStrong = ["Shopify", "PrestaShop"].includes(platform)
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded text-2xs font-medium",
      isStrong ? "bg-positive/15 text-positive" : "bg-card-hover text-text-secondary"
    )}>
      {platform}
    </span>
  )
}

function UpsellSignalsContent() {
  const [csmId, setCsmId] = useState<string>("")
  const [minScore, setMinScore] = useState<number>(0)
  const [ecommerceOnly, setEcommerceOnly] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [lastEnrich, setLastEnrich] = useState<{ kind: "info" | "error"; text: string } | null>(null)
  const [showEmpty, setShowEmpty] = useState(false)

  const params: Record<string, string> = {}
  if (csmId) params.csmId = csmId
  if (minScore > 0) params.minScore = String(minScore)
  if (ecommerceOnly) params.ecommerceOnly = "true"

  const { data, loading, refetch } = useFetch<UpsellSignalsData>("/api/upsell-signals", params)

  const handleEnrichNext = async () => {
    setEnriching(true)
    setLastEnrich(null)
    try {
      const res = await fetch("/api/upsell-signals/enrich-next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csmId: csmId || undefined }),
      })
      let json: { done?: boolean; error?: string; details?: string; name?: string; signalsCount?: number; hotCount?: number; message?: string }
      try {
        json = await res.json()
      } catch {
        setLastEnrich({ kind: "error", text: `HTTP ${res.status} : réponse invalide (probablement un timeout Vercel >60s)` })
        return
      }
      if (!res.ok || json.error) {
        const msg = `Erreur ${res.status} : ${json.error ?? "inconnue"}${json.details ? ` — ${json.details}` : ""}`
        setLastEnrich({ kind: "error", text: msg })
        toast.error(msg)
      } else if (json.done) {
        const msg = json.message ?? "Tous les comptes sont enrichis"
        setLastEnrich({ kind: "info", text: msg })
        toast.success(msg)
      } else {
        const msg = `${json.name} enrichi : ${json.signalsCount} signaux dont ${json.hotCount} hot`
        setLastEnrich({ kind: "info", text: msg })
        toast.success(msg)
      }
      refetch()
    } catch (e) {
      setLastEnrich({ kind: "error", text: `Erreur réseau : ${String(e).slice(0, 200)}` })
    } finally {
      setEnriching(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-24" />)}
        </div>
        <div className="skeleton h-16" />
        <div className="skeleton h-96" />
      </div>
    )
  }

  if (!data) return <div className="p-6 text-text-muted">Aucune donnée</div>

  const { kpis, signals } = data
  const totalCompanies = kpis.enrichedCompanies + kpis.pendingCompanies
  const progressPct = totalCompanies > 0 ? Math.round((kpis.enrichedCompanies / totalCompanies) * 100) : 0

  return (
    <div className="p-6 space-y-6">
      {!data.dbConfigured && (
        <div className="card border-warning/40 bg-warning/10">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
            <div className="text-[13px] text-text-primary">
              <div className="font-semibold mb-1">Supabase n'est pas configuré</div>
              <div className="text-text-secondary space-y-1">
                <div>
                  Le bouton d'enrichissement est désactivé tant que la base de données n'est pas branchée.
                </div>
                <div>
                  1. Vérifie que <span className="font-mono">SUPABASE_URL</span> et <span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span> sont injectés (Vercel le fait automatiquement quand Supabase est connecté via Storage).
                </div>
                <div>
                  2. Crée la table <span className="font-mono">upsell_enrichments</span> dans le SQL editor Supabase (DDL dans <span className="font-mono">src/lib/enrichment/storage.ts</span>).
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-accent" />
            <div className="text-2xs text-text-muted uppercase">Total signaux</div>
          </div>
          <div className="text-2xl font-mono font-bold text-text-primary">{kpis.totalSignals}</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <Flame className="w-4 h-4 text-positive" />
            <div className="text-2xs text-text-muted uppercase">Hot (≥70)</div>
          </div>
          <div className="text-2xl font-mono font-bold text-positive">{kpis.hot}</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <Flame className="w-4 h-4 text-warning" />
            <div className="text-2xs text-text-muted uppercase">Warm (40-69)</div>
          </div>
          <div className="text-2xl font-mono font-bold text-warning">{kpis.warm}</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <ShoppingCart className="w-4 h-4 text-accent" />
            <div className="text-2xs text-text-muted uppercase">E-commerce confirmés</div>
          </div>
          <div className="text-2xl font-mono font-bold text-text-primary">{kpis.ecommerceConfirmed}</div>
        </div>
      </div>

      {/* Progress + Action */}
      <div className="card">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-text-muted" />
              <span className="text-[13px] text-text-secondary">
                <span className="font-semibold text-text-primary">{kpis.enrichedCompanies}</span>
                {" / "}
                <span>{totalCompanies}</span>
                {" comptes enrichis "}
                <span className="text-text-muted">({progressPct}%)</span>
              </span>
            </div>
            <div className="h-2 bg-card-hover rounded-full overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={csmId}
              onChange={(e) => setCsmId(e.target.value)}
              className="bg-card-hover border border-card-border rounded-md px-3 py-2 text-[13px] text-text-primary"
            >
              <option value="">Tous les CSMs</option>
              {CSM_TEAM.map((csm) => (
                <option key={csm.id} value={csm.id}>{csm.name}</option>
              ))}
            </select>

            <button
              onClick={handleEnrichNext}
              disabled={enriching || kpis.pendingCompanies === 0 || !data.dbConfigured}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-md text-[13px] font-medium transition-colors",
                enriching
                  ? "bg-card-hover text-text-muted cursor-wait"
                  : kpis.pendingCompanies === 0 || !data.dbConfigured
                  ? "bg-card-hover text-text-muted cursor-not-allowed"
                  : "bg-accent text-white hover:bg-accent/90"
              )}
            >
              {enriching ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Enrichissement…
                </>
              ) : kpis.pendingCompanies === 0 ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Tout enrichi
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Enrichir prochain compte
                </>
              )}
            </button>
          </div>
        </div>

        {lastEnrich && (
          <div className={cn(
            "mt-3 px-3 py-2 rounded-md text-2xs",
            lastEnrich.kind === "error"
              ? "bg-negative/15 text-negative border border-negative/30"
              : "bg-card-hover text-text-secondary"
          )}>
            {lastEnrich.text}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-2xs text-text-muted uppercase">Score min</span>
          <input
            type="range"
            min={0}
            max={100}
            step={10}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="w-32"
          />
          <span className="text-[13px] font-mono w-8 text-text-primary">{minScore}</span>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={ecommerceOnly}
            onChange={(e) => setEcommerceOnly(e.target.checked)}
            className="rounded"
          />
          E-commerce confirmé uniquement
        </label>
        <span className="text-2xs text-text-muted ml-auto">
          {signals.length} signaux affichés
        </span>
      </div>

      {/* Main signals table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-row-alt">
              <tr>
                <th className="px-4 py-2 text-left text-2xs text-text-muted">Score</th>
                <th className="px-4 py-2 text-left text-2xs text-text-muted">Marque</th>
                <th className="px-4 py-2 text-left text-2xs text-text-muted">Domaine</th>
                <th className="px-4 py-2 text-left text-2xs text-text-muted">Plateforme</th>
                <th className="px-4 py-2 text-left text-2xs text-text-muted">Parent client</th>
                <th className="px-4 py-2 text-left text-2xs text-text-muted">CSM</th>
                <th className="px-4 py-2 text-left text-2xs text-text-muted">Reasoning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {signals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-text-muted text-[13px]">
                    {kpis.enrichedCompanies === 0
                      ? "Aucun compte n'a encore été enrichi. Clique sur 'Enrichir prochain compte' pour démarrer."
                      : "Aucun signal ne correspond aux filtres."}
                  </td>
                </tr>
              ) : (
                signals.map((s, i) => {
                  const reasoning = s.icpSignals.find((sig) => sig.startsWith("E-commerce (Claude):"))?.replace("E-commerce (Claude): ", "") ?? s.icpSignals.join(" · ")
                  return (
                    <tr key={`${s.parentCompanyId}-${s.siblingSiren}-${i}`} className="hover:bg-card-hover transition-colors">
                      <td className="px-4 py-2.5">
                        <ScoreBadge score={s.icpScore} isClient={s.isClient} />
                      </td>
                      <td className="px-4 py-2.5 text-[13px] font-medium text-text-primary">
                        {s.siblingName}
                      </td>
                      <td className="px-4 py-2.5 text-[13px]">
                        {s.domain ? (
                          <a
                            href={`https://${s.domain}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-accent hover:underline"
                          >
                            {s.domain}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <PlatformBadge platform={s.platform} />
                      </td>
                      <td className="px-4 py-2.5 text-[13px]">
                        <Link
                          href={`/account/${s.parentCompanyId}`}
                          className="text-text-primary hover:text-accent transition-colors"
                        >
                          {s.parentName}
                        </Link>
                        <div className="text-2xs text-text-muted font-mono">
                          {formatCurrency(s.parentMrr, true)} MRR
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[13px] text-text-secondary">
                        {s.parentCsmName ?? "—"}
                      </td>
                      <td
                        className="px-4 py-2.5 text-2xs text-text-muted max-w-md truncate"
                        title={reasoning}
                      >
                        {reasoning.slice(0, 100)}{reasoning.length > 100 ? "…" : ""}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Enriched companies that produced no actionable signal */}
      {data.enrichedWithoutSignals.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <button
            onClick={() => setShowEmpty(!showEmpty)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-card-hover transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-text-primary">
                Comptes enrichis sans signal pertinent
              </span>
              <span className="text-2xs text-text-muted bg-card-hover px-2 py-0.5 rounded-full">
                {data.enrichedWithoutSignals.length}
              </span>
            </div>
            {showEmpty ? (
              <ChevronUp className="w-4 h-4 text-text-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-text-muted" />
            )}
          </button>
          {showEmpty && (
            <div className="border-t border-card-border">
              <div className="px-4 py-2 text-2xs text-text-muted bg-row-alt">
                Ces comptes ont été enrichis mais n'ont produit aucune opportunité d'upsell exploitable
                (entreprises liées toutes exclues, déjà clientes, ou aucune entreprise liée détectée).
                Ils ne seront pas re-enrichis.
              </div>
              <table className="w-full">
                <thead className="bg-row-alt">
                  <tr>
                    <th className="px-4 py-2 text-left text-2xs text-text-muted">Compte</th>
                    <th className="px-4 py-2 text-left text-2xs text-text-muted">MRR</th>
                    <th className="px-4 py-2 text-left text-2xs text-text-muted">CSM</th>
                    <th className="px-4 py-2 text-left text-2xs text-text-muted">Raison</th>
                    <th className="px-4 py-2 text-left text-2xs text-text-muted">Enrichi le</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {data.enrichedWithoutSignals.map((e) => (
                    <tr key={e.parentCompanyId} className="hover:bg-card-hover transition-colors">
                      <td className="px-4 py-2.5 text-[13px]">
                        <Link
                          href={`/account/${e.parentCompanyId}`}
                          className="text-text-primary hover:text-accent"
                        >
                          {e.parentName}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-[13px] font-mono text-text-secondary">
                        {formatCurrency(e.parentMrr, true)}
                      </td>
                      <td className="px-4 py-2.5 text-[13px] text-text-secondary">
                        {e.parentCsmName ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-2xs text-text-muted">
                        {e.reason}
                      </td>
                      <td className="px-4 py-2.5 text-2xs text-text-muted font-mono">
                        {new Date(e.enrichedAt).toLocaleDateString("fr-FR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function UpsellSignalsPage() {
  return (
    <div>
      <Suspense>
        <Header
          title="Upsell Signals"
          subtitle="Opportunités d'upsell détectées via cartographie Pappers + Claude"
        />
      </Suspense>
      <Suspense>
        <UpsellSignalsContent />
      </Suspense>
    </div>
  )
}
