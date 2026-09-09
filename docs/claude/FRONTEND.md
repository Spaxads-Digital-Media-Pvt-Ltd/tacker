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
/forgot-password — Password reset
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
| `/app/domains` | TrackingDomains | Tracking domains |
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
- `Brandmark.tsx` — Logo/brand display
- `HelpHint.tsx` — Help tooltip

### Data Fetching
- **`useApi.ts`** — `useQuery<T>(path)` + `useMutation(fn)` hooks
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
- Per-page: local `useState` + `useQuery` from `useApi.ts`

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

### Role System
| Role | Surface | Landing Route |
|---|---|---|
| `super_admin` | `/admin/*` | `/admin` |
| `admin` | `/app/*` | `/app` |
| `publisher` | `/publisher/*` | `/publisher` |
| `advertiser` | `/advertiser/*` | `/advertiser` |

## API Integration

- **Base URL**: `import.meta.env.VITE_API_BASE_URL` (empty in dev → relative)
- **Dev proxy**: Vite proxies `/api` → `:4001`, `/platform` → `:4004`
- **Auth header**: `Authorization: Bearer <token>`
- **Credentials**: `credentials: 'include'` (for refresh cookie)
- **Envelope**: `{ ok: true, data: T }` success, `{ ok: false, error: { code, message } }` error

## Styling System

- **Tailwind CSS 3** with custom design tokens in `src/index.css`
- Design tokens stored as **RGB triplets** for alpha support:
 ```css
 --accent: 13 148 136; /* teal-600, used as rgb(var(--accent) / 0.5) */
 ```
- Fonts: **Sora** (UI), **Space Mono** (IDs/tokens/codes)
- Theme: Light default, optional dark (`.dark` class on `<html>`)
- Custom components via `ui.tsx` (shadcn/ui-style primitive components)

## Reporting System

The frontend has a comprehensive reporting system mirroring Trackog:
- **`reportFilters.ts`** — Filter catalog (group by, metrics, columns)
- **`ReportView.tsx`** — Generic report page with filter drawer
- **`ReportPageKit.tsx`** — Shared scaffold for all report pages
- **`export.ts`** — Excel (XLSX) export
- Default report types: Offer, Partner, Advertiser, Smart Link, Daily, Hourly, Impression, Click, Conversion, Event, Pacing, Click-to-Conversion, Partner Postback, Advertiser Postback, Partner Referrals, Custom Metrics, Products, Refunds, Conversion Imports, Saved/Scheduled

## Key Patterns

1. **Route-level code splitting**: Every page is `React.lazy()` + `<Suspense>`
2. **No redirect after login**: SPA uses `ProtectedRoute` — backend enforces all auth
3. **Search modal**: Global search (⌘K visual only, no keyboard handler wired)
4. **Responsive sidebar**: Collapsed icon rail → expanded labeled rail (desktop), off-canvas drawer (mobile)
5. **Per-user theme**: Theme choice persisted in localStorage, CSS-only toggle
6. **Column visibility**: Toggle columns on detail reports
