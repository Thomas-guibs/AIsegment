"use client"

import { Suspense, useState, useMemo } from "react"
import Link from "next/link"
import { Header } from "@/components/layout/Header"
import { useFetch } from "@/lib/hooks"
import type { Company } from "@/lib/types"
import { cn, formatCurrency } from "@/lib/utils"
import { getCsmName, CUSTOMER_PHASE_LABELS } from "@/lib/constants"
import {
  Search,
  Building2,
  ArrowUpRight,
  Heart,
  Star,
  ChevronRight,
  Filter,
} from "lucide-react"

const STAGE_COLORS: Record<string, string> = {
  Run: "bg-positive/15 text-positive",
  Activated: "bg-accent/15 text-accent",
  Onboarding: "bg-warning/15 text-warning",
  "To come": "bg-text-muted/15 text-text-secondary",
  New: "bg-card-border text-text-muted",
}

const PLAN_COLORS: Record<string, string> = {
  Enterprise: "bg-purple-500/15 text-purple-400",
  Premium: "bg-accent/15 text-accent",
  Lite: "bg-card-border text-text-secondary",
}

function AccountsContent() {
  const { data, loading } = useFetch<{ companies: Company[] }>("/api/companies")
  const [search, setSearch] = useState("")
  const [stageFilter, setStageFilter] = useState<string | null>(null)
  const [planFilter, setPlanFilter] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<"mrr" | "name" | "roi">("mrr")

  const companies = data?.companies ?? []

  const filtered = useMemo(() => {
    let result = companies

    // Text search
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.domain ?? "").toLowerCase().includes(q) ||
          (c.plan ?? "").toLowerCase().includes(q)
      )
    }

    // Stage filter
    if (stageFilter) {
      result = result.filter((c) => c.customerStage === stageFilter)
    }

    // Plan filter
    if (planFilter) {
      result = result.filter((c) => c.plan === planFilter)
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (sortBy === "mrr") return b.mrr - a.mrr
      if (sortBy === "roi") return b.roi - a.roi
      return a.name.localeCompare(b.name)
    })

    return result
  }, [companies, search, stageFilter, planFilter, sortBy])

  // Aggregate stats
  const stages = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of companies) {
      const stage = c.customerStage ?? "Unknown"
      counts[stage] = (counts[stage] ?? 0) + 1
    }
    return counts
  }, [companies])

  const plans = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of companies) {
      const plan = c.plan ?? "Unknown"
      counts[plan] = (counts[plan] ?? 0) + 1
    }
    return counts
  }, [companies])

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="skeleton h-12" />
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-10" />)}
        </div>
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-16" />)}
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      {/* Search + filters */}
      <div className="flex flex-col md:flex-row gap-3">
        {/* Search bar */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un compte (nom, domaine, plan...)"
            className="w-full h-10 pl-10 pr-4 rounded-lg bg-card border border-card-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "mrr" | "name" | "roi")}
          className="h-10 px-3 rounded-lg bg-card border border-card-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
        >
          <option value="mrr">Tri: MRR</option>
          <option value="roi">Tri: ROI</option>
          <option value="name">Tri: Nom</option>
        </select>
      </div>

      {/* Stage filter chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setStageFilter(null)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            !stageFilter ? "bg-accent text-white" : "bg-card border border-card-border text-text-secondary hover:text-text-primary"
          )}
        >
          Tous ({companies.length})
        </button>
        {["Run", "Activated", "Onboarding", "To come", "New"].map((stage) => (
          <button
            key={stage}
            onClick={() => setStageFilter(stageFilter === stage ? null : stage)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              stageFilter === stage
                ? "bg-accent text-white"
                : "bg-card border border-card-border text-text-secondary hover:text-text-primary"
            )}
          >
            {CUSTOMER_PHASE_LABELS[stage] ?? stage} ({stages[stage] ?? 0})
          </button>
        ))}

        {/* Plan filter */}
        <div className="ml-auto flex gap-2">
          {["Enterprise", "Premium", "Lite"].map((plan) => (
            <button
              key={plan}
              onClick={() => setPlanFilter(planFilter === plan ? null : plan)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                planFilter === plan
                  ? "bg-accent text-white"
                  : "bg-card border border-card-border text-text-secondary hover:text-text-primary"
              )}
            >
              {plan} ({plans[plan] ?? 0})
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <div className="text-xs text-text-muted">
        {filtered.length} compte{filtered.length > 1 ? "s" : ""}
        {search && ` pour "${search}"`}
        {stageFilter && ` en ${CUSTOMER_PHASE_LABELS[stageFilter] ?? stageFilter}`}
        {planFilter && ` — plan ${planFilter}`}
      </div>

      {/* Company list */}
      <div className="space-y-2">
        {filtered.map((company) => (
          <Link
            key={company.id}
            href={`/account/${company.id}`}
            className="card p-0 flex items-center hover:bg-card-hover transition-colors group cursor-pointer"
          >
            {/* Left: avatar + info */}
            <div className="flex-1 flex items-center gap-4 px-4 py-3">
              {/* Company avatar */}
              <div className="w-10 h-10 rounded-lg bg-background flex items-center justify-center flex-shrink-0 border border-card-border">
                <Building2 className="w-5 h-5 text-text-muted" />
              </div>

              {/* Name + meta */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary truncate group-hover:text-accent transition-colors">
                    {company.name}
                  </span>
                  {company.isStrategic && (
                    <Star className="w-3 h-3 text-warning flex-shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  {company.domain && (
                    <span className="text-[10px] text-text-muted">{company.domain}</span>
                  )}
                  <span className="text-[10px] text-text-muted">
                    CSM: {company.ownerId ? getCsmName(company.ownerId) : "—"}
                  </span>
                </div>
              </div>
            </div>

            {/* Middle: badges */}
            <div className="hidden md:flex items-center gap-2 px-4">
              {/* Customer stage badge */}
              <span className={cn("text-[10px] px-2 py-0.5 rounded-md font-medium", STAGE_COLORS[company.customerStage ?? ""] ?? "bg-card-border text-text-muted")}>
                {CUSTOMER_PHASE_LABELS[company.customerStage ?? ""] ?? company.customerStage ?? "—"}
              </span>

              {/* Plan badge */}
              {company.plan && (
                <span className={cn("text-[10px] px-2 py-0.5 rounded-md font-medium", PLAN_COLORS[company.plan] ?? "bg-card-border text-text-muted")}>
                  {company.plan}
                </span>
              )}
            </div>

            {/* Right: MRR + ROI + arrow */}
            <div className="flex items-center gap-6 px-4 py-3">
              {/* ROI */}
              <div className="hidden lg:block text-right">
                <div className={cn("text-xs font-mono font-medium", company.roi > 2 ? "text-positive" : company.roi > 0 ? "text-text-primary" : "text-text-muted")}>
                  {company.roi > 0 ? `${company.roi.toFixed(1)}x` : "—"}
                </div>
                <div className="text-[9px] text-text-muted">ROI</div>
              </div>

              {/* Missions */}
              <div className="hidden lg:block text-right">
                <div className="text-xs font-mono text-text-primary">{company.totalMissions || "—"}</div>
                <div className="text-[9px] text-text-muted">Missions</div>
              </div>

              {/* MRR */}
              <div className="text-right min-w-[80px]">
                <div className="text-sm font-mono font-semibold text-text-primary">{formatCurrency(company.mrr, true)}</div>
                <div className="text-[9px] text-text-muted">MRR</div>
              </div>

              {/* Arrow */}
              <ChevronRight className="w-4 h-4 text-text-muted group-hover:text-accent transition-colors flex-shrink-0" />
            </div>
          </Link>
        ))}

        {filtered.length === 0 && (
          <div className="card text-center py-12 text-text-muted text-sm">
            Aucun compte trouve
            {search && (
              <button onClick={() => setSearch("")} className="block mx-auto mt-2 text-accent hover:underline text-xs">
                Effacer la recherche
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function AccountsPage() {
  return (
    <div>
      <Suspense>
        <Header title="Comptes" subtitle="Tous les comptes clients actifs" />
      </Suspense>
      <Suspense>
        <AccountsContent />
      </Suspense>
    </div>
  )
}
