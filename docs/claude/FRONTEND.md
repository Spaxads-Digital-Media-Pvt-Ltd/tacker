# Frontend Documentation

## Framework & Entry
- **React 18** SPA with TypeScript 5
- **Vite 5** dev server on port 5173
- **Entry**: `src/main.tsx` → wraps App in BrowserRouter → ThemeProvider → AuthProvider
- **Routing**: React Router 6, all routes defined in `src/App.tsx`

## Routing

Four role-gated surfaces (UX-only gating — backend enforces authorization):
```
/login — Login page
/forgot-password — "Forgot password?": emails a one-time reset link (O1)
/reset-password — Where that link lands: choose a new password (token dropped from the address bar)
/change-password — First sign-in with an invite's temporary password: choose your own first (ProtectedRoute sends every route here while `session.mustChangePassword`)
/admin · /admin/usage · /admin/activity · /admin/team — Super Admin › Overview (`pages/super-admin/Overview.tsx`: per-currency MRR / billing, needs attention, recent activity), Usage (every network vs its plan limits), Activity (platform audit, `lib/platformActivity.ts` labels), Team & roles (members with their role, add / change role / disable / reset password, own password; Roles tab: built-in + custom roles, Hidden / Read / Full per section, scope, landing page — Owner only)
  Super Admin roles in the SPA: `lib/PlatformMeProvider.tsx` loads `/platform/me` around the Super Admin shell; `usePlatformMe().can(section, level)` (`lib/platformMe.ts`) hides nav items (`perm` on `NAV.super_admin` entries, `permittedNav` in AppShell), wraps every `/admin/*` route in `<PlatformGate section>` ("Your role (X) doesn’t include Y") and hides edit buttons; sign-in lands on the role's `home`
/admin/plans · /admin/billing · /admin/invoices/:id · /admin/settings — Super Admin › plan catalog; platform invoices (summary per currency, Mark paid / More time / Void, one-off invoice, Run billing now; `pages/super-admin/invoiceActions.tsx`); printable invoice (`shared-components/panels/InvoiceDocument.tsx`); billing settings. /admin/subscriptions redirects to /admin/plans
/admin/sales · /admin/sales/leads · /admin/sales/leads/:id · /admin/sales/pipeline · /admin/tasks — Super Admin › Sales (`pages/super-admin/sales/`): dashboard (KPIs, funnel, leads per week, leaderboard, sources, trials to convert, my tasks), Leads (filters, CSV, `LeadForm`), Pipeline (kanban, native HTML5 drag-and-drop; Lost asks why, Won offers convert — `parts.tsx`), a lead (stage bar, timeline composer, deal / contact, tasks, `ConvertLead` → network + one-time owner password). Tasks (`Tasks.tsx`, shared `TaskList.tsx` / `TaskForm`). Shared dashboard pieces: `pages/super-admin/kit.tsx` (KpiTile, Panel, PerCurrency, BarList, TrendChart, Avatar, Chip, Pager); `lib/platformSales.ts` (stages, sources, types, `useStaff`); `lib/relativeTime.ts`
/admin/success — Super Admin › Customers › Customer health (`pages/super-admin/success/HealthBoard.tsx`): KPIs by health, at risk, biggest drops, stalled onboarding, trials ending, my check-ins, latest notes, the accounts table (assign account managers inline). A network's page is tabbed (`?tab=Overview|Account|Billing|Team|Activity`); Account = `success/NetworkAccount.tsx` (health parts + 90-day sparkline, signals, onboarding checklist, account manager / seller / tags, tasks, notes). `lib/platformSuccess.ts` (statuses, parts, types)
/admin/support · /admin/support/:id · /admin/support/macros — Super Admin › Support (`pages/super-admin/support/`): the desk (KPIs, tickets per day, team load, views Unassigned · Mine · All open · Overdue · Resolved · Closed with `?view=`), a ticket (thread with internal notes, Reply / Internal note composer + saved replies, Send & resolve; properties, SLA, network card with "Open their dashboard", other tickets), saved replies. Settings is tabbed (`?tab=Billing|Support`; `support/SupportSettings.tsx`). `lib/platformSupport.ts` (statuses, priorities, categories, types)
/app/support · /app/support/:id — the network's Help & support (`pages/admin/Support.tsx`, `SupportTicket.tsx`): their tickets, new ticket, the thread, "This solved it", reopen, 1–5 rating. The rail's Help menu links there (badge when support is waiting on them); Super Admins get "Support desk"; portals keep the email link
/admin/revenue · /admin/coupons — Super Admin › Money (`pages/super-admin/money/`): Revenue (Finance's home: MRR / ARR / customers / ARPA, net new MRR, logo churn, LTV, trial → paid, outstanding / overdue, 12-month MRR trend, cash collected vs invoiced, MRR by plan, top customers, renewals; one currency at a time) and Coupons (create / archive). A network's Billing tab adds `money/NetworkDiscount.tsx` (apply a coupon by code, remove it). Invoices show their lines and credit notes (`InvoiceDocument`); paid invoices get a "Credit note" action (`InvoiceActionModals.CreditNoteModal`); Billing has "Export CSV"; plans take overage prices. `lib/platformRevenue.ts` (coupon helpers, summary types)
/admin/flags · /admin/announcements · /admin/system — Super Admin › Platform (`pages/super-admin/platform/`): Feature flags (rollout slider, plans, networks on / never, kill switch), Announcements (editor with a live banner preview; publish / back to draft / archive), System health (Postgres, Redis, queues — failed jobs: why, retry, clear; refreshes every 30 s); Settings › Email (`platform/EmailSettings.tsx`: SMTP, test, notifications, log). ⌘K / Ctrl+K opens search (Super Admin: `shell/PlatformSearchModal.tsx`). Tenant shell: `shell/AnnouncementBanner.tsx` (dismissible, maintenance window) and nav items with `feature` hidden when their flag is off (`featuredNav` in AppShell; `/api/me` `features` / `announcements` via `lib/useNetworkBranding.ts`)
/request-demo — public "Request a demo" (`pages/RequestDemo.tsx`, `authClient.requestDemo`) → a Sales lead; linked from the login page
/app/billing · /app/billing/invoices/:id — the network's own plan, usage vs limits, invoices and how to pay (staff; Control Center flyout › Billing); the shell shows `OverdueInvoiceBanner` while an invoice is overdue (`/api/me billing.overdue` via `lib/useNetworkBranding.ts`). Money helpers: `lib/platformBilling.ts` (amounts as text, never floats)
/admin/networks/:id — Super Admin › one network: overview, owner, plan & usage, team (temporary password), Super Admin activity, "Open dashboard" (support session in a new tab, `lib/impersonation.ts useSupportSession`)
/impersonate — Starts an admin impersonation session in this tab (opened by Impersonate)
/admin/* — Super Admin (role: super_admin)
/app/* — Network Admin (role: admin)
/publisher/* — Publisher portal (role: publisher)
/advertiser/* — Advertiser portal (role: advertiser)
```

All routes are **lazy-loaded** via `React.lazy()` for per-route code splitting.

### Admin Routes (`/app/*`)
| Route | Component | Feature Area |
|---|---|---|
| `/app` | DashboardHome | Overview |
| `/app/offers` | Offers | Offer management |
| `/app/offers/new` | OfferCreate | Create offer |
| `/app/offers/:id` | OfferDetail | Offer detail |
| `/app/offers/:id/edit` | OfferEdit | Edit offer |
| `/app/offers/bulk-edit` | OffersBulkEdit | Bulk operations |
| `/app/publishers` | Publishers | Partner management |
| `/app/publishers/:id` | PublisherDetail | Partner detail |
| `/app/publishers/:id/edit` | PublisherEdit | Edit partner |
| `/app/advertisers` | Advertisers | Advertiser management |
| `/app/advertisers/:id` | AdvertiserDetail | Advertiser detail |
| `/app/advertisers/:id/edit` | AdvertiserEdit | Edit advertiser |
| `/app/domains` | TrackingDomains | Tracking domains — custom hosts get a DNS setup modal (TXT record, CNAME target, Verify now); Activate / Disable per row |
| `/app/reports/*` | Report* | 12 report types |
| `/app/analytics` | Analytics | Dimensional analytics |
| `/app/ai` | AiOps | AI operations |
| `/app/smart-links` | SmartLinks | Smart link management |
| `/app/traffic-health` | TrafficHealth | Traffic health monitoring |
| `/app/investigator` | Investigator | Fraud investigation |
| `/app/automation` | Automation | Scheduled actions, alerts, webhooks |
| `/app/control-center` | ControlCenter | Platform configuration |
| `/app/integrations` | Integrations | External integrations |
| `/app/communication-hub` | CommunicationHub | Email/SMS hub |
| `/app/marketplace` | Marketplace | Advertiser marketplace |
| `/app/customer-value` | CustomerValue | Customer value rules |
| `/app/alerts` | Alerts | Alert management |

Plus many more sub-routes (offers-templates, offers-groups, postbacks, tiers, coupons, invoices, etc.)

### Publisher Portal (`/publisher/*`)
| Route | Component |
|---|---|
| `/publisher` | DashboardHome |
| `/publisher/offers` | PublisherOffers |
| `/publisher/offers/:id` | PublisherOfferDetail |
| `/publisher/stats` | ReportView (stats) |
| `/publisher/earnings` | PublisherEarnings |
| `/publisher/api-keys` | ApiKeys |

### Advertiser Portal (`/advertiser/*`)
| Route | Component |
|---|---|
| `/advertiser` | DashboardHome |
| `/advertiser/offers` | AdvertiserOffers |
| `/advertiser/offers/:id` | AdvertiserOfferDetail |
| `/advertiser/stats` | ReportView (stats) |
| `/advertiser/api-keys` | ApiKeys |

## Components

### Core Shell
- **`AppShell.tsx`** — Main layout (sidebar rail + header + flyout + main content area)
- **`NavFlyout.tsx`** — Everflow-style flyout menus from sidebar
- **`SectionTabs.tsx`** — Horizontal tab bar for grouped sections
- **`PageTitle.tsx`** — Dynamic page title context
- **`ProfileMenu.tsx`** — User profile dropdown

### UI Primitives
- `Accordion.tsx` — Expandable sections
- `CategorizedFilters.tsx` — Filter UI
- `CollectionTab.tsx` — Tab navigation
- `CopyBox.tsx` — Clipboard copy with feedback
- `CustomFieldsPanel.tsx` — Custom fields editor
- `CustomSettingFields.tsx` — Custom settings input
- `DualListPicker.tsx` — Dual list picker (e.g., for permissions)
- `LabelsEditor.tsx` — Label/tag editor
- `MacroTokenPicker.tsx` — Macro variable picker
- `MarketplaceProfileCards.tsx` — Marketplace profile display
- `PerformanceChart.tsx` — Chart wrapper
- `Sparkline.tsx` — Small sparkline chart
- `StatCards.tsx` — KPI stat card grid
- `Stepper.tsx` — Step wizard
- `TableActionsKit.tsx` — Table row actions
- `SearchFilterDrawer.tsx` — Slide-out filter panel
- `SearchModal.tsx` — Global search modal (⌘K affordance)
- `TrackingLinkGeneratorModal.tsx` — Generate tracking link
- `PostbackTester.tsx` — Test postback UI
- `Brandmark.tsx` — Logo/brand display; with `logoUrl` (the network's Control Center logo, `lib/useNetworkBranding.ts` from `GET /api/me` — staff and portals; also sets the tab favicon) that image takes its place, falling back to the default mark if it doesn't load (O12). Logo / favicon / profile photo uploads go to object storage through `lib/imageUpload.ts` (PNG / JPEG / WebP / GIF, favicon also ICO, ≤ 2 MB, no SVG — refused with the reason); forms keep only the returned URL
- `HelpHint.tsx` — Help tooltip

### Data Fetching
- **`useApi.ts`** (`lib/useApi.ts`) — `useQuery<T>(path)` + `useMutation(fn)` hooks. A mutation's `run` never throws (a failure → `null` + `error`), so a caller using `run` must render `error`; `runOrThrow` also throws — use it in a confirm dialog's `onConfirm` (the dialog shows the message and stays open) or a try/catch. (`hooks/useApi.ts` is an older copy, used only by `constants/offerTemplateFields.ts`.)
- **`api.ts`** — `Api` class with `get/post/patch/put/del` methods
 - Auto-attaches Bearer token
 - Transparent 401 → refresh token → retry (deduped)
 - Unwraps `{ ok: true, data: T }` envelope
 - Throws `ApiError` on failure

## State Management
- **No external state library** — React `useState` + `useContext`
- **`AuthContext`** — Session state (signIn/signOut)
- **`ThemeContext`** — Light/dark theme toggle
- **`localStorage`** — Session persistence (`tracker.session.v2`), theme preference
- **`sessionStorage`** — An impersonation tab's own session (`tracker.impersonation.v1`, `auth/session.ts`): it wins over the localStorage login in that tab only; refresh / sign-out there never touch the admin's login
- Per-page: local `useState` + `useQuery` from `useApi.ts`

### Impersonation (admin → partner / advertiser portal)
Publishers / Advertisers row menu › Impersonate (`lib/impersonation.ts`): opens a tab inside the click (a blocked popup is reported and no token is issued), POSTs `/api/{publishers|advertisers}/:id/impersonate`, then points the tab at `/impersonate#token=…`. `pages/Impersonate.tsx` checks the token's claims, stores it as that tab's session, strips the token from the address bar and opens the portal. `ImpersonationBanner` (AppShell) shows who is viewed and when it ends, with End impersonation (closes the tab). A 401 in that tab ends the impersonation (no refresh). Needs `IMPERSONATION_JWT_SECRET` on the dashboard API.

## Authentication

### Login Flow
```
User enters credentials → POST /api/auth/login
 → Backend: Supabase Auth signInWithPassword
 → Backend: Set httpOnly cookie "tracker_rt"
 → Backend: Return { access_token, identity }
 → SPA: saveSession() to localStorage
 → Router redirects to ROLE_HOME[role]
```

### Session Refresh
- 401 response → call `/api/auth/refresh` (uses httpOnly cookie)
- Token rotation: refresh response includes new token, cookie rotated
- Deduped inflight refresh (one concurrent refresh at a time)
- Super Admin sessions (platform token from `POST /platform/login`, see `authClient.loginPlatform`) are never refreshed: a `/platform/*` 401 clears the session → `/login`; a tenant `/api/*` 401 just fails that call. The rail's notifications bell (audit feed + Notification Preferences) is network staff's: the shell only renders it for `session.role === 'admin'` (N1) — partner / advertiser portals and the Super Admin console don't show it. "Created By" columns (Automation, an offer's Scheduled Actions) show the API's `createdByName` via `lib/createdBy.ts` (`Unknown user` for a login with no team member, `System` for none) — never a raw id (N2)

### Role System
| Role | Surface | Landing Route |
|---|---|---|
| `super_admin` | `/admin/*` | `/admin` |
| `admin` | `/app/*` | `/app` |
| `publisher` | `/publisher/*` | `/publisher` |
| `advertiser` | `/advertiser/*` | `/advertiser` |

## API Integration

- **Base URL**: `import.meta.env.VITE_API_BASE_URL` (empty in dev → relative)
- **Dev proxy**: Vite proxies `/api` → `:4001`, `/platform` → `:4004` (override with `VITE_API_PROXY` / `VITE_PLATFORM_PROXY`)
- **Auth header**: `Authorization: Bearer <token>`
- **Credentials**: `credentials: 'include'` (for refresh cookie)
- **Envelope**: `{ ok: true, data: T }` success, `{ ok: false, error: { code, message } }` error
- **Error messages**: the envelope's `message` is shown as is; failures with no envelope (server unreachable, timeout, a gateway/proxy answering) get sentences from `lib/errorMessages.ts`

## Styling System

- **Tailwind CSS 3** with custom design tokens in `src/index.css`
- Design tokens stored as **RGB triplets** for alpha support:
 ```css
 --accent: 13 148 136; /* teal-600, used as rgb(var(--accent) / 0.5) */
 ```
- Fonts: **Inter** (UI), **Space Mono** (IDs/tokens/codes)
- Theme: Light default, optional dark (`.dark` class on `<html>`)
- Custom components via `ui.tsx` (shadcn/ui-style primitive components)

## Reporting System

The frontend has a comprehensive reporting system mirroring Trackog:
- **`reportFilters.ts`** — Filter catalog (group by, metrics, columns)
- **`ReportView.tsx`** — Generic report page with filter drawer
- **`ReportPageKit.tsx`** — Shared scaffold for all report pages
- **`export.ts`** — Excel (XLSX) export
- Default report types: Offer, Partner, Advertiser, Smart Link, Daily, Hourly, Impression, Click, Conversion, Event, Pacing, Click-to-Conversion, Partner Postback, Advertiser Postback, Partner Referrals, Custom Metrics, Products, Refunds, Conversion Imports, Saved/Scheduled
- **Filters on report pages:**
  - `/api/reports` pages (Offer, Partner, Advertiser, Smart Link, Daily, Hourly, Flex, Nested, Variance) send every selected value (`appliedFilters[x]?.join(',')`), incl. exclusions. Detail-endpoint pages (Click, Conversion, Event, Click-to-Conversion, Postback reports, Cohort, Funnel) are **single-select** (`ReportingFiltersFlyout singleSelect sections={['filters']}`) because those endpoints take one value — never show a control the API ignores.
  - **Which filter UI where:** every Reporting/Analytics page uses the compact `ReportingFiltersFlyout` ("Reporting Filters" popover under the Filters button). List/management pages (Offers, Partners, Advertisers, invoices, …) keep the full-height `SearchFilterDrawer` / `CategoryFilterDrawer` side panel. Both use Cancel → Apply.
  - Applied filters/exclusions round-trip through the URL (`f.<key>=a,b` / `x.<key>=a,b`) via `lib/reportFilterState.ts`, so reload / back / a shared address-bar link keep them (there is no separate "Copy Link"). Saved presets (`lib/savedReports.ts`, F-24) live on the server (`/api/saved-reports`, the user's own) with a per-user localStorage cache (`tracker.savedReports.<page>:<networkId>:<email>` — people sharing a browser never see or take over each other's): a page shows the cache at once, then `useServerSavedReports` / `syncSavedReports` load the server list; Save / Delete write the cache and the server (`persistSavedReports`). The pre-F-24 browser-wide list (`tracker.savedReports.<page>`) is uploaded once as the signed-in user's and then removed (kept for a retry if an upload fails). Entries are shape-checked on load (`loadSavedReports`). Reporting › Saved & Scheduled lists them from the server; a report's ⋮ menu has Schedule… (`ScheduleReportModal`: daily / weekly / monthly at a time of day or a custom cron, the date range each email covers, recipients; next / last run in the network time zone — `lib/reportSchedule.ts` maps the choices to the API's cron). The Scheduled tab lists the network's scheduled reports (`?scope=network`, with an Owner column) for admins / managers and the caller's own for other roles (role from `/api/me`), with Edit schedule, Send now, Open report and Remove schedule. Every role can schedule (D4): when a report's `scheduleTo` is `self` (its owner is Finance / Read-only) the modal shows the owner's email instead of a recipients box; a disabled owner's report can only be unscheduled.
- **Money and currency** (`lib/reportMath.ts`, `lib/reportCurrency.ts`, `ReportMoney.tsx`): report pages request the `currencies` metric and format each row in its own currency; a row whose conversions span several currencies shows "Mixed" (never a summed amount — no FX yet), and exports leave its money blank with currency `MIXED`. Totals never add currencies: Summary tiles / totals (SummaryGrid, Variance, Smart Link + Offer Group stats, Dashboard KPIs) show a mixed total as its per-currency amounts (`moneyText` / `formatBreakdown`, "€30.25 · $13.00", code order) from the opt-in `money_by_currency` metric (requested on summary queries only via `withBreakdownMetrics`) or the endpoints' `moneyByCurrency`; table cells stay "Mixed" with the breakdown in the tooltip; money ratios (CPC/CPA/EPC/RPC/RPA/Margin %) stay "Mixed". Money sorting: when `/api/reports` answers a money `orderBy` with `sortedWithinCurrency` and the rows span currencies, the table shows "Sorted within each currency (no FX conversion)" (`CurrencyNotes`); any client-side money sort uses `moneyRowComparator` (single-currency rows by code then value, then no-money rows, mixed last). Money metric filters (Payout/Revenue) apply only while the loaded rows share one currency (`moneyFilterBlockedBy`); otherwise the flyout disables them ("Money filters need a single currency — results span EUR, USD") and an applied one is shown as "not applied" and skipped (`passesMetricFilters(…, skipMoney)`, `filterWithMoneyRule` for exports). Period comparisons (Variance, Dashboard change %) use `comparePeriods`: "Mixed" / "—" unless both periods are in one currency (a period with no money compares as zero). Analytics (Flex, Dimensional, Nested, Variance, Cohort), Smart Link details, the Dashboard home (KPIs, Performance chart, top entities, portal tiles) and Offer Groups (today stats in the conversions' currency; caps in the group's) are currency-safe; mixed money series are not plotted.
- **Partner balances** (`lib/balanceCurrency.ts`): Request Outstanding Balances (Manage Partners ⋮), the partner portal's Earnings "Payable balance" and the portal home's balance tile read the per-currency `balances` (fallback `balance` + `currency` / `balanceCurrency`) — one currency shows that amount, several show "€30.25 · $13.00" (never summed; `balance` is null then). Request Balances totals per currency with exact decimal addition; a mixed partner is listed with its breakdown, and a row without currency info (older API) is listed on its own, never totalled. Earnings statement rows show each entry's own ledger currency.
- **Add Conversion** (`pages/admin/AddConversion.tsx`): there is no currency control — the request omits `currency`, so the backend records the conversion in the selected offer's currency (shown under the amounts). Payout/Revenue are checked with the backend's rule (`lib/moneyInput.ts`: non-negative, ≤ 10 integer digits, ≤ 4 decimals, no sign / thousands separators) — inline error + Add disabled; a backend 422 is shown with its field details.
- **Click report filter modal** (`pages/admin/clickReport/ClickFiltersModal.tsx`, logic in `lib/clickReportFilters.ts`): replaces the compact flyout on the Click report only. One draft for Offer / Partner / Advertiser / Smart Link / Country / Conversion Status pickers, display Timezone, Click IDs (comma list), IP, Source / FB Click ID / Google Click ID (exact click-URL values), Device, Visibility (`isUnique`) and the "Click Report Fields" checklist (search + Select All over the matching fields; untracked fields listed disabled, each with a tooltip naming its missing dependency — landing pages, a click-URL parameter, a device-ID privacy decision, the MaxMind City / Connection-Type DB, IPQS check state, or a full-URL storage/redaction decision). Apply commits; Cancel / × / Escape / backdrop discard. Selected fields drive the table, the export and the `cols` URL param (omitted when default); Table Actions › Columns Customization opens the same section. The applied-filter count ignores dates, timezone and columns.
- **Click report Group By**: the grouped table shows a Total row from the API `totals` (every group, also when "Search groups…" hides some), labels Day buckets "Day (UTC)", and its Conversions / money headers say they count approved conversions only (`groupDimensionHeader`, `GROUPED_CONVERSIONS_NOTE` in `lib/clickReportFilters.ts`); the grouped export uses the same header. Table Actions closes on outside click / tap and Escape.
- **Conversion report** (`pages/admin/ConversionReport.tsx`, rules in `lib/conversionReport.ts`): Conversion ID / Click ID columns (Columns Customization, off by default; always exported). Money is in the currency stored on the conversion — a conversion with none is a plain amount with a note and Currency "—" (never an assumed USD), in the table and the export. Approve / Reject show only for the `admin` / `finance` roles (`GET /api/me` identity.role). Table Actions closes on outside click / tap and Escape. Reasons read in words (`reasonLabel`; the code is the cell's tooltip); filter **Over Caps** (`overCaps=true`) lists the conversions held over a cap, to approve or reject.
- **Super Admin › Networks** (`pages/super-admin/Networks.tsx`, D3): per network Suspend / Activate, Delete (soft; confirm), a deleted network's "Deleted … · can be restored until …" line (or "can be purged now"), Restore, Export (NDJSON via `api.download`), Purge (enabled from `purge_after`; type the slug; export now or "Purge without an export"); **Purged networks** lists the tombstones with "Download ledger (CSV)". Sign-out reasons `network_suspended` / `network_deleted` / `network_purged` (`lib/api.ts` ENDED_REASONS — also from a refused refresh, `authClient.lastRefreshRefusal`) are explained on the login page.
- **Advertiser Postback report** (`pages/admin/AdvertiserPostbackReport.tsx`): the inbound postback log (`GET /api/reports/inbound-postbacks`) — every postback / pixel / iframe / API request, recorded or not: Status (Approved / Pending / Rejected / Duplicate / Click not found / Security failed / Error — `INBOUND_OUTCOME_LABELS`), Reason in words, Click ID, Event, CV Method (incl. API), money; filters Status, Recorded (`recorded=true|false`), CV Method, Offer / Partner / Advertiser; IP and HTTP Status columns hidden by default.
- **Click report rejected clicks**: Is Rejected / Rejection Reason (`clickRejection` in `lib/clickReportFilters.ts`, from the first fraud flag) — clicks /click didn't send to the offer, recorded as invalid.
- **Offer › Revenue tab**: Duplicate Conversions (`DUPLICATE_MODE_OPTIONS` in `offerForm/settings.ts` — unique transaction IDs / every postback / one per click per event; `allowDuplicates` kept in step) and Hold Unusual Volume (`clickConversionLimit`, per 10 minutes, 0 = off). **Offer › Goals**: a per-event Duplicate conversions rule (blank = the offer's).
- **Offer report** (`pages/admin/OfferReport.tsx`, rules in `lib/offerReport.ts`): sorting "Clicks" uses `orderBy=valid_clicks` (the net clicks shown; `clicks` = gross stays valid for old links); sort headers are real buttons with `aria-sort`; every metric header has a tooltip stating its definition (CV = approved, Total CV = all statuses, CVR = CV ÷ net clicks); known offers show their ref, an offer / partner missing from the list shows its full id ("Unknown offer (…)"), never an 8-char prefix; the partner drill-down says when it shows only the top partners; CSV / Excel carry `offerId` and the API's exact money text (no toFixed re-rounding); Page / Table Actions close on Escape.
- **Advertiser report** (`pages/admin/AdvertiserReport.tsx`, rules in `lib/advertiserReport.ts`; reuses `offerDisplay` / `exactMoney` from `lib/offerReport.ts`): "Clicks" sorts by `orderBy=valid_clicks` (the net clicks shown); EPC (the API `epc` = payout ÷ gross clicks) is now sortable by that same ratio (currency-partitioned); sort headers are buttons with `aria-sort`; every metric header has a definition tooltip; known advertisers show their ref, unknown advertiser / offer ids show in full; the offer drill-down says when it shows only the top offers; CSV / Excel carry `advertiserId`, exact money text and EPC as the API computed it; Page / Table Actions close on Escape.
- **Flex report** (`pages/admin/analytics/FlexReport.tsx`, rules in `lib/flexReport.ts`): "Clicks" shows net clicks and sorts by `orderBy=valid_clicks` (`FLEX_COLUMN_SORT`), which is also the default sort. An old link or saved report with `orderBy=clicks` is read as that same column (`flexOrderBy`); any other unknown `orderBy` falls back to the default. Export rows come from `flexExportRow` (see Export precision).
- **Performance Graph data** (`useGraphRows` + `GraphCappedNote` in `ReportPageKit.tsx`, paging in `lib/reportPaging.ts`): Offer, Partner, Advertiser, Smart Link, Daily, Flex, Nested and Dimensional page their day series (Flex / Nested / Dimensional: an hour series for a single-day range) through `/api/reports` in 200-row requests — the API's page cap — up to `GRAPH_DAY_CAP` (1,000 points); Hourly pages its hour series the same way up to `GRAPH_HOUR_CAP` (24 × 93 hours). The API returns a day / hour series oldest-first, so the former single `limit=200` request dropped every newer active day. Past the cap the graph keeps the oldest points and shows "Graph shows the first N days (hours) — narrow the date range to see the rest." Pages are fetched one after another, so a range with more than 200 active days takes several requests (5 for 1,000+). The graph loads when opened (Dimensional's charts on every load, while any chart is selected); reopening it with an unchanged range shows the last result while it reloads. Days with no activity have no point (not zero-filled).
- **Export precision** (`exportRatio` in `lib/reportMath.ts`, `moneyExportCells` in `lib/reportExportCells.ts`): stored money (Payout / Revenue / Profit) is exported as the API's exact numeric text (`exactMoney`, e.g. `3.0050`) and EPC as the API's own value (`apiEpc`, payout ÷ gross clicks, 4 places). CPC / CPA / RPC / RPA are calculated in the browser and exported with `exportRatio`: 2 places rounded like the on-screen `money()` (Intl), no symbol or thousands separator — `toFixed(2)` exported 3.005 as `3.00` while the table showed $3.01. Offer, Advertiser and Flex already exported exact money; Partner, Smart Link, Daily, Hourly and Nested (parent rows) now do too, so their money columns carry up to 4 decimals. Column order is unchanged, and a mixed-currency row still exports its money / ratio cells blank with currency `MIXED`. Not yet covered: Customer Value › Conversion Events still shows and exports `$` + 2 places.
- **Click report Browser / OS** (`lib/userAgentDisplay.ts`): stored values (ua-parser-js output of the click's real User-Agent) are shown without false precision — reduced-UA `Chrome 155.0.0.0` → "Chrome 155", "Windows NT 10.0" → "Windows 10/11" (10 and 11 send the same token), frozen macOS 10.15 / 10.15.7 → "Mac OS 10.15+", reduced Android "10; K" → "Android 10+" — with a tooltip saying why (labels keep a version range so they never merge with a versionless stored value such as "Windows"); table, page search and export share the value. Missing values show "—". Stored data is unchanged (Traffic Controls match on it). The Conversion report (cells + export) uses the same helpers, and Analytics (Dimensional, Dynamic Nested, Flex, Variance, Funnel) shows os/browser row labels through `uaDimensionLabel` — label only: the raw stored value stays the row key, filter value and drill-down param. Without a User-Agent (Conversion report, Analytics) a reduced Android "10" cannot be proven and stays "Android 10".
- **Status filters** (`lib/reportStatusFilters.ts`): Click report `conversionStatus` (any/approved/pending/rejected/none; absent = all clicks) and Click → Conversion Time `status` (absent = approved). Event rows are keyed per goal id (`lib/goalRows.ts`); goal-less conversions show "(no goal)".
- **Offer-group caps** are labelled "Not enforced" (`NotEnforcedBadge`) wherever shown — nothing blocks traffic when they are reached.
- **Reporting page layout** (all pages under Reporting and Analytics, plus Customer Value › Conversion Events): no top filter card and no "Run Report" — every control applies on its own. Pages that need a required input before they can query (Funnel: target + ≥2 events; Flex: ≥1 column; Conversion Events: a User ID, debounced) send nothing until it's there and say so in the results body. Analytics pages that mirror state to the URL always keep the `tab` param.
  - `shared-components/primitives/ReportLayout.tsx`: `ReportCard` › `ReportControls` (date range + page selects on the left; Clear · `FiltersButton` · page ⋮ pinned right) › `ResultsBar` (title, "Updating…", chips; view-only controls like timezone / search-this-page / table ⋮ on the right — these never refetch) › `ReportBody`. Aggregate reports put the collapsible Summary inside the first card under the controls. `REPORT_CONTROL` (`reportControl.ts`) = shared 40 px control height.
  - Dates: `useAutoDateRange` (`pages/admin/reportView.ts`) commits a typed range once it has settled (400 ms debounce) and is valid (real days, From ≤ To ≤ today); otherwise the page keeps the last good range and shows the problem inline. The committed range and the page number share one state, so a change resets to page 1 in a single render (one request). Filters / selects / chips apply immediately and call `toFirstPage()`.
  - Summary tiles use `groupBy=none` (exact grand total); expanded child rows always reuse the page's date range + filters, with the row's own id set last.
  - The legacy `/app/reports/:type` hub redirects to the dedicated pages (only `offline` and `import-export` still render there).
- **Report time zone** (D7 / O10 — every report page, the staff dashboard tiles, Smart Link "today", Traffic Health and the partner / advertiser portal Stats): `lib/useReportZone.ts` + `<TimeZoneSelect>` (`shared-components/primitives/ReportTimeZone.tsx`, rendered by `<DateRangeField zone={zone}>` beside the dates). Default = the network's zone (`GET /api/me` `reportTimeZone`, cached in localStorage per network so the first request already uses it; the browser's zone stands in on a first visit until it's known); the picker's choice is remembered per network + user (`tracker.reportZone.override:<networkId>:<email>`) across report pages and reloads. The page computes "today" / presets in it (`zone.today()`, `zone.daysAgo(n)` — `lib/reportZone.ts`), sends plain dates + `tz` (`zone.range(from, to)`; nothing for UTC), labels the range "Date range (UTC+05:30)" (the zone's short name, else its offset), and shows timestamps in it (`lib/datetime.ts` `formatDateTime` / `formatMdyDateTime`). Day / hour buckets are labelled by their own wall time (`lib/reportTime.ts` — never re-converted to UTC). A Country filter (Click / Conversion) adds that country's zones to the picker's suggestions. Range validation refuses only dates past today anywhere (`latestToday`, UTC+14). **Pacing counts cap-zone days** (each offer's cap time zone, else the network's — when caps reset; the Summary label names it); `ReportPageKit.toIso` remains for it and the Accounts audit log. **Cap time zone pickers** (`shared-components/primitives/CapTimeZoneSelect.tsx`): Settings › General "Daily caps reset at midnight in" (default UTC) and Create / Edit Offer › Caps › Cap Time Zone ("Network default — zone").

## Geo Reference Data

`src/data/geo/` is the single source for countries, regions, cities and timezones — import from `data/geo`, don't add local country lists.
- Values stay ISO codes (country alpha-2; region top-level ISO 3166-2 stored as `CC-XX`, which the tracking matcher accepts). Names are display-only; country names come from `Intl.DisplayNames`.
- `generated/` is produced by `frontend/scripts/generate-geo-data.mjs` from Debian iso-codes + GeoNames (sources and licences in the script header). Regions/timezones and the per-country city files load lazily (`useRegions`, `useTimezones`, `useCities`) as separate chunks.
- Device Characteristics (Platform / Browser / Device Brand / OS Version / Language) use the same picker with lists from `src/data/userAgent.ts` — the names ua-parser-js 1.0.x (api-backend `lib/ua.ts`) actually emits, since the tracker matches them exactly. Refresh it when that library is upgraded. OS Version options follow the included Platforms.
- Offer › Targeting uses `<SearchablePicker>` (`shared-components/primitives/SearchablePicker.tsx`) for Country/Region/City; Region and City follow the included Countries, DMA is disabled unless the US is included, and un-including a country offers to remove its now-orphaned Region/City/DMA values.

## Key Patterns

1. **Route-level code splitting**: Every page is `React.lazy()` + `<Suspense>`
2. **No redirect after login**: SPA uses `ProtectedRoute` — backend enforces all auth
3. **Search modal**: Global search (⌘K visual only, no keyboard handler wired)
4. **Responsive sidebar**: Collapsed icon rail → expanded labeled rail (desktop), off-canvas drawer (mobile)
5. **Per-user theme**: Theme choice persisted in localStorage, CSS-only toggle
6. **Column visibility**: Toggle columns on detail reports
