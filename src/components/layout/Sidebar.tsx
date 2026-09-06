"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Building2,
  CalendarClock,
  GitBranch,
  Users,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Activity,
  Coins,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"

interface NavItem {
  name: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

interface NavGroup {
  category: string | null
  items: NavItem[]
}

const navigation: NavGroup[] = [
  {
    category: null,
    items: [{ name: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    category: "Analytics",
    items: [
      { name: "Forecast", href: "/forecast", icon: BarChart3 },
      { name: "Upsell", href: "/upsell", icon: TrendingUp },
      { name: "Churn", href: "/churn", icon: TrendingDown },
    ],
  },
  {
    category: "Portefeuille",
    items: [
      { name: "Portefeuille", href: "/portfolio", icon: Users },
      { name: "Comptes", href: "/accounts", icon: Building2 },
      { name: "NRR Detail", href: "/nrr", icon: Activity },
      { name: "Renouvellements", href: "/renewals", icon: CalendarClock },
      { name: "Commissions", href: "/commissions", icon: Coins },
    ],
  },
  {
    category: "Upsell",
    items: [
      { name: "Pipeline", href: "/pipeline", icon: GitBranch },
      { name: "Upsell Signals", href: "/upsell-signals", icon: Sparkles },
    ],
  },
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()

  return (
    <aside
      className={cn(
        "flex flex-col h-screen bg-sidebar-bg border-r border-card-border transition-all duration-200",
        collapsed ? "w-14" : "w-56"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-3.5 h-14 border-b border-card-border">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-accent text-white text-xs font-bold">
          C
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold text-text-primary leading-tight">CSM OS</span>
            <span className="text-2xs text-text-muted leading-tight">Loyoly</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-3 overflow-y-auto">
        {navigation.map((group, idx) => (
          <div key={group.category ?? `group-${idx}`} className="space-y-0.5">
            {group.category && !collapsed && (
              <div className="px-2.5 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                {group.category}
              </div>
            )}
            {group.items.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href === "/accounts" && pathname.startsWith("/account"))
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors duration-100",
                    isActive
                      ? "bg-sidebar-active text-text-primary"
                      : "text-text-secondary hover:bg-card-hover hover:text-text-primary"
                  )}
                >
                  <item.icon
                    className={cn(
                      "w-[18px] h-[18px] flex-shrink-0",
                      isActive ? "text-accent" : "text-text-muted"
                    )}
                  />
                  {!collapsed && <span>{item.name}</span>}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-center h-10 border-t border-card-border text-text-muted hover:text-text-secondary transition-colors"
      >
        {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>
    </aside>
  )
}
