import type { Config } from "tailwindcss"

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--color-background)",
        "background-secondary": "var(--color-background-secondary)",
        card: "var(--color-card)",
        "card-border": "var(--color-card-border)",
        "card-hover": "var(--color-card-hover)",
        "sidebar-bg": "var(--color-sidebar-bg)",
        "sidebar-active": "var(--color-sidebar-active)",
        "accent-subtle": "var(--color-accent-subtle)",
        "row-alt": "var(--color-row-alt)",
        accent: "#E8653A",
        "accent-hover": "#D4562E",
        positive: "#2BA85D",
        negative: "#DC3545",
        warning: "#E8923A",
        "text-primary": "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        "text-muted": "var(--color-text-muted)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["Geist Mono", "monospace"],
      },
      borderRadius: {
        card: "12px",
      },
      fontSize: {
        "2xs": ["10px", "14px"],
      },
      animation: {
        "fade-in": "fadeIn 200ms ease-out",
        "slide-up": "slideUp 200ms ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}

export default config
