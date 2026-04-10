"use client"

import { useState } from "react"
import { FilterBar } from "./FilterBar"
import { useTheme } from "./ThemeProvider"
import { useRefresh } from "@/lib/hooks"
import { Sun, Moon, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

interface HeaderProps {
  title: string
  subtitle?: string
}

export function Header({ title, subtitle }: HeaderProps) {
  const { theme, toggleTheme } = useTheme()
  const { refresh } = useRefresh()
  const [spinning, setSpinning] = useState(false)

  const handleRefresh = () => {
    setSpinning(true)
    refresh()
    setTimeout(() => setSpinning(false), 1000)
  }

  return (
    <header className="flex items-center justify-between px-6 h-16 border-b border-card-border bg-background-secondary/50 backdrop-blur-sm">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">{title}</h1>
        {subtitle && <p className="text-xs text-text-muted">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        <FilterBar />
        <button
          onClick={handleRefresh}
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-card border border-card-border text-text-secondary hover:text-accent transition-colors"
          title="Rafraichir les donnees"
        >
          <RefreshCw className={cn("w-4 h-4", spinning && "animate-spin")} />
        </button>
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-card border border-card-border text-text-secondary hover:text-text-primary transition-colors"
          title={theme === "dark" ? "Mode clair" : "Mode sombre"}
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </header>
  )
}
