"use client"

import { Fragment, Suspense, useMemo, useState } from "react"
import { Header } from "@/components/layout/Header"
import { BarChartComponent } from "@/components/charts/BarChart"
import { LineChartComponent } from "@/components/charts/LineChart"
import { useFetch } from "@/lib/hooks"
import { formatCurrency, cn } from "@/lib/utils"
import { formatNrr, type MetricsResponse, type MonthlyMetrics } from "@/lib/engine/client-types"
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react"

const ELIGIBILITY_OPTIONS = [
  { value: "strict", label: "Strict", hint: "Yes uniquement — conforme au plan" },
  { value: "include_unset", label: "+ non renseigné", hint: "Yes + eligibility vide" },
  { value: "all", label: "Tous", hint: "Aucun filtre d'eligibility" },
]

const NRR_METHODS = [
  { value: "weighted", label: "Pondéré", hint: "Chaque mois pesé par son MRR de début" },
  { value: "mean", label: "Moyenne", hint: "Même poids pour chaque mois" },
  { value: "compound", label: "Composé", hint: "Produit des NRR mensuels" },
]

function Toggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string; hint?: string }>
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center gap-0.5 bg-card rounded-lg p-0.5 border border-card-border">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          title={option.hint}
          className={cn(
            "px-2.5 py-1 text-[11px] rounded-md transition-colors font-medium whitespace-nowrap",
            value === option.value
              ? "bg-accent text-white"
              : "text-text-secondary hover:text-text-primary"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function TrendsContent() {
  const [range, setRange] = useState<"6" | "12">("6")
  const [eligibility, setEligibility] = useState("strict")
  const [nrrMethod, setNrrMethod] = useState("weighted")
  const [selectedCsm, setSelectedCsm] = useState<string | null>(null)
  const [openMonth, setOpenMonth] = useState<string | null>(null)

  const { data, loading } = useFetch<MetricsResponse>("/api/metrics", {
    months: range,
    eligibility,
    nrrMethod,
  })

  const csmData = useMemo(
    () =>
      (data?.perCsm ?? []).filter((c) =>
        c.months.some((m) => m.startingMrr > 0 || m.upsell > 0 || m.churn > 0 || m.downsell > 0)
      ),
    [data]
  )

  const selected = selectedCsm ? csmData.find((c) => c.csmId === selectedCsm) ?? null : null
  const months: MonthlyMetrics[] = selected?.months ?? data?.global.months ?? []
  const aggregate = selected?.aggregate ?? data?.global.aggregate ?? null
  const scopeLabel = selected ? selected.csmName : "Global"

  const nrrChartData = useMemo(() => {
    if (selected) {
      return selected.months.map((m) => ({ monthLabel: m.monthLabel, NRR: m.nrr }))
    }
    return (data?.global.months ?? []).map((m, i) => {
      const row: Record<string, unknown> = { monthLabel: m.monthLabel, Global: m.nrr }
      for (const csm of csmData) row[csm.csmName.split(" ")[0]] = csm.months[i]?.nrr ?? null
      return row
    })
  }, [data, csmData, selected])

  const movementsData = months.map((m) => ({
    monthLabel: m.monthLabel,
    Upsell: m.upsell,
    Churn: -m.churn,
    Downsell: -m.downsell,
  }))

  const netData = months.map((m) => ({ monthLabel: m.monthLabel, Net: m.net }))

  const mrrByCsm = (data?.global.months ?? []).map((m, i) => {
    const row: Record<string, unknown> = { monthLabel: m.monthLabel }
    for (const csm of csmData) row[csm.csmName.split(" ")[0]] = csm.months[i]?.endingMrr ?? 0
    return row
  })

  const movementsOfMonth = (month: string) => {
    const source = selected ? selected.movements : csmData.flatMap((c) => c.movements)
    return source.filter((m) => (m.referenceDate ?? "").slice(0, 7) === month)
  }

  const anomalies = data?.diagnostics.summary.anomalyCount ?? 0
  const missingEligibility =
    data?.diagnostics.rejectedByReason.find((g) => g.reason === "missing_eligibility")?.count ?? 0

  return (
    <div className="p-6 space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Toggle
            options={[
              { value: "6" as const, label: "6 mois" },
              { value: "12" as const, label: "12 mois" },
            ]}
            value={range}
            onChange={setRange}
          />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-text-muted">Eligibility</span>
            <Toggle options={ELIGIBILITY_OPTIONS} value={eligibility} onChange={setEligibility} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-text-muted">NRR agrégé</span>
            <Toggle options={NRR_METHODS} value={nrrMethod} onChange={setNrrMethod} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => setSelectedCsm(null)}
            className={cn(
              "px-2.5 py-1 text-[10px] rounded-md transition-colors font-medium",
              !selectedCsm
                ? "bg-accent text-white"
                : "bg-card border border-card-border text-text-secondary hover:text-text-primary"
            )}
          >
            Global
          </button>
          {csmData.map((csm) => (
            <button
              key={csm.csmId}
              onClick={() => setSelectedCsm(selectedCsm === csm.csmId ? null : csm.csmId)}
              className={cn(
                "px-2.5 py-1 text-[10px] rounded-md transition-colors font-medium",
                selectedCsm === csm.csmId
                  ? "text-white"
                  : "bg-card border border-card-border text-text-secondary hover:text-text-primary"
              )}
              style={selectedCsm === csm.csmId ? { backgroundColor: csm.color } : undefined}
            >
              {csm.csmName.split(" ")[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Data-quality banner — strict mode hides most of the churn in this CRM */}
      {!loading && eligibility === "strict" && missingEligibility > 0 && (
        <div className="card flex items-start gap-3 border-warning/40 bg-warning/5">
          <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
          <div className="text-xs text-text-secondary leading-relaxed">
            <span className="font-medium text-text-primary">
              {missingEligibility} mouvement{missingEligibility > 1 ? "s" : ""} écarté
              {missingEligibility > 1 ? "s" : ""} faute d&apos;eligibility renseignée.
            </span>{" "}
            En mode strict, une partie du churn n&apos;est pas décomptée et le NRR est
            mécaniquement surévalué — en faveur des CSM. Ce n&apos;est pas un défaut du calcul mais
            un trou de saisie&nbsp;: comparez avec «&nbsp;+ non renseigné&nbsp;» avant de figer un
            chiffre.
          </div>
        </div>
      )}

      {loading || !data ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card skeleton h-[300px]" />
          ))}
        </div>
      ) : (
        <>
          {/* Period aggregate */}
          {aggregate && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="card">
                <p className="text-[10px] uppercase tracking-wide text-text-muted">
                  NRR {range} mois — {NRR_METHODS.find((m) => m.value === nrrMethod)?.label}
                </p>
                <p
                  className={cn(
                    "text-2xl font-semibold font-mono mt-1",
                    aggregate.nrr == null
                      ? "text-text-muted"
                      : aggregate.nrr >= 100
                        ? "text-positive"
                        : "text-negative"
                  )}
                >
                  {formatNrr(aggregate.nrr)}
                </p>
                <p className="text-[10px] text-text-muted mt-1">
                  {aggregate.monthsCounted} mois retenus · {scopeLabel}
                </p>
              </div>
              <div className="card">
                <p className="text-[10px] uppercase tracking-wide text-text-muted">MRR début cumulé</p>
                <p className="text-2xl font-semibold font-mono mt-1 text-text-primary">
                  {formatCurrency(aggregate.startingMrr, true)}
                </p>
              </div>
              <div className="card">
                <p className="text-[10px] uppercase tracking-wide text-text-muted">Upsell</p>
                <p className="text-2xl font-semibold font-mono mt-1 text-positive">
                  {formatCurrency(aggregate.upsell, true)}
                </p>
              </div>
              <div className="card">
                <p className="text-[10px] uppercase tracking-wide text-text-muted">Churn</p>
                <p className="text-2xl font-semibold font-mono mt-1 text-negative">
                  {formatCurrency(aggregate.churn, true)}
                </p>
              </div>
              <div className="card">
                <p className="text-[10px] uppercase tracking-wide text-text-muted">Downsell</p>
                <p className="text-2xl font-semibold font-mono mt-1 text-warning">
                  {formatCurrency(aggregate.downsell, true)}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <h3 className="text-sm font-medium text-text-secondary mb-4">
                NRR par mois — {scopeLabel}
              </h3>
              <LineChartComponent
                data={nrrChartData}
                series={
                  selected
                    ? [{ key: "NRR", label: "NRR", color: selected.color }]
                    : [
                        {
                          key: "Global",
                          label: "Global",
                          color: "var(--color-text-primary)",
                          dashed: true,
                        },
                        ...csmData.map((c) => ({
                          key: c.csmName.split(" ")[0],
                          label: c.csmName.split(" ")[0],
                          color: c.color,
                        })),
                      ]
                }
                xKey="monthLabel"
                height={280}
                referenceLine={{ y: 100, label: "100%", color: "#64748B" }}
              />
            </div>

            <div className="card">
              <h3 className="text-sm font-medium text-text-secondary mb-4">
                Mouvements mensuels — {scopeLabel}
              </h3>
              <BarChartComponent
                data={movementsData}
                series={[
                  { key: "Upsell", label: "Upsell", color: "#22C55E" },
                  { key: "Churn", label: "Churn", color: "#EF4444" },
                  { key: "Downsell", label: "Downsell", color: "#F59E0B" },
                ]}
                xKey="monthLabel"
                stacked
                height={280}
              />
            </div>

            <div className="card">
              <h3 className="text-sm font-medium text-text-secondary mb-4">
                Net expansion — {scopeLabel}
              </h3>
              <LineChartComponent
                data={netData}
                series={[{ key: "Net", label: "Net expansion", color: "#2563EB" }]}
                xKey="monthLabel"
                height={280}
                formatValue={(v) => formatCurrency(v, true)}
                referenceLine={{ y: 0, label: "Breakeven", color: "#64748B" }}
              />
            </div>

            <div className="card">
              <h3 className="text-sm font-medium text-text-secondary mb-4">
                MRR fin de mois par CSM
              </h3>
              <BarChartComponent
                data={mrrByCsm}
                series={csmData.map((c) => ({
                  key: c.csmName.split(" ")[0],
                  label: c.csmName.split(" ")[0],
                  color: c.color,
                }))}
                xKey="monthLabel"
                stacked
                height={280}
              />
            </div>
          </div>

          {/* Monthly detail — every figure drills down to its movements */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-card-border">
              <h3 className="text-sm font-medium text-text-secondary">
                Détail mensuel — {scopeLabel}
              </h3>
              <p className="text-[10px] text-text-muted mt-0.5">
                MRR lu au 1er du mois à 00:00 UTC, à la valeur en vigueur à cet instant.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-background/50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs text-text-muted">Mois</th>
                    <th className="px-4 py-2 text-right text-xs text-text-muted">Comptes</th>
                    <th className="px-4 py-2 text-right text-xs text-text-muted">MRR début</th>
                    <th className="px-4 py-2 text-right text-xs text-text-muted">Upsell</th>
                    <th className="px-4 py-2 text-right text-xs text-text-muted">Churn</th>
                    <th className="px-4 py-2 text-right text-xs text-text-muted">Downsell</th>
                    <th className="px-4 py-2 text-right text-xs text-text-muted">Net</th>
                    <th className="px-4 py-2 text-right text-xs text-text-muted">MRR fin</th>
                    <th className="px-4 py-2 text-right text-xs text-text-muted">NRR</th>
                    <th className="px-4 py-2 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {months.map((m) => {
                    const movements = movementsOfMonth(m.month)
                    const isOpen = openMonth === m.month
                    return (
                      <Fragment key={m.month}>
                        <tr
                          onClick={() => setOpenMonth(isOpen ? null : m.month)}
                          className="hover:bg-card-hover transition-colors cursor-pointer"
                        >
                          <td className="px-4 py-2.5 text-sm font-medium text-text-primary">
                            {m.monthLabel}
                          </td>
                          <td className="px-4 py-2.5 text-sm font-mono text-text-muted text-right">
                            {m.accountCount}
                          </td>
                          <td className="px-4 py-2.5 text-sm font-mono text-text-secondary text-right">
                            {formatCurrency(m.startingMrr, true)}
                          </td>
                          <td className="px-4 py-2.5 text-sm font-mono text-positive text-right">
                            {m.upsell > 0 ? `+${formatCurrency(m.upsell, true)}` : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-sm font-mono text-negative text-right">
                            {m.churn > 0 ? `-${formatCurrency(m.churn, true)}` : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-sm font-mono text-warning text-right">
                            {m.downsell > 0 ? `-${formatCurrency(m.downsell, true)}` : "—"}
                          </td>
                          <td
                            className={cn(
                              "px-4 py-2.5 text-sm font-mono text-right font-medium",
                              m.net >= 0 ? "text-positive" : "text-negative"
                            )}
                          >
                            {formatCurrency(m.net, true)}
                          </td>
                          <td className="px-4 py-2.5 text-sm font-mono text-text-secondary text-right">
                            {formatCurrency(m.endingMrr, true)}
                          </td>
                          <td
                            className={cn(
                              "px-4 py-2.5 text-sm font-mono text-right font-semibold",
                              m.nrr == null
                                ? "text-text-muted"
                                : m.nrr >= 100
                                  ? "text-positive"
                                  : "text-negative"
                            )}
                            title={
                              m.nrr == null
                                ? "Portefeuille vide ce mois — un NRR n'est pas calculable, ce n'est pas 0 %."
                                : undefined
                            }
                          >
                            {formatNrr(m.nrr)}
                          </td>
                          <td className="px-2 py-2.5 text-text-muted">
                            {movements.length > 0 &&
                              (isOpen ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                              ))}
                          </td>
                        </tr>
                        {isOpen && movements.length > 0 && (
                          <tr>
                            <td colSpan={10} className="bg-background/40 px-4 py-3">
                              <table className="w-full">
                                <thead>
                                  <tr>
                                    <th className="px-2 py-1 text-left text-[10px] uppercase text-text-muted">
                                      Compte
                                    </th>
                                    <th className="px-2 py-1 text-left text-[10px] uppercase text-text-muted">
                                      Deal
                                    </th>
                                    <th className="px-2 py-1 text-left text-[10px] uppercase text-text-muted">
                                      Type
                                    </th>
                                    <th className="px-2 py-1 text-left text-[10px] uppercase text-text-muted">
                                      Date de réf.
                                    </th>
                                    <th className="px-2 py-1 text-right text-[10px] uppercase text-text-muted">
                                      Montant
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {movements.map((mv) => (
                                    <tr key={mv.id}>
                                      <td className="px-2 py-1 text-xs text-text-primary">
                                        {mv.accountName ?? "—"}
                                      </td>
                                      <td className="px-2 py-1 text-xs text-text-secondary">
                                        {mv.name}
                                        {mv.attributionFallback && (
                                          <span
                                            className="ml-1.5 text-[9px] text-warning"
                                            title="Le CSM n'a pas pu être lu au 1er du mois — repli appliqué."
                                          >
                                            repli
                                          </span>
                                        )}
                                        {mv.override && (
                                          <span
                                            className="ml-1.5 text-[9px] text-accent"
                                            title={`Correction manuelle : ${mv.override.reason} (${mv.override.author})`}
                                          >
                                            corrigé
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-2 py-1 text-xs text-text-muted capitalize">
                                        {mv.type}
                                      </td>
                                      <td className="px-2 py-1 text-xs font-mono text-text-muted">
                                        {mv.referenceDate ?? "—"}
                                      </td>
                                      <td
                                        className={cn(
                                          "px-2 py-1 text-xs font-mono text-right",
                                          mv.type === "upsell"
                                            ? "text-positive"
                                            : mv.type === "churn"
                                              ? "text-negative"
                                              : "text-warning"
                                        )}
                                      >
                                        {mv.type === "upsell" ? "+" : "-"}
                                        {formatCurrency(mv.amount)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {anomalies > 0 && (
            <p className="text-[11px] text-text-muted">
              {anomalies} mouvement{anomalies > 1 ? "s" : ""} écarté{anomalies > 1 ? "s" : ""} sur la
              période — voir la page{" "}
              <a href="/audit" className="text-accent hover:underline">
                Audit
              </a>{" "}
              pour le détail par motif.
            </p>
          )}
        </>
      )}
    </div>
  )
}

export default function TrendsPage() {
  return (
    <div>
      <Suspense>
        <Header title="Tendances" subtitle="NRR, mouvements et MRR — lecture point-in-time" />
      </Suspense>
      <Suspense>
        <TrendsContent />
      </Suspense>
    </div>
  )
}
