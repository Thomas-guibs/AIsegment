import type { Metadata } from "next"
import { Suspense } from "react"
import { Sidebar } from "@/components/layout/Sidebar"
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
    <html lang="fr" className="dark">
      <body className="font-sans">
        <div className="flex h-screen overflow-hidden">
          <Suspense>
            <Sidebar />
          </Suspense>
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </body>
    </html>
  )
}
