"use client"

import { AlertTriangle, RefreshCw } from "lucide-react"

interface ErrorStateProps {
  message?: string
  onRetry?: () => void
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="card flex flex-col items-center justify-center py-12 gap-3">
      <AlertTriangle className="w-8 h-8 text-warning" />
      <p className="text-sm text-text-secondary text-center max-w-md">
        {message ?? "Impossible de charger les données. Vérifie ta connexion ou réessaie."}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card-hover text-text-primary text-sm hover:bg-accent hover:text-white transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Réessayer
        </button>
      )}
    </div>
  )
}
