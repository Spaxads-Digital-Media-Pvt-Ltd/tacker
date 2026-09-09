# Project Structure

```
tacker/
├── api-backend/ Backend repository (independently deployable)
│ ├── .env.example Environment variable template
│ ├── package.json NPM scripts + dependencies
│ ├── src/
│ │ ├── config/
│ │ │ ├── env.ts Typed env loading (zod validation, fail-fast)
│ │ │ └── branding.ts Brand name (single source of truth)
│ │ ├── domain/
│ │ │ └── entities.ts TypeScript interfaces for DB row shapes (Phase 1+)
│ │ ├── middleware/
│ │ │ ├── host-resolver.ts Tenant resolution from tracking host
│ │ │ └── types.ts Shared middleware type definitions
│ │ ├── lib/ Shared libraries (not surface-specific)
│ │ │ ├── ai/ AI ops layer (Anthropic SDK)
│ │ │ ├── analytics/ Analytics writer (ClickHouse interface)
│ │ │ ├── apikeys/ API key generation, hashing, rate limiting
│ │ │ ├── auth/ JWT verification (jose JWKS + HS256)
│ │ │ ├── customer-value/ Customer value evaluation
│ │ │ ├── db/ Pool, ScopedDb, table registry, from-request
│ │ │ ├── fraud/ Fraud detection (rules, scan, alerts)
│ │ │ ├── geo/ MaxMind GeoIP2 integration
│ │ │ ├── http/ Shared Express/Fastify plumbing (envelope, errors, pagination)
│ │ │ ├── integrations/ Facebook CAPI, offer-feed-sync, PIN API
│ │ │ ├── investigator/ Investigation logic
│ │ │ ├── ledger/ Append-only money ledger
│ │ │ ├── observability/ Sentry, Prometheus metrics
│ │ │ ├── postback/ Postback test utilities
│ │ │ ├── postback-controls/ Dynamic control logic for postbacks
│ │ │ ├── reporting/ Reporting data aggregation
│ │ │ ├── retention/ Click/conversion pruning jobs
│ │ │ └── tiered-commissions/ Tiered commission logic
│ │ ├── surfaces/ The five segregated services
│ │ │ ├── dashboard/ Express — 50+ route modules for admin + portals
│ │ │ ├── tracking/ Fastify — /click, /postback, /pixel, /iframe, /sl
│ │ │ ├── public-api/ Express — /api/v1/* with API key auth
│ │ │ ├── platform-admin/ Express — /platform/* (super admin)
│ │ │ └── workers/ Node http — BullMQ processors
│ │ └── (no root files — all code is in modules)
│ ├── migrations/ 62 SQL migrations (node-pg-migrate)
│ ├── scripts/ 30+ utility scripts (seed, smoke, reconcile, etc.)
│ ├── test/ Isolation tests (cross-tenant/cross-owner)
│ └── docs/ Backend-specific docs
├── frontend/ Frontend repository (independently deployable)
│ ├── package.json NPM scripts + dependencies
│ ├── vite.config.ts Vite config with /api + /platform proxies
│ ├── postcss.config.js
│ ├── tailwind.config.js
│ ├── tsconfig.json
│ ├── src/
│ │ ├── main.tsx Entry point — providers (BrowserRouter, Theme, Auth)
│ │ ├── App.tsx Route definitions (lazy-loaded)
│ │ ├── index.css Design tokens (Sora + Space Mono fonts)
│ │ ├── types.ts Frontend TypeScript interfaces (DTO mirrors)
│ │ ├── vite-env.d.ts Vite env types
│ │ ├── auth/ Authentication context + session management
│ │ │ ├── AuthContext.tsx React context for session + signIn/signOut
│ │ │ ├── ProtectedRoute.tsx Role-gated route wrapper
│ │ │ ├── roles.ts Role type + ROLE_HOME landing routes
│ │ │ └── session.ts localStorage session persistence
│ │ ├── components/ Shared UI components (40+)
│ │ │ ├── AppShell.tsx Layout shell (sidebar + header + flyouts)
│ │ │ ├── NavFlyout.tsx Everflow-style rail flyout
│ │ │ ├── nav.ts Per-role navigation definition (4 roles)
│ │ │ ├── icons.tsx Lucide icon map
│ │ │ ├── PageTitle.tsx Page title context provider
│ │ │ ├── ReportPageKit.tsx Shared report page scaffold
│ │ │ ├── StatCards.tsx KPI stat cards
│ │ │ ├── PerformanceChart.tsx Sparkline charts
│ │ │ ├── PostbackTester.tsx Postback testing UI
│ │ │ ├── TrackingLinkGeneratorModal.tsx
│ │ │ └── ... more shared components
│ │ ├── pages/ Route-level page components
│ │ │ ├── DashboardHome.tsx Dashboard overview
│ │ │ ├── Login.tsx / ForgotPassword.tsx
│ │ │ ├── admin/ Admin portal pages (80+ files)
│ │ │ │ ├── Advertisers/, AdvertiserDetail.tsx, AdvertiserCreate.tsx, ...
│ │ │ │ ├── Publishers/, PublisherDetail.tsx, ...
│ │ │ │ ├── Offers/, OfferDetail.tsx, OfferCreate.tsx, OfferEdit.tsx, ...
│ │ │ │ ├── Reports/ (12 report types)
│ │ │ │ ├── Analytics.tsx
│ │ │ │ ├── SmartLinks/, TrafficHealth/, AiOps/, ...
│ │ │ │ └── ...
│ │ │ ├── portal/ Publisher/Advertiser portal pages
│ │ │ └── super-admin/ Super admin pages (Networks, Subscriptions, Usage)
│ │ ├── lib/ Shared utilities
│ │ │ ├── api.ts HTTP client (Bearer + envelope + auto-refresh)
│ │ │ ├── authClient.ts Login/logout/refreshToken (talks to backend)
│ │ │ ├── useApi.ts useQuery / useMutation hooks
│ │ │ ├── reportFilters.ts Trackog-compatible report filter catalog
│ │ │ ├── export.ts Excel export (xlsx)
│ │ │ ├── controlCenter.ts Control center data helpers
│ │ │ └── ...
│ │ ├── config/
│ │ │ └── branding.ts Brand name (single source of truth)
│ │ ├── data/ Frontend-side data (mock defaults, constants)
│ │ │ ├── creatives.ts
│ │ │ ├── segmentations.ts
│ │ │ ├── smartLinks.ts
│ │ │ ├── trafficControls.ts
│ │ │ └── ...
│ │ └── theme/ Theme (light/dark) context
│ │ ├── ThemeContext.tsx
│ │ └── ThemeToggle.tsx
│ └── node_modules/
├── docker-compose.yml Local dev infra (Redis 7, Postgres 16)
├── package.json Root-level (only ngrok as dep)
├── CONTRIBUTING.md Branch workflow rules
├── README.md Project overview + dev setup
├── .github/workflows/ci.yml GitHub Actions CI (backend tests + frontend build)
├── .gitignore
├── node_modules/ Root-level (ngrok)
└── _screenshots/ Screenshots (reference design assets)
```

## Key Folder Purposes

### `api-backend/src/surfaces/dashboard/`
The main admin + portal surface. Each subdirectory is a feature area with its own `routes.ts`:
```
dashboard/
├── main.ts Entry point → buildDashboardApp()
├── app.ts Route assembly (mounts all 50+ route modules)
├── auth.ts Auth middleware (dashboardAuth, requireAdmin, requireRole, requirePortal)
├── auth-routes.ts POST /login, /refresh, /logout
├── offers/ Offer CRUD routes
├── publishers/ Publisher CRUD routes
├── advertisers/ Advertiser CRUD routes
├── reports/ Report generation routes
├── tracking-domains/
├── finance/
├── alerts/
├── ai/
├── tags/
├── custom-fields/
├── settings/
├── smart-links/
├── offline/
├── import-export/
├── catalog/
├── invoices/
├── offer-templates/
├── offer-groups/
├── creatives/
├── custom-metrics/
├── marketplace-profile/
├── communication-hub/
├── customer-value/
├── traffic-health/
├── investigator/
├── automation/
├── audit-log/
├── conversion-imports/
├── traffic-controls/
├── offer-custom-settings/
├── smartswitch/
├── users/
├── postbacks/
├── partner-tiers/
├── partner-channels/
├── offer-categories/
├── business-units/
├── offer-applications/
├── questionnaires/
├── traffic-blocking/
├── traffic-sources/
├── reporting-adjustments/
├── coupon-codes/
├── partner-invoices/
├── link-templates/
├── postback-controls/
├── advertiser-invoices/
├── tiered-commissions/
├── control-center/
└── api-keys/
```

### `frontend/src/pages/admin/`
Each route in `App.tsx` maps to a lazy-loaded page here. Pages are colocated by entity:
- `Advertisers.tsx`, `AdvertiserDetail.tsx`, `AdvertiserCreate.tsx`, `AdvertiserEdit.tsx`, `AdvertisersBulkEdit.tsx`
- Same pattern for Publishers, Offers
- Reports: `OfferReport.tsx`, `PartnerReport.tsx`, `DailyReport.tsx`, etc. (12 types)
- Section tabs: `NetworkListPage.tsx` (offers-deals)

### `frontend/src/components/`
Shared UI primitives used across pages. No business logic — presentation only.
