# API Reference

## Dashboard API (port 4001, prefix `/api`)

### Auth Routes (unauthenticated)
| Method | Endpoint | Purpose | Auth | Body |
|---|---|---|---|---|
| POST | `/api/auth/login` | Login with email+password | None | `{ email, password }` |
| POST | `/api/auth/refresh` | Refresh access token via cookie | None (uses cookie) | — |
| POST | `/api/auth/logout` | Clear refresh cookie | None | — |

### Identity
| Method | Endpoint | Purpose | Auth | Returns |
|---|---|---|---|---|
| GET | `/api/me` | Current identity + scope | Dashboard JWT | `{ identity, scope }` |
| GET | `/api/me/account` | Own user row + metadata | Dashboard JWT | User object |
| PATCH | `/api/me/theme` | Set accent theme | Dashboard JWT | `{ theme: 'A'-'F' }` |
| PATCH | `/api/me/profile` | Update profile fields | Dashboard JWT | `{ ok, ...fields }` |
| PATCH | `/api/me/password` | Change own password | Dashboard JWT | `{ ok }` |
| PATCH | `/api/me/email` | Change own email | Dashboard JWT | `{ ok, email }` |
| GET | `/api/me/logins` | Own login history | Dashboard JWT | Login events array |
| POST | `/api/me/anonymize` | GDPR anonymize | Dashboard JWT | `{ ok }` |
| GET | `/api/me/notifications` | Get notification prefs | Dashboard JWT | `{ preferences }` |
| PUT | `/api/me/notifications` | Set notification prefs | Dashboard JWT | `{ preferences }` |

### Admin Routes (require `requireAdmin` + RBAC)
| Method | Endpoint | Feature | Auth |
|---|---|---|---|
| GET,POST,PATCH,DELETE | `/api/advertisers/*` | Advertiser CRUD | admin |
| GET,POST,PATCH,DELETE | `/api/publishers/*` | Publisher CRUD | admin |
| GET,POST,PATCH,DELETE | `/api/offers/*` | Offer CRUD | admin |
| GET,POST,PATCH,DELETE | `/api/tracking-domains/*` | Tracking domain CRUD | admin |
| GET,POST,PATCH,DELETE | `/api/finance/*` | Finance | admin |
| GET | `/api/reports/*` | Reports (12+ types) | admin |
| GET,POST,PATCH,DELETE | `/api/alerts/*` | Alert management | admin |
| GET,POST,PATCH,DELETE | `/api/fraud-rules/*` | Fraud rules | admin |
| GET,POST,PATCH,DELETE | `/api/ai/*` | AI ops | admin |
| GET,POST,PATCH,DELETE | `/api/tags/*` | Tag management | admin |
| GET,POST,PATCH,DELETE | `/api/custom-fields/*` | Custom fields | admin |
| GET,POST,PATCH,DELETE | `/api/settings/*` | Settings | admin |
| GET,POST,PATCH,DELETE | `/api/smart-links/*` | Smart links | admin |
| GET,POST,PATCH,DELETE | `/api/offline/*` | Offline conversions | admin |
| GET,POST,PATCH,DELETE | `/api/import-export/*` | Import/Export | admin |
| GET,POST,PATCH,DELETE | `/api/catalog/*` | Catalog | admin |
| GET,POST,PATCH,DELETE | `/api/invoices/*` | Invoices | admin |
| GET,POST,PATCH,DELETE | `/api/offer-templates/*` | Offer templates | admin |
| GET,POST,PATCH,DELETE | `/api/offer-groups/*` | Offer groups | admin |
| GET,POST,PATCH,DELETE | `/api/creatives/*` | Creatives | admin |
| GET,POST,PATCH,DELETE | `/api/custom-metrics/*` | Custom metrics | admin |
| GET,POST,PATCH,DELETE | `/api/marketplace-profile/*` | Marketplace profile | admin |
| GET,POST,PATCH,DELETE | `/api/communication-hub/*` | Communication hub | admin |
| GET,POST,PATCH,DELETE | `/api/customer-value/*` | Customer value rules | admin |
| GET,POST,PATCH,DELETE | `/api/traffic-health/*` | Traffic health | admin |
| GET,POST,PATCH,DELETE | `/api/investigator/*` | Investigator | admin |
| GET,POST,PATCH,DELETE | `/api/automation/*` | Automation | admin |
| GET | `/api/audit-log/*` | Audit log | admin |
| GET,POST,PATCH,DELETE | `/api/conversion-imports/*` | Conversion imports | admin |
| GET,POST,PATCH,DELETE | `/api/traffic-controls/*` | Traffic controls | admin |
| GET,POST,PATCH,DELETE | `/api/offer-custom-settings/*` | Offer custom settings | admin |
| GET,POST,PATCH,DELETE | `/api/smartswitch/*` | SmartSwitch | admin |
| GET,POST,PATCH,DELETE | `/api/users/*` | Users | admin |
| GET,POST,PATCH,DELETE | `/api/postbacks/*` | Postbacks | admin |
| GET,POST,PATCH,DELETE | `/api/partner-tiers/*` | Partner tiers | admin |
| GET,POST,PATCH,DELETE | `/api/business-units/*` | Business units | admin |
| GET,POST,PATCH,DELETE | `/api/offer-applications/*` | Offer applications | admin |
| GET,POST,PATCH,DELETE | `/api/questionnaires/*` | Questionnaires | admin |
| GET,POST,PATCH,DELETE | `/api/traffic-blocking/*` | Traffic blocking | admin |
| GET,POST,PATCH,DELETE | `/api/traffic-sources/*` | Traffic sources | admin |
| GET,POST,PATCH,DELETE | `/api/reporting-adjustments/*` | Reporting adjustments | admin |
| GET,POST,PATCH,DELETE | `/api/coupon-codes/*` | Coupon codes | admin |
| GET,POST,PATCH,DELETE | `/api/partner-invoices/*` | Partner invoices | admin |
| GET,POST,PATCH,DELETE | `/api/link-templates/*` | Link templates | admin |
| GET,POST,PATCH,DELETE | `/api/postback-controls/*` | Postback controls | admin |
| GET,POST,PATCH,DELETE | `/api/advertiser-invoices/*` | Advertiser invoices | admin |
| GET,POST,PATCH,DELETE | `/api/tiered-commissions/*` | Tiered commissions | admin |
| GET,POST,PATCH,DELETE | `/api/control-center/*` | Control center (incl. the Category / Channel catalogs: `/api/control-center/categories`, `/api/control-center/channels`) | admin |

### Path ids (Offers, Partners, Advertisers and their sub-resources)

Path ids are UUIDs. A malformed one (`/api/publishers/123`) is the standard **422** `validation_failed` envelope on every route (`rejectMalformedIdParams` in `api-backend/src/lib/http/path-params.ts`, registered per router). A well-formed id that doesn't exist **or belongs to another network** is the same plain **404** — the response never reveals whether a record exists elsewhere. Related ids in a body (advertiser, managers, channel, referrer, tracking domain) must belong to the caller's network → otherwise **400**.

Optional on Advertisers: `contactEmail`, `billingTerms`; on Partners: `contactEmail`, `payoutTerms` (nullable columns; the create/edit forms send them only when filled, and still format-check the email).

### Filter query parameters (all list/report endpoints)

Every filter param is zod-validated (`validateQuery`); bad input is a **422 validation error**, never a Postgres 500, and values are always bound as `$n`. Shared parsers live in `api-backend/src/lib/http/query-params.ts` (`csvList`, `queryBool`, `queryDate`); free-text search uses `escapeLike` (`lib/db/like.ts`) with `ILIKE … ESCAPE '\'`.

`GET /api/reports` (and the portal `/stats` + public-API reports, via `lib/reporting/request.ts`):
- Include filters `offerId|publisherId|advertiserId|smartLinkId` = one UUID or a comma list; text dims (`country`, `device`, `city`, `region`, `isp`, `browser`, `os`, `sub1-5`) = comma list, or repeated/`key[]=` params taken literally (for values containing commas). Lists are OR within a dimension, AND across dimensions.
- Exclusions `exclude{OfferId,PublisherId,AdvertiserId,SmartLinkId,Country,Device}` accept lists too and **keep NULL rows** (excluding a smart link doesn't drop traffic without one).
- `excludeInvalid=true|false|1|0`, `from`/`to` = ISO date/datetime (real calendar day, `from <= to`).
- `groupBy=none` → one grand-total row (summary tiles). `orderBy=cr|epc` sorts by the real ratio.
- Filters on a dimension the audience can't see are dropped (advertiser keys/portal can't filter by publisher, smart link or subs; publishers can't filter by advertiser). Forced owner filters always win.

Server-paged entity lists — `GET /api/offers|publishers|advertisers?paged=1` (without `paged=1` the endpoints keep returning the plain array other pickers use):
- Response `data: { rows, total, page, pageSize, counts }` (`counts.statuses`, and `counts.tabs` for partners/advertisers). Params `page` (≥1), `pageSize` (≤200), `sort` (per-endpoint whitelist), `dir` (`asc|desc`; ties broken by id).
- Offers: `search` + `searchField` (`name|advertiser|id`), `name`, `offerIds`, `status`, `advertiserId`, `category` (case-insensitive name), `tagId`, `offerGroupId`, `accountManagerId`, `salesManagerId`, `trackingDomainId`, `visibility`, `payoutType`, `revenueType`, `objective`, `deviceType`, `country`, `platform`. Partners: `tab`, `status`, `search`, `accountExecutiveId`, `partnerManagerId`, `channelId`, `label`, `billingFrequency`, `country`, `region`, `tier`, `paymentMethod`, `paymentTerms`, `payable`, `hasRunTraffic`, `noTraffic`. Advertisers: `tab`, `status`, `search`, `accountManagerId`, `salesManagerId`, `billingFrequency`, `label`. Free-text values are sent as repeated params (taken literally); ids/enums accept comma lists.
- Option lists: `GET /api/offers/filter-options`, `GET /api/publishers/filter-options` (distinct values in use).

Other paged/limited lists: `/api/audit-log` (server filters `service|portal|method|q|from|to`, `limit`/`offset`, `pagination.total`; `GET /api/audit-log/services`), `/api/alerts` (`pagination.total`), `/api/reports/goals` and `/api/reports/click-to-conversion-time` return `{ rows, total, truncated }` with `limit`/`offset`. Whole-entity management lists are bounded by `LIST_CAP` (10,000, `lib/http/list-cap.ts`) and log a warning if it is ever reached.

Detail reports (`/api/reports/clicks|conversions|postback-logs|goals|grouped|…`) each have a **strict** schema (an unknown key is a 422 listing it under `details._errors`) and take single values per filter (the UI drawers are single-select there); `/clicks` supports `advertiserId`, `/conversions` supports `excludeSource`, `/grouped` accepts both `offerId` and `offerIds` style lists plus `country`/`device`/`smartLinkId`.

### API Key Management
| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| GET,POST | `/api/keys` | List/create network API keys | admin |
| PATCH,DELETE | `/api/keys/:id` | Update/revoke API keys | admin |
| GET,POST | `/api/portal/publisher/keys` | Publisher API keys | portal:publisher |
| GET,POST | `/api/portal/advertiser/keys` | Advertiser API keys | portal:advertiser |
| GET,POST | `/api/advertisers/:id/keys` | List/create a given advertiser's API keys (audience `advertiser`, owner = that advertiser; same keys the portal shows) | admin |
| DELETE | `/api/advertisers/:id/keys/:keyId` | Revoke one of that advertiser's keys | admin |
| GET | `/api/advertisers/:id/events` | Advertiser's events = goals (`offer_goals`) on its offers, with `offerId`/`offerName`/`offerRef` ("Associated to") | admin (any role) |
| POST | `/api/advertisers/:id/events` | Create an event: goal body + `offerId` (must be one of this advertiser's offers); currency defaults to the offer's | admin/manager |
| PATCH,DELETE | `/api/advertisers/:id/events/:eventId` | Edit/delete an event of this advertiser (the offer can't be changed). Same rules, audit and cache invalidation as `/api/offers/:id/goals` | admin/manager |

### Portal Routes (owner-scoped)
| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| GET | `/api/portal/publisher/*` | Publisher self-reads | portal:publisher |
| GET | `/api/portal/advertiser/*` | Advertiser self-reads | portal:advertiser |
| GET | `/api/portal/offers/*` | Offer portal views | portal |

### Subscription
| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| GET,PATCH | `/api/subscription/*` | Subscription management | Authenticated |

## Platform Admin API (port 4004, prefix `/platform`)

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| GET | `/platform/me` | Identity | Platform admin JWT |
| GET,POST,PATCH,DELETE | `/platform/networks/*` | Network management | Platform admin |
| GET,POST,PATCH,DELETE | `/platform/subscriptions/*` | Subscription management | Platform admin |
| GET | `/platform/usage/*` | Usage tracking | Platform admin |

## Public REST API (port 4003, prefix `/api/v1`)

Three isolated namespaces, API-key authenticated:
- `/api/v1/advertiser/*` — advertiser audience only
- `/api/v1/publisher/*` — publisher audience only
- `/api/v1/network/*` — network/admin audience only
- `/api/v1/openapi.json` — OpenAPI spec (public)

### Publisher Scopes
`offers:read`, `clicks:read`, `conversions:read`, `earnings:read`, `stats:read`, `postbacks:manage`, `links:generate`

### Advertiser Scopes
`offers:read`, `conversions:read`, `conversions:write`, `stats:read`, `settings:manage`

### Network Scopes
`offers:read`, `offers:write`, `publishers:read`, `advertisers:read`, `reports:read`, `payouts:write`

## Tracking Surface (port 4002)

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| GET | `/tracking/health` | Health check | None |
| GET | `/tracking/metrics` | Prometheus metrics | None |
| GET | `/click` | Click redirect (302) | None (tenant by host) |
| GET | `/sl` | Smart link resolver → redirect | None (tenant by host) |
| GET/POST | `/postback` | S2S postback (conversion) | None (tenant by host) |
| GET | `/pixel` | Pixel conversion (1x1 GIF) | None (tenant by host) |
| GET | `/iframe` | Iframe conversion | None (tenant by host) |

### Click Parameters
- `offer_id` (required) — Offer UUID **or** its short numeric ref (e.g. `offer_id=190`); refs resolve via a Redis-cached ref→UUID lookup
- `pub_id` / `aff_id` / `p` — Publisher UUID or short numeric ref (e.g. `pub_id=6`)
- `format=json` — only when the offer has "Server-Side Click" on: returns `{ ok, data: { click_id, redirect_url } }` instead of a 302
- `sub1`–`sub5` — Sub-IDs
- `source_id` / `source` / `src` — Traffic source
- `geo` / `test_geo` — Force country (dev/testing)
- `sl` — Smart link ID (when routed via smart link)

### Postback Parameters
- `click_id` (required) — The click to attribute to
- `txn_id` / `transaction_id` / `tid` — External transaction ID. Idempotency key: a repeat for the same offer is `duplicate` (Redis guard + DB unique `(offer_id, transaction_id)`), never a second conversion or ledger entry
- `event` / `event_name` / `goal` — Event name (selects the goal with that event name)
- `payout` / `amount` — Payout override
- `revenue` — Revenue override
- `sale_amount` / `order_amount` — Sale value for Percentage / Mixed revenue offers (`amount` is NOT read as a sale amount)
- `secure_code` / `security_code` — Required when the offer or network has a code (offer code wins)
- `status` — `approved` (also confirmed/sale/success/1), `rejected` (declined/reversed/cancelled), anything else or omitted → `pending` (no ledger, no partner postback until approved)

The advertiser postback URL shown in the dashboard is `…/postback?click_id={click_id}&txn_id={txn_id}&status=approved&secure_code=<real code>`.

### Conversion pricing precedence
explicit `payout`/`revenue` param → goal matched by event name → partner payout override / country (geo) override frozen on the click → default goal → offer default. Offer and goal conversion caps (daily = UTC day, total) reject conversions past the cap (`reason=*_conversion_cap_reached`).

### Click access rules
A partner explicitly denied is diverted. Private and Request-access (`ask`) offers only accept clicks from partners with an `allow` + `approved` access row; others are diverted. A partner's payout override is frozen onto their clicks.

### Finance (dashboard)
- `POST /api/finance/conversions/:conversionId/approve` — pending → approved: tiered commission, earning + billing ledger entries, partner postback (honours "Fire Partner Postback"). Admin/finance.
- `POST /api/finance/conversions/:conversionId/reject` — status + offsetting ledger entries in one transaction (net per account → 0). Admin/finance.

### Offer access (dashboard)
- `POST /api/offers` accepts an optional `Idempotency-Key` header (1–200 visible ASCII chars, kept 10 min per network in Redis). A repeat with the same key returns the original offer (`201`, `Idempotent-Replayed: true`) instead of creating another; a concurrent repeat gets `409`; the same key with a different body gets `422`; a failed create frees the key for retry. Without the header, behaviour is unchanged.
- `POST /api/offers/:id/publishers` — grant access (upsert on the partner's existing row)
- `PATCH /api/offers/:id/publishers/:accessId` — change access / approval / payout override
- `GET /api/offers/:id/postbacks?level=conversion|event|cpc` — filtered offer postbacks

## Health & Metrics
Every surface exposes:
- `GET /health` — JSON health report
- `GET /metrics` — Prometheus text exposition

## Workers (port 4005)
- `GET /health` — Health check
- `GET /metrics` — Prometheus metrics (includes queue depth)
