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
- **Purpose**: Outbound offer feed to external systems
- **Where used**: Background worker (scheduled)
- **Files**:
 - `api-backend/src/lib/integrations/offer-feed-sync.ts`
 - `api-backend/src/surfaces/workers/processors/offer-feed-sync.ts`
- **Data flow**: Scheduled scan → generate XML/CSV feed → POST to endpoint

## PIN API
- **Purpose**: Pinterest integration
- **Where used**: Pin API integration
- **Files**:
 - `api-backend/src/lib/integrations/pin-api.ts`
- **Data flow**: Backend-to-Pinterest API calls

## Email (Nodemailer)
- **Purpose**: Outbound email (notifications, alerts, invitations)
- **Where used**: Communication hub, notifications
- **Files**:
 - `api-backend/src/lib/mailer.ts`
- **Authentication**: SMTP credentials (configured via env)
- **Data flow**: Backend → SMTP server → recipient

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
- No cloud storage
