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
  BarChart3,
  Activity,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Comptes", href: "/accounts", icon: Building2 },
  { name: "Pipeline", href: "/pipeline", icon: GitBranch },
  { name: "NRR Detail", href: "/nrr", icon: Activity },
  { name: "Forecast", href: "/forecast", icon: BarChart3 },
  { name: "Renouvellements", href: "/renewals", icon: CalendarClock },
  { name: "Portefeuille", href: "/portfolio", icon: Users },
  { name: "Tendances", href: "/trends", icon: TrendingUp },
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
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {navigation.map((item) => {
          const isActive = pathname === item.href || (item.href === "/accounts" && pathname.startsWith("/account"))
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
              <item.icon className={cn("w-[18px] h-[18px] flex-shrink-0", isActive ? "text-accent" : "text-text-muted")} />
              {!collapsed && <span>{item.name}</span>}
            </Link>
          )
        })}
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
