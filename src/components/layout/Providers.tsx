"use client"

import { Suspense } from "react"
import { RefreshProvider } from "@/lib/hooks"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <RefreshProvider>{children}</RefreshProvider>
    </Suspense>
  )
}
