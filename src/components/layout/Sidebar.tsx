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
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  Zap,
} from "lucide-react"

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Comptes", href: "/accounts", icon: Building2 },
  { name: "Pipeline", href: "/pipeline", icon: GitBranch },
  { name: "Forecast", href: "/forecast", icon: BarChart3 },
  { name: "Renouvellements", href: "/renewals", icon: CalendarClock },
  { name: "Portefeuille", href: "/portfolio", icon: Users },
  { name: "Tendances", href: "/trends", icon: TrendingUp },
  { name: "Audit", href: "/audit", icon: ShieldAlert },
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()

  return (
    <aside
      className={cn(
        "flex flex-col h-screen bg-background-secondary border-r border-card-border transition-all duration-300",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-card-border">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent">
          <Zap className="w-4 h-4 text-white" />
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-text-primary">CSM OS</span>
            <span className="text-[10px] text-text-muted">Loyoly</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        {navigation.map((item) => {
          const isActive = pathname === item.href || (item.href === "/accounts" && pathname.startsWith("/account"))
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150",
                isActive
                  ? "bg-accent/10 text-accent"
                  : "text-text-secondary hover:bg-card hover:text-text-primary"
              )}
            >
              <item.icon className={cn("w-5 h-5 flex-shrink-0", isActive && "text-accent")} />
              {!collapsed && <span>{item.name}</span>}
            </Link>
          )
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-center h-12 border-t border-card-border text-text-muted hover:text-text-primary transition-colors"
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>
    </aside>
  )
}
