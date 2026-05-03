# CSM OS — Loyoly

Internal Customer Success Management dashboard. Aggregates HubSpot (companies, deals, pipeline), Intercom (tickets), Google Calendar (meetings) and enriches customer data with upsell intelligence via Pappers + Claude AI.

## Stack

- **Next.js 14** (App Router, `src/app/`)
- **React 18** with Tailwind CSS
- **Recharts** for data visualization
- **Supabase** (Postgres) for enrichment persistence
- **HubSpot API** as the source of truth for CRM data
- **Anthropic SDK** (Claude + web_search) for company qualification
- **Pappers API** for French business registry (SIREN/cartography)

## Setup

```bash
npm install
cp .env.example .env.local  # fill in credentials
npm run dev
```

Required env vars: `HUBSPOT_ACCESS_TOKEN`, `PAPPERS_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Architecture

```
src/
  app/                     # Next.js App Router pages + API routes
    api/                   # Server-side endpoints (HubSpot, enrichment, KPIs)
    dashboard/             # Main KPI dashboard
    accounts/              # Company list
    account/[companyId]/   # Single company detail (health, deals, upsell signals)
    upsell-signals/        # Aggregated upsell opportunities across portfolio
    pipeline/              # Deal pipeline (renewals + upsell)
    nrr/                   # Net Revenue Retention detail by CSM
    commissions/           # CSM commission tracking
    forecast/              # Revenue forecast (month/quarter)
    renewals/              # Upcoming renewals
    portfolio/             # CSM portfolio overview
    trends/                # NRR trends over 6/12 months
  components/
    layout/                # Sidebar, Header, FilterBar, ThemeProvider
    charts/                # KpiCard, BarChart, LineChart, DonutChart
    tables/                # DealsTable, PortfolioTable
    ui/                    # ErrorBoundary, ErrorState
  lib/
    constants.ts           # CSM team, deal stages, HubSpot IDs, periods
    types.ts               # Domain types (Company, Deal, UpsellSignals, HealthScore)
    utils.ts               # Formatting (currency, percent, date), class utils
    hooks.tsx              # useFetch (auto-retry), useRefresh, useGlobalFilters
    cache.ts               # In-memory cache with TTL (10 min)
    hubspot/               # HubSpot API wrappers (companies, deals, owners)
    enrichment/            # Pappers cartography, Claude qualification, Supabase storage
    scoring/               # Health score (9 signals) + upsell score (5 signals)
```

## Conventions

- **Colors**: Use CSS variables from the design system (`text-text-primary`, `bg-card`, `text-positive`, etc.), never hardcoded Tailwind colors like `bg-emerald-50`. This ensures dark/light mode works.
- **Data fetching**: Use `useFetch<T>()` hook. It handles period/csmId from URL params, global refresh, and retries.
- **Toasts**: Use `toast.success()` / `toast.error()` from `sonner` for async action feedback.
- **CSM team**: Always reference `CSM_TEAM` / `CHART_CSMS` from `constants.ts`, never hardcode names/colors.
- **Enrichment storage**: Supabase table `upsell_enrichments`. Each company enriched at most once (~$0.30 per enrichment via Claude web_search).

## Key business logic

- **Health score** (`lib/scoring/health.ts`): 9 weighted signals (ROI, revenue, product usage, support, activity). Grades: excellent (75+), good (50-74), warning (30-49), critical (<30).
- **Upsell score** (`lib/scoring/upsell.ts`): 5 signals (sibling brands, stores, languages, MRR, plan). Grades: hot (>70), warm (40-70), cold (<40).
- **NRR**: Calculated from CSM-attributed deals (upsell, churn, downsell) over a rolling period.
- **Enrichment**: Website scraping → SIREN extraction → Pappers cartography BFS → Claude qualification (web_search) → ICP scoring.

## Known quirks

- HubSpot deal stage IDs are inverted: `closedlost` constant = actually "Closed Won" in HubSpot. See `constants.ts`.
- `CSM_TEAM` is hardcoded (6 members). If team changes, update `constants.ts`.
- In-memory cache (`cache.ts`) is per-instance on serverless — cold starts lose it.
