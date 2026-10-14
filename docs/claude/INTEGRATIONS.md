# Integrations

## Supabase Auth
- **Purpose**: JWT issuance + verification, user management
- **Where used**: All authentication (dashboard + platform admin)
- **Files**:
 - `api-backend/src/lib/supabase.ts` — Admin client factory
 - `api-backend/src/lib/auth/verify-jwt.ts` — JWT verification (JWKS + HS256)
 - `api-backend/src/surfaces/dashboard/auth-routes.ts` — Login/refresh/logout
- **Authentication**: Server-side admin client (`SUPABASE_SERVICE_ROLE_KEY`)
- **Data flow**: Browser → Backend → Supabase Auth → Backend → Browser
- **Key point**: Browser NEVER talks to Supabase directly

## MaxMind GeoIP2
- **Purpose**: IP geolocation (country, region, city, ISP, datacenter detection)
- **Where used**: Click path (`tracking/surfaces/`), fraud detection
- **Files**:
 - `api-backend/src/lib/geo/geoip.ts` — GeoIP lookup + availability check
- **Authentication**: License key (`MAXMIND_LICENSE_KEY`) for DB updates
- **Data flow**: Redis-cached in-process at boot; fail-open if absent
- **Dev/test**: `geo=XX` query param overrides country

## Sentry
- **Purpose**: Error tracking and monitoring
- **Where used**: All surfaces (no-op when `SENTRY_DSN` is not set)
- **Files**:
 - `api-backend/src/lib/observability/sentry.ts`
- **Authentication**: DSN (`SENTRY_DSN`)
- **Data flow**: Capture errors → Sentry (optional, privacy-respecting)

## Anthropic Claude (AI Ops)
- **Purpose**: AI-powered operations (Phase 7)
- **Where used**: AI ops layer, smart insights
- **Files**:
 - `api-backend/src/lib/ai/service.ts`
 - `api-backend/src/lib/ai/tools.ts`
- **Authentication**: API key (`ANTHROPIC_API_KEY`)
- **Data flow**: Backend-only, server-side AI calls

## Facebook CAPI (Conversion API)
- **Purpose**: Send conversion events to Facebook
- **Where used**: Outbound postback worker
- **Files**:
 - `api-backend/src/lib/integrations/facebook-capi.ts`
 - `api-backend/src/surfaces/workers/processors/facebook-capi.ts`
- **Data flow**: Conversion recorded → queued → batch sent to Facebook CAPI

## Offer Feed Sync
- **Purpose**: Inbound offer feed — pull an advertiser's JSON offer list and upsert it as offers (matched by `metadata.feedExternalId`)
- **Where used**: Background worker (scheduled) + Settings › Integrations › Feeds "Sync now" (`POST /api/settings/integrations/offer-feed/sync`)
- **Files**:
 - `api-backend/src/lib/integrations/offer-feed-sync.ts`
 - `api-backend/src/surfaces/workers/processors/offer-feed-sync.ts`
- **Data flow**: `offerFeedUrl` (+ optional key sent as `Authorization: Bearer` / `x-api-key`) → GET JSON (`[...]`, `{offers:[...]}` or `{data:[...]}`) → upsert offers for `offerFeedAdvertiserId`. `demo://offer-feed` returns built-in demo offers.
- **Money (O9)**: payout / revenue are parsed exactly — the JSON number's own source text where the runtime provides it (Node 21+), exponent notation included — and rounded half-up to 4 dp (`roundMoney`, `lib/money.ts`); an offer whose amount isn't a usable decimal is skipped and reported (`skipped` in the sync result, `offerFeedLastSyncError`), never imported as 0.
- **Re-sync**: the feed owns name / URL / status / payout / revenue / currency; the offer's other settings (targeting, notes, custom fields…) are kept — the feed keys are merged into `metadata`, not replacing it. A **copied** offer drops `feedExternalId` / `feedSource` (O7), so the feed keeps updating the original only.
- **Security**: the URL is tenant-supplied, so it is fetched through `lib/net/safe-http.ts` `safeRequest` (audit F-06): http(s) only, no redirects, no loopback/private/link-local targets outside `NODE_ENV=development` (checked on the connected address), 30 s total deadline, 16 MB body cap. A refused URL fails the sync with `blocked_destination: …` (saved as `offerFeedLastSyncError`).

## PIN API
- **Purpose**: Pinterest integration
- **Where used**: Pin API integration
- **Files**:
 - `api-backend/src/lib/integrations/pin-api.ts`
- **Data flow**: Backend-to-Pinterest API calls

## Email (Nodemailer)
- **Purpose**: Outbound email (notifications, alerts, invitations)
- **Where used**: Communication hub sends, fraud / automation alerts, and (F-24) transactional emails — portal invites, offer details shared, balance requests, invoices issued — plus scheduled reports (CSV attachment)
- **Files**:
 - `api-backend/src/lib/mailer.ts` (`sendNetworkEmail`, attachments)
 - `api-backend/src/lib/email/transactional.ts` (per-event Communication Hub toggles), `templates.ts`
- **Authentication**: each network's own SMTP settings (Settings › SMTP; password stored encrypted)
- **Data flow**: Backend → SMTP server → recipient

## Supabase Storage (files)
- **Purpose**: Public file hosting for offer thumbnails and offer creatives (F-27)
- **Files**: `api-backend/src/lib/storage/supabase-storage.ts` (`uploadPublicObject`, REST, service-role, backend only), `api-backend/src/lib/creatives/files.ts`
- **Buckets**: `offer-thumbnails` (2 MB files), `offer-creatives` (5 MB bucket limit; uploads capped at 2 MB) — created public on first upload
- **Authentication**: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; unset → uploads fail with a clear 400
- **Data flow**: SPA → raw file → dashboard API → Storage → public URL stored on the row. Control Center branding logos are still stored inline (data: URLs in settings)

## Redis (BullMQ)
- **Purpose**: Queue backend, config cache, atomic operations
- **Where used**: Everywhere
- **Files**:
 - `api-backend/src/lib/redis.ts` — Connection management
 - `api-backend/src/surfaces/workers/queues.ts` — Queue definitions
- **Data flow**: Click jobs, postbacks, fraud scans, retention, Facebook CAPI, offer feed sync

## ngrok
- **Purpose**: Expose localhost for remote testing/debugging
- **Where used**: Both frontend and backend dev
- **Files**:
 - `api-backend/scripts/ngrok-tunnel.ts`
 - Frontend `vite.config.ts` (allowedHosts)
- **Data flow**: Local ports → public tunnel URL

## Webhooks (Outbound)
- **Purpose**: Send data to third-party systems
- **Where used**: Automation webhooks
- **Files**:
 - `api-backend/src/lib/integrations/` (webhook-related)
 - `api-backend/src/surfaces/dashboard/automation/routes.ts`
- **Data flow**: Event trigger → POST to configured URL

## NOT Integrated (Not Yet)
- No email service provider (SendGrid, Mailgun) — uses raw SMTP
- No analytics CDN
- No payment processor
