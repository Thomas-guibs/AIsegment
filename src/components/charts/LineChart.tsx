"use client"

import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
  ReferenceLine,
} from "recharts"

interface LineChartSeries {
  key: string
  label: string
  color: string
  dashed?: boolean
}

interface LineChartProps {
  data: any[]
  series: LineChartSeries[]
  xKey: string
  height?: number
  formatValue?: (value: number) => string
  referenceLine?: { y: number; label: string; color: string }
}

function CustomTooltip({ active, payload, label, formatValue }: any) {
  if (!active || !payload?.length) return null

  return (
    <div className="bg-card border border-card-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-text-muted mb-1">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.name} className="flex items-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-text-secondary">{entry.name}:</span>
          <span className="font-mono text-text-primary font-medium">
            {formatValue ? formatValue(entry.value) : `${entry.value.toFixed(1)}%`}
          </span>
        </div>
      ))}
    </div>
  )
}

export function LineChartComponent({
  data,
  series,
  xKey,
  height = 300,
  formatValue,
  referenceLine,
}: LineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsLineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-card-border)" vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
          axisLine={{ stroke: "#2A2A3C" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => (formatValue ? formatValue(v) : `${v}%`)}
        />
        <Tooltip content={<CustomTooltip formatValue={formatValue} />} />
        <Legend
          wrapperStyle={{ fontSize: 11, color: "#94A3B8" }}
          iconType="circle"
          iconSize={8}
        />
        {referenceLine && (
          <ReferenceLine
            y={referenceLine.y}
            stroke={referenceLine.color}
            strokeDasharray="5 5"
            label={{
              value: referenceLine.label,
              position: "insideTopRight",
              fill: referenceLine.color,
              fontSize: 10,
            }}
          />
        )}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            strokeDasharray={s.dashed ? "5 5" : undefined}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2 }}
            animationDuration={300}
            animationEasing="ease-out"
          />
        ))}
      </RechartsLineChart>
    </ResponsiveContainer>
  )
}
