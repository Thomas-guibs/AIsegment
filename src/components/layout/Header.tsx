"use client"

import { FilterBar } from "./FilterBar"

interface HeaderProps {
  title: string
  subtitle?: string
}

export function Header({ title, subtitle }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 h-16 border-b border-card-border bg-background-secondary/50 backdrop-blur-sm">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">{title}</h1>
        {subtitle && <p className="text-xs text-text-muted">{subtitle}</p>}
      </div>
      <FilterBar />
    </header>
  )
}
