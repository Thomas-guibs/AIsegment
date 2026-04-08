import type { Metadata } from "next"
import { Suspense } from "react"
import { Sidebar } from "@/components/layout/Sidebar"
import { ThemeProvider } from "@/components/layout/ThemeProvider"
import "./globals.css"

export const metadata: Metadata = {
  title: "CSM OS — Loyoly",
  description: "Customer Success operational dashboard",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="font-sans">
        <ThemeProvider>
          <div className="flex h-screen overflow-hidden">
            <Suspense>
              <Sidebar />
            </Suspense>
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
