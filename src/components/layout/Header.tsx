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
    <header className="flex items-center justify-between px-5 h-14 border-b border-card-border bg-background-secondary">
      <div>
        <h1 className="text-[15px] font-semibold text-text-primary">{title}</h1>
        {subtitle && <p className="text-2xs text-text-muted">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-1.5">
        <FilterBar />
        <button
          onClick={handleRefresh}
          className="flex items-center justify-center w-8 h-8 rounded-lg text-text-muted hover:text-accent hover:bg-card-hover transition-colors"
          title="Rafraichir les donnees"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", spinning && "animate-spin")} />
        </button>
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center w-8 h-8 rounded-lg text-text-muted hover:text-text-secondary hover:bg-card-hover transition-colors"
          title={theme === "dark" ? "Mode clair" : "Mode sombre"}
        >
          {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>
      </div>
    </header>
  )
}
