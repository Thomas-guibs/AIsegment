"use client"

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"

interface DonutChartProps {
  data: Array<{ name: string; value: number; color: string }>
  size?: number
  innerRadius?: number
  outerRadius?: number
  showLabels?: boolean
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null

  return (
    <div className="bg-card border border-card-border rounded-lg px-3 py-2 shadow-xl">
      <div className="flex items-center gap-2 text-xs">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: payload[0].payload.color }} />
        <span className="text-text-secondary">{payload[0].name}:</span>
        <span className="font-mono text-text-primary font-medium">{payload[0].value}</span>
      </div>
    </div>
  )
}

export function DonutChart({
  data,
  size = 120,
  innerRadius = 35,
  outerRadius = 55,
  showLabels = false,
}: DonutChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0)

  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={size} height={size}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            dataKey="value"
            animationDuration={300}
            animationEasing="ease-out"
            stroke="none"
          >
            {data.map((entry, index) => (
              <Cell key={index} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>

      {showLabels && (
        <div className="space-y-1">
          {data.map((entry) => (
            <div key={entry.name} className="flex items-center gap-2 text-xs">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
              <span className="text-text-secondary">{entry.name}</span>
              <span className="font-mono text-text-primary ml-auto">
                {total > 0 ? `${Math.round((entry.value / total) * 100)}%` : "0%"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Mini donut for inline use (e.g., in KPI cards)
export function MiniDonut({ data }: { data: Array<{ name: string; value: number; color: string }> }) {
  return <DonutChart data={data} size={60} innerRadius={18} outerRadius={28} />
}
