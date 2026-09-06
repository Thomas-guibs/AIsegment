"use client"

import { Suspense, useState } from "react"
import { Header } from "@/components/layout/Header"
import { BarChartComponent } from "@/components/charts/BarChart"
import { useFetch } from "@/lib/hooks"
import { cn, formatCurrency } from "@/lib/utils"
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, TrendingUp, TrendingDown } from "lucide-react"

interface CommissionDeal {
  id: string
  name: string
  mrr: number
  date: string | null
}

interface CommissionMonth {
  month: string
  label: string
  mrrReference: number
  companiesInPortfolio: number
  upsellMrr: number
  downsellMrr: number
  churnMrr: number
  nrrMrr: number
  nrrPercent: number
  upsellDeals: CommissionDeal[]
  churnDeals: CommissionDeal[]
  downsellDeals: CommissionDeal[]
}

interface CsmCommission {
  csmId: string
  csmName: string
  initials: string
  color: string
  months: CommissionMonth[]
  quarterlyNrr: number
  avgMrrReference: number
}

interface CommissionsData {
  year: number
  quarter: number
  quarterLabel: string
  csms: CsmCommission[]
}

function CommissionsContent() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [quarter, setQuarter] = useState(Math.ceil((now.getMonth() + 1) / 3))
  const [expandedCsm, setExpandedCsm] = useState<string | null>(null)
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null)

  const { data, loading } = useFetch<CommissionsData>("/api/commissions", {
    year: String(year),
    quarter: String(quarter),
  })

  const prevQuarter = () => {
    if (quarter === 1) { setYear(year - 1); setQuarter(4) }
    else setQuarter(quarter - 1)
  }
  const nextQuarter = () => {
    if (quarter === 4) { setYear(year + 1); setQuarter(1) }
    else setQuarter(quarter + 1)
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="skeleton h-10" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-32" />)}
        </div>
        <div className="skeleton h-64" />
      </div>
    )
  }

  if (!data) return null

  // Chart data: NRR per CSM per month
  const chartData = data.csms[0]?.months.map((_, i) => {
    const row: Record<string, unknown> = { label: data.csms[0].months[i].label }
    for (const csm of data.csms) {
      row[csm.csmName.split(" ")[0]] = csm.months[i]?.nrrPercent ?? 100
    }
    return row
  }) ?? []

  return (
    <div className="p-6 space-y-6">
      {/* Quarter selector */}
      <div className="flex items-center justify-center gap-4">
        <button onClick={prevQuarter} className="p-1.5 rounded-lg hover:bg-card-hover text-text-muted hover:text-text-primary transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-semibold text-text-primary min-w-[120px] text-center">
          Q{quarter} {year}
        </h2>
        <button onClick={nextQuarter} className="p-1.5 rounded-lg hover:bg-card-hover text-text-muted hover:text-text-primary transition-colors">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* CSM KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {data.csms.map((csm) => (
          <div
            key={csm.csmId}
            className={cn("card cursor-pointer hover:bg-card-hover transition-colors", expandedCsm === csm.csmId && "ring-1 ring-accent")}
            onClick={() => setExpandedCsm(expandedCsm === csm.csmId ? null : csm.csmId)}
          >
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                style={{ backgroundColor: csm.color }}
              >
                {csm.initials}
              </div>
              <div>
                <div className="text-[13px] font-medium text-text-primary">{csm.csmName.split(" ")[0]}</div>
                <div className="text-2xs text-text-muted">{formatCurrency(csm.avgMrrReference, true)} MRR moy.</div>
              </div>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <div className={cn(
                  "text-2xl font-mono font-bold",
                  csm.quarterlyNrr >= 100 ? "text-positive" : "text-negative"
                )}>
                  {csm.quarterlyNrr.toFixed(1)}%
                </div>
                <div className="text-2xs text-text-muted">NRR Q{quarter}</div>
              </div>
              {csm.quarterlyNrr >= 100
                ? <TrendingUp className="w-5 h-5 text-positive" />
                : <TrendingDown className="w-5 h-5 text-negative" />
              }
            </div>
          </div>
        ))}
      </div>

      {/* NRR Bar Chart */}
      <div className="card">
        <h3 className="text-sm font-medium text-text-secondary mb-4">NRR % par CSM — Q{quarter} {year}</h3>
        <BarChartComponent
          data={chartData}
          series={data.csms.map((csm) => ({
            key: csm.csmName.split(" ")[0],
            label: csm.csmName.split(" ")[0],
            color: csm.color,
          }))}
          xKey="label"
          height={250}
        />
      </div>

      {/* Detailed tables per CSM */}
      <div className="space-y-2">
        {data.csms.map((csm) => (
          <div key={csm.csmId} className="card p-0 overflow-hidden">
            <button
              onClick={() => setExpandedCsm(expandedCsm === csm.csmId ? null : csm.csmId)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-card-hover transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: csm.color }} />
                <span className="text-[13px] font-medium text-text-primary">{csm.csmName}</span>
                <span className={cn("text-[13px] font-mono font-semibold", csm.quarterlyNrr >= 100 ? "text-positive" : "text-negative")}>
                  {csm.quarterlyNrr.toFixed(1)}%
                </span>
              </div>
              {expandedCsm === csm.csmId ? <ChevronUp className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
            </button>

            {expandedCsm === csm.csmId && (
              <div className="border-t border-card-border animate-fade-in">
                <table className="w-full">
                  <thead className="bg-row-alt">
                    <tr>
                      <th className="px-4 py-2 text-left text-2xs text-text-muted">Mois</th>
                      <th className="px-4 py-2 text-right text-2xs text-text-muted">MRR Ref</th>
                      <th className="px-4 py-2 text-right text-2xs text-text-muted">Clients</th>
                      <th className="px-4 py-2 text-right text-2xs text-text-muted">Upsell</th>
                      <th className="px-4 py-2 text-right text-2xs text-text-muted">Downsell</th>
                      <th className="px-4 py-2 text-right text-2xs text-text-muted">Churn</th>
                      <th className="px-4 py-2 text-right text-2xs text-text-muted">NRR MRR</th>
                      <th className="px-4 py-2 text-right text-2xs text-text-muted">NRR %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-card-border">
                    {csm.months.map((m) => {
                      const monthKey = `${csm.csmId}-${m.month}`
                      const allDeals = [...m.upsellDeals, ...m.churnDeals, ...m.downsellDeals]
                      return (
                        <>
                          <tr
                            key={m.month}
                            className="hover:bg-card-hover cursor-pointer transition-colors"
                            onClick={() => setExpandedMonth(expandedMonth === monthKey ? null : monthKey)}
                          >
                            <td className="px-4 py-2.5 text-[13px] font-medium text-text-primary">
                              <span className="flex items-center gap-1">
                                {m.label}
                                {allDeals.length > 0 && (expandedMonth === monthKey ? <ChevronUp className="w-3 h-3 text-text-muted" /> : <ChevronDown className="w-3 h-3 text-text-muted" />)}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-[13px] font-mono text-text-secondary text-right">{formatCurrency(m.mrrReference, true)}</td>
                            <td className="px-4 py-2.5 text-[13px] font-mono text-text-secondary text-right">{m.companiesInPortfolio}</td>
                            <td className="px-4 py-2.5 text-[13px] font-mono text-positive text-right">{m.upsellMrr > 0 ? `+${formatCurrency(m.upsellMrr, true)}` : "—"}</td>
                            <td className="px-4 py-2.5 text-[13px] font-mono text-warning text-right">{m.downsellMrr > 0 ? `-${formatCurrency(m.downsellMrr, true)}` : "—"}</td>
                            <td className="px-4 py-2.5 text-[13px] font-mono text-negative text-right">{m.churnMrr > 0 ? `-${formatCurrency(m.churnMrr, true)}` : "—"}</td>
                            <td className="px-4 py-2.5 text-[13px] font-mono text-text-primary text-right font-medium">{formatCurrency(m.nrrMrr, true)}</td>
                            <td className={cn("px-4 py-2.5 text-[13px] font-mono font-semibold text-right", m.nrrPercent >= 100 ? "text-positive" : "text-negative")}>
                              {m.nrrPercent.toFixed(1)}%
                            </td>
                          </tr>
                          {expandedMonth === monthKey && allDeals.length > 0 && (
                            <tr key={`${m.month}-deals`}>
                              <td colSpan={8} className="px-4 py-0 bg-row-alt">
                                <div className="py-2 pl-4 space-y-1 border-l-2 border-card-border ml-2">
                                  {m.upsellDeals.map((d) => (
                                    <div key={d.id} className="flex items-center justify-between text-2xs py-1">
                                      <div className="flex items-center gap-2">
                                        <span className="badge badge-upsell">Upsell</span>
                                        <span className="text-text-primary">{d.name}</span>
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <span className="text-text-muted">{d.date}</span>
                                        <span className="font-mono text-positive font-medium">+{formatCurrency(d.mrr)}</span>
                                      </div>
                                    </div>
                                  ))}
                                  {m.downsellDeals.map((d) => (
                                    <div key={d.id} className="flex items-center justify-between text-2xs py-1">
                                      <div className="flex items-center gap-2">
                                        <span className="badge badge-downsell">Downsell</span>
                                        <span className="text-text-primary">{d.name}</span>
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <span className="text-text-muted">{d.date}</span>
                                        <span className="font-mono text-warning font-medium">-{formatCurrency(d.mrr)}</span>
                                      </div>
                                    </div>
                                  ))}
                                  {m.churnDeals.map((d) => (
                                    <div key={d.id} className="flex items-center justify-between text-2xs py-1">
                                      <div className="flex items-center gap-2">
                                        <span className="badge badge-churn">Churn</span>
                                        <span className="text-text-primary">{d.name}</span>
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <span className="text-text-muted">{d.date}</span>
                                        <span className="font-mono text-negative font-medium">-{formatCurrency(d.mrr)}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function CommissionsPage() {
  return (
    <div>
      <Suspense>
        <Header title="Commissions" subtitle="NRR trimestriel par CSM — base de calcul des commissions" />
      </Suspense>
      <Suspense>
        <CommissionsContent />
      </Suspense>
    </div>
  )
}
