# API Reference

## Dashboard API (port 4001, prefix `/api`)

### Auth Routes (unauthenticated)
| Method | Endpoint | Purpose | Auth | Body |
|---|---|---|---|---|
| POST | `/api/auth/login` | Login with email+password | None | `{ email, password }` |
| POST | `/api/auth/refresh` | Refresh access token via cookie | None (uses cookie) | — |
| POST | `/api/auth/logout` | Clear refresh cookie | None | — |
| POST | `/api/signup/partner` | Partner self-serve sign-up (see Portal logins below) | None (per-IP limit in production) | `{ network: <slug>, name, email, contactName?, website?, trafficSource?, country? }` |

### Identity
| Method | Endpoint | Purpose | Auth | Returns |
|---|---|---|---|---|
| GET | `/api/me` | Current identity + scope; `impersonating` + `impersonation: { impersonatedBy, adminEmail, account, expiresAt }` while an admin impersonates this portal account (banner data) | Dashboard JWT | `{ identity, scope, impersonating, impersonation }` |
| GET | `/api/me/account` | Own user row + metadata | Dashboard JWT | User object |
| PATCH | `/api/me/theme` | Set accent theme | Dashboard JWT | `{ theme: 'A'-'F' }` |
| PATCH | `/api/me/profile` | Update profile fields | Dashboard JWT | `{ ok, ...fields }` |
| PATCH | `/api/me/password` | Change own password (403 while impersonating) | Dashboard JWT | `{ ok }` |
| PATCH | `/api/me/email` | Change own email (403 while impersonating) | Dashboard JWT | `{ ok, email }` |
| GET | `/api/me/logins` | Own login history | Dashboard JWT | Login events array |
| POST | `/api/me/anonymize` | GDPR anonymize (403 while impersonating) | Dashboard JWT | `{ ok }` |
| GET | `/api/me/notifications` | Get notification prefs | Dashboard JWT | `{ preferences }` |
| PUT | `/api/me/notifications` | Set notification prefs | Dashboard JWT | `{ preferences }` |

### Admin Routes (require `requireAdmin` + RBAC)
| Method | Endpoint | Feature | Auth |
|---|---|---|---|
| GET,POST,PATCH,DELETE | `/api/advertisers/*` | Advertiser CRUD | admin |
| GET,POST,PATCH,DELETE | `/api/publishers/*` | Publisher CRUD | admin |
| GET,POST,PATCH,DELETE | `/api/offers/*` | Offer CRUD. `DELETE /api/offers/:id` (admin) **archives** an offer that has history (clicks, conversions, ledger, reporting adjustments) → `{ deleted: false, archived: true, offer }` (stops at /click, keeps records + name); an unused draft is removed → `{ deleted: true }`; `?hard=true` removes any unused offer, 409 when it has history | admin |
| GET,POST,PATCH,DELETE | `/api/tracking-domains/*` | Tracking domain CRUD. Custom hosts start `pending` with `dnsRecord: { type: 'TXT', name: '_tracker-verify.<host>', value: <token> }`; `POST /:id/verify` (admin/manager) checks DNS now → `{ verified, reason, domain }` (miss → `failed`); a background job re-checks `pending` hosts every 10 min; `PATCH /:id { status: active\|disabled }` (active only when verified). Tracking surface: `GET /_tls/ask?domain=` → 200 only for active + verified hosts (edge on-demand TLS hook) | admin |
| GET,POST,PATCH,DELETE | `/api/finance/*` | Finance | admin |
| GET | `/api/reports/*` | Reports (12+ types) | admin |
| GET,POST,PATCH,DELETE | `/api/alerts/*` | Alert management (PATCH: admin/manager) | admin |
| GET,PUT | `/api/fraud-rules` | Fraud rules (PUT: admin/manager, partial patch). Thresholds plus (F-23) `blockScore` (1–100, `null` = flag only — at or over it `/click` diverts the click instead of recording it; server-side `format=json` clicks are never blocked), `weights` {datacenter, velocity, botUserAgent, ipqsProxy, ipqsVpn, ipqsTor, ipqsBot} (0–100, partial merge), `alertEmails` (≤20) and `alertWebhookUrl` (http(s), no private address literal → 422; stored encrypted; GET/PUT/audit only ever show the origin, e.g. `https://hooks.example.com/…`, plus `alertWebhookUrlSet` — sending the masked value back keeps the stored URL; `null` clears it). Newly raised fraud-scan alerts are emailed (network SMTP) and POSTed as `{ event: 'alert.raised', alert }` through the SSRF guard; the outcome is recorded on the alert as `metadata.delivery` | admin |
| GET,POST,PATCH,DELETE | `/api/ai/*` | AI ops (`POST /chat` spends the Anthropic budget: admin/manager) | admin |
| GET,POST,PATCH,DELETE | `/api/tags/*` | Tag management | admin |
| GET,POST,PATCH,DELETE | `/api/custom-fields/*` | Custom fields | admin |
| GET,POST,PATCH,DELETE | `/api/settings/*` | Settings. Secrets never come back: `GET /api/settings` returns `smtp.passwordSet` and `integrations.<key>Set` for every credential (keys ending in key/token/secret/password). `PUT /integrations`: a non-empty credential replaces the stored one (encrypted), `''` keeps it, `null` removes it (`pinApiKey: ''` still revokes the Pin API key). `GET /security` (postback secure code): admin/manager | admin |
| GET,POST,PATCH,DELETE | `/api/smart-links/*` | Smart links | admin |
| GET,POST,PATCH,DELETE | `/api/offline/*` | Offline conversions (POST `/conversions` = Add Conversion: admin/manager, manual-conversion policy below) | admin |
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
| GET,POST,PATCH,DELETE | `/api/investigator/*` | Investigator (create/refresh/delete: admin/manager) | admin |
| GET,POST,PATCH,DELETE | `/api/automation/*` | Automation (writes: admin/manager), executed by workers (F-17a). **Scheduled actions** (`/scheduled-actions`, and per offer `/api/offers/:id/scheduled-actions`): a `pending` action runs at `scheduledTime` (checked every minute) — `activate`/`pause`/`archive` the offer, or `cap_change` with `capType` (`daily_click`\|`daily_conversion`\|`total_conversion`) + `capValue` (n, or `null` = no cap); with `partnerIds`, `activate` approves and `pause` blocks those partners on the offer (archive/cap_change are offer-wide). Saving a pending action that couldn't run → 422 (missing cap, partners on archive/cap_change, another network's partner). DTOs add `capType`, `capValue`, `executedAt`, `result`; status `failed` (+ `result.error`) when it couldn't be applied; `?status=failed`. **Alert rules** (`/alert-rules`): `conditions` must parse — `<metric> <op> <number>` joined by AND (metrics clicks, unique_clicks, conversions, invalid_clicks, cr %, invalid_rate %, payout, revenue, margin, epc), optional `per offer\|partner\|advertiser` and `in <n>m\|h\|d` (default 24h) — else 422; evaluated every 5 min, alerting when the conditions start to hold (In App → Alerts inbox as `automation_rule`; Email → active admins + managers); DTOs add `lastEvaluatedAt`, `lastFiredAt`, `lastError`. **Webhooks** (`/webhooks`): `events` = `conversion.created`, `conversion.approved`, `conversion.rejected`, `alert.raised`, `scheduled_action.executed` or `*` (unknown/empty → 422; stored normalised), URL through the SSRF guard (private literal → 422); deliveries are queued with retries + backoff (POST/PUT/PATCH send `{ event, occurredAt, data }`, GET/DELETE put `event` + `delivery_id` in the query, headers `x-tracker-event`/`x-tracker-delivery`); `GET /webhooks/:id/deliveries` = last 100 (status pending\|success\|failed\|blocked, attempts, statusCode, error) | admin |
| GET | `/api/audit-log/*` | Audit log | admin |
| GET,POST,PATCH,DELETE | `/api/conversion-imports/*` | Conversion imports | admin |
| GET,POST,PATCH,DELETE | `/api/traffic-controls/*` | Traffic controls | admin |
| GET,POST,PATCH,DELETE | `/api/offer-custom-settings/*` | Offer custom settings — per-partner overrides, ENFORCED at runtime (`lib/offer-settings/custom-settings.ts`). Body = v2 typed fields in camelCase (`category`, **`offerId` required**, `partnerId`/`partnerIds`/`applyAllPartners`, `status` active\|inactive, `effectiveFrom/To`, `targeting{countries,devices,os,browsers}`, `payoutModel/payoutValue`, `revenueModel/revenueValue`, `goalId`, `firePartnerPostback`, `caps{clicks\|conversions\|payout\|revenue:{daily\|weekly\|monthly\|global}}` or flat `capType+capInterval+capValue`, `throttleRate`, `conversionStatus`, `landingPageUrl`, creative fields). Per-category checks → 400; bad enum/missing offerId → 422. Writes bust the offer's cached config | admin |
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
- `metrics=…,currencies` (opt-in, every audience; never in the default set when `metrics` is omitted, never an `orderBy`) → per row the sorted DISTINCT non-null `currency` of the **approved** conversions that feed payout/revenue/margin (`[]` when none). Money is still summed as stored; more than one entry means the row mixes currencies. Implemented in the Postgres and ClickHouse providers.
- `metrics=…,money_by_currency` (opt-in, same rules as `currencies`; never orderable) → per row (and the `groupBy=none` row) an object keyed by currency code → `{ payout, revenue, margin }` (numeric(14,4) strings) built from exactly the approved conversions behind payout/revenue/margin, NULL currency excluded, `{}` when none. Only the money fields the audience may see are present: admin/network all three, publisher (portal + public API) `payout` only, advertiser `revenue` only — decided by `buildReportRequest` (`moneyFields`), never by the requested metric list. Postgres: per-(group, currency) sub-aggregate + `jsonb_object_agg`; ClickHouse: `sumMapIf` (with a row count so a zero-sum currency keeps its key).
- Money sorts never compare currencies: when `orderBy` is `payout`, `revenue`, `margin` or `epc` (the only money/money-derived orderable metrics), rows are ordered (1) single-currency rows grouped by currency code ascending, by the value in `orderDir` within each currency; (2) rows with no approved conversion; (3) mixed-currency rows — and rows with any approved conversion without a currency — last, in group-key order. Ties break on the group key; the ordering runs in SQL before `LIMIT/OFFSET`. The response then carries `sortedWithinCurrency: true` next to `rows`/`total` (absent for every other sort). Same in both providers, so the portal `/stats` and public-API reports get it too.
- Filters on a dimension the audience can't see are dropped (advertiser keys/portal can't filter by publisher, smart link or subs; publishers can't filter by advertiser). Forced owner filters always win.

Server-paged entity lists — `GET /api/offers|publishers|advertisers?paged=1` (without `paged=1` the endpoints keep returning the plain array other pickers use):
- Response `data: { rows, total, page, pageSize, counts }` (`counts.statuses`, and `counts.tabs` for partners/advertisers). Params `page` (≥1), `pageSize` (≤200), `sort` (per-endpoint whitelist), `dir` (`asc|desc`; ties broken by id).
- Offers: `search` + `searchField` (`name|advertiser|id`), `name`, `offerIds`, `status`, `advertiserId`, `category` (case-insensitive name), `tagId`, `offerGroupId`, `accountManagerId`, `salesManagerId`, `trackingDomainId`, `visibility`, `payoutType`, `revenueType`, `objective`, `deviceType`, `country`, `platform`. Partners: `tab`, `status`, `search`, `accountExecutiveId`, `partnerManagerId`, `channelId`, `label`, `billingFrequency`, `country`, `region`, `tier`, `paymentMethod`, `paymentTerms`, `payable`, `hasRunTraffic`, `noTraffic`. Advertisers: `tab`, `status`, `search`, `accountManagerId`, `salesManagerId`, `billingFrequency`, `label`. Free-text values are sent as repeated params (taken literally); ids/enums accept comma lists.
- Option lists: `GET /api/offers/filter-options`, `GET /api/publishers/filter-options` (distinct values in use).

Other paged/limited lists: `/api/audit-log` (server filters `service|portal|method|q|from|to`, `limit`/`offset`, `pagination.total`; `GET /api/audit-log/services`), `/api/alerts` (`pagination.total`), `/api/reports/goals` and `/api/reports/click-to-conversion-time` return `{ rows, total, truncated }` with `limit`/`offset`. Whole-entity management lists are bounded by `LIST_CAP` (10,000, `lib/http/list-cap.ts`) and log a warning if it is ever reached.

Detail reports (`/api/reports/clicks|conversions|postback-logs|goals|grouped|…`) each have a **strict** schema (an unknown key is a 422 listing it under `details._errors`) and take single values per filter (the UI drawers are single-select there); `/clicks` supports `advertiserId`, `/conversions` supports `excludeSource`, `/grouped` accepts both `offerId` and `offerIds` style lists plus `country`/`device`/`smartLinkId`.

Click report filters (`/clicks` and `/grouped`, so both Click report modes filter alike): `clickIds` — comma list of click IDs exactly as `/click` issues them (32 lower-case hex), trimmed, de-duplicated, empty entries dropped, at most 100, else 422; `ip` — one IPv4/IPv6 address matched exactly against the stored `inet` (a prefix such as `/32` or a malformed address → 422); `isUnique` (`true` = unique clicks, `false` = duplicate clicks — the Click report's "Visibility"; already on `/clicks`, now also on `/grouped`); `sourceId` / `fbclid` / `gclid` — exact match (trimmed, 1–500 chars, else 422) on the values captured from the click URL (`?source_id|source|src`, `?fbclid`, `?gclid`; NULL on clicks recorded before migration 066). Blank / whitespace-only click-URL values are "not present": stored as NULL, a blank `source_id` falls through to `source` / `src`, `/sl` forwards the non-blank values to `/click`, and `/clicks` returns a stored `''` as `null` (rows are not rewritten); a blank or whitespace-only filter value is a 422. On `/grouped` the conversions side matches `clickIds` on the conversion's own `click_id` and `ip`/`isUnique`/`sourceId`/`fbclid`/`gclid` through the joined click. `/clicks` rows return `ip` as the plain address (`host(ip)`, no `/32` mask — paste-able into the `ip` filter) and also the stored `referrer` (through `redactUrl`, like postback URLs — the stored value is unchanged), `user_agent`, `currency`, `source_id`, `fbclid`, `gclid` and the click-time `resolved_payout`/`resolved_revenue` (numeric text). Click Report Fields support: stored on `clicks` — Click ID, Smart Link ID, Source, FB Click ID, Google Click ID, IP, Country, Region, City, ISP, Device, Browser, OS, User Agent, Referer, Is Unique, Currency, Payout/Revenue (click-time rates), Created Date, plus Converted, Fraud Score, Sub1–Sub5; resolved from the network's own lists — Offer ID (ref) / Title, Partner ID (ref) / Name (contact person) / Company (partner name), Advertiser ID (ref) / Name; **not tracked anywhere** (listed, disabled, never requested or exported) — Advertiser Company (advertisers have one name), Landing Page ID/Title, Note, Referrer Offer ID, GAID, IDFA, App ID/Name, Creative Name, Is Rejected (diverted clicks aren't stored), Connection Type, Proxy, Proxy Country, Latitude, Longitude, ERID, Final URL, Click URL (each disabled field's tooltip names the missing dependency; see FRONTEND.md).

Click report ordering: `/clicks` is `created_at DESC, click_id DESC` — the click_id tie-break keeps offset paging (table and paged export) from repeating or skipping clicks that share a timestamp. `/grouped` rows are deterministic: `groupBy=day` chronologically (UTC days), every other grouping by clicks desc, then label, then key. A group with no offer currency (partner / advertiser / day / country / device) carries the network's `default_currency`, not an assumed USD. Grouped conversions and money are approved conversions only; `totals` sums every group.

Conversion report: `/api/reports/conversions` is `created_at DESC, conversion_id DESC` (stable offset paging for the table and the paged export; also used by the Advertiser Postback report). Approve / reject (`POST /api/finance/conversions/:id/approve|reject`) are `admin` / `finance` only — other admin roles can read the report but get 403 on those.

`/api/reports` sort-only key: `orderBy=valid_clicks` orders by clicks − invalid (fraud-flagged) clicks — the net "Clicks" the admin reports display (`deriveRow`) — in both reporting providers; it is not a returned metric and is accepted only for audiences that see `clicks` and `invalid_clicks` (admin / network; dropped for publisher / advertiser like any unknown key). Ties still break on the group key.

Reporting data rules: `/api/reports/conversions` returns `raw_params` with every sensitive value (`secure_code`/`security_code`, `secret`, `token`, `access_token`, `api_key`, `password`, `signature`, … — one list, `isSensitiveParamKey` in `lib/reporting/redact.ts`) replaced by `[redacted]`; the key is kept and the stored row is unchanged. Pacing counts conversion-cap usage over non-rejected conversions (matching enforcement in `record.ts`), and payout/revenue `cap`/`actual` are money strings with the offer group's `currency` (network default when unset) on each detail row. A cap that is zero, negative or (offer-group JSON) not a plain decimal is "no cap" in `/pacing` and `/caps`, exactly like a missing one (`/caps` returns it as `null`); malformed caps never cause a 500. `/api/reports/goals` rows carry the offer's `currency` and are one row per (offer, `goal_id`) labelled with the goal name (two same-name goals stay separate); approved conversions without a goal (imports/offline, unmatched events) are one row per (offer, `event_name`) with `goal_id: null`, `unmatched: true` (label `(no event)` when the event is null) and are never merged into a goal row. Click counts/CVR are unchanged (offer clicks per row).

Click report: `/api/reports/clicks` and `/api/reports/grouped` take optional `conversionStatus=any|approved|pending|rejected|none` (absent = no filtering) — a click-level predicate (EXISTS / NOT EXISTS over the click's same-network conversions; `any` = ≥1 conversion of any status, a status = ≥1 conversion with it, `none` = no conversion). On `/clicks` it filters the rows (the `converted` column stays "any status"). On `/grouped` clicks are the passing clicks and the (approved) conversions/money are only those whose originating click exists and passes — offline/import conversions with no click row drop out, and `none` always shows 0 conversions. `/api/reports/click-to-conversion-time` takes optional `status=approved|pending|rejected|all` (absent = approved); there is no source filter (manual/offline conversions with a resolvable click are measured).

Mixed currencies: money is summed from conversions whose `currency` can differ, so money-summing reports also return the currencies behind it — `currencies: string[]` (sorted, distinct, non-null, approved conversions) on `/grouped` rows and `totals`, `/goals` rows, Pacing payout/revenue detail rows (the group/day's conversions), `/cohort` rows (cells shown) plus a top-level `currencies`, `/summary`, and `/dashboard` as `currencies.{today,yesterday,month,lastMonth}`. The Pacing summary payout/revenue entries become `dailyUsedPct: null, mixedCurrency: true` when the pooled groups' cap currencies plus their today's conversions' currencies are more than one currency (otherwise unchanged, no flag). Alongside, the same money split per currency (`moneyByCurrency`, shape `{ [currency]: { payout, revenue, margin } }`, numeric(14,4) strings, NULL currency excluded, `{}` when none): `/dashboard` per period (`moneyByCurrency.{today,yesterday,month,lastMonth}`), `/summary` (and the portal `/summary` endpoints — audience fields only), `/grouped` rows and `totals` (exact per-currency sums of the rows), `/goals` rows (the row's own conversions), Pacing payout/revenue detail rows (`{ [currency]: { payout } }` or `{ revenue }`), and `/cohort` rows + top level when `metric=payout|revenue` (the shown cells; `{}` for `metric=conversions`). Server-side sorts on these endpoints are by clicks/conversions/date, never money. `/smart-links` sums no money. `/api/reports/postback-logs` returns `url` (and the free-text `error`) through `redactUrl` (`lib/reporting/redact.ts`): userinfo becomes `[redacted]@` and the value of every query/fragment param whose key `isSensitiveParamKey` matches becomes `[redacted]` (key, order and other params kept as written; unparseable values fall back to `key=value` masking); the stored log is unchanged. `/api/custom-metrics` validates the formula grammar on POST and PATCH, and an empty PATCH is a 422. `/api/conversion-imports` returns the job `status` (`completed`, or `failed` when no row succeeded) on POST and in the list; per-row errors cover blank rows, negative money, an invalid `currency` (must be 3 letters; stored upper-case; blank = the offer's currency, then the network default) and a transaction ID that matches conversions on several offers (add an optional `offerRef`/`offerId` column to disambiguate).

`/api/offer-groups` caps must be finite non-negative JSON numbers (a string, negative or `1e999` is a 422). `/api/customer-value/data-points` POST/PATCH reject a sensitive `parameterKey` (same list as above) with a 422, and `/api/customer-value/conversion-events` only reads the configured non-sensitive data-point keys out of `raw_params` (a legacy sensitive data point is never shown, and is ignored by rule evaluation).

Manual conversions — one policy for `/api/conversion-imports` `create` rows and Add Conversion (`POST /api/offline/conversions`): `evaluateManualConversion` in `lib/offer-access/manual-conversion-policy.ts` (both routes call it; the partner rules are `lib/offer-access/publisher-access.ts`, the same as `/click`). Creating is **admin/manager only** (`requireRole('admin','manager')`; `finance`/`read_only` operators and portal users get 403; the GET lists are any admin role).

- **Tenant:** the offer must be this network's and so must the offer's advertiser; an advertiser column on an import row (`advertiserRef`/`advertiser_ref`/`advertiserId`/`advertiser_id`) must be this network's advertiser *and* the offer's. A partner must be this network's.
- **Partner (optional):** must be `active` (`pending`/`inactive` refused), not explicitly denied on the offer (`offer_publisher_access.access='deny'`), and on a `private`/`ask` (request access) offer must hold an `allow` + `approved` grant. No partner = an administrative record: no partner checks, no partner earning; the advertiser billing entry is still written when approved.
- **Approval:** no status → `approved`. On an offer with "Manually Approve Conversions" on, a missing **or explicit** `approved` is stored as `pending` with `reason = 'manual_approval_required'` and no ledger entries — an import status cell or the Add Conversion `status` can't bypass the setting. Explicit `pending`/`rejected` are kept as given (`reason` null). Ledger entries are written only when the stored status is `approved`.
- **Not checked / not done:** the offer's status (historical conversions on draft/paused/archived offers are allowed); no partner postbacks fire; conversion caps are not enforced — but imported/added non-rejected conversions count toward offer/goal caps.
- **Errors:** an import row that fails any check is a per-row error (`offer "X" not found`, `offer "X" has no advertiser in this network`, `advertiser "X" not found` / `… is not the advertiser of offer …`, `partner "X" not found`, `partner "X" is not active (status: …)`, `… is blocked on offer …`, `… is not approved on private|request-access offer …`, invalid `status`) and nothing is written for it. Add Conversion answers per request: cross-network offer / partner / offer advertiser → 400 (`offerId|publisherId does not belong to this network`, `The offer's advertiser does not belong to this network.`); partner inactive / blocked / not approved → 422 `validation_failed` with `details.reason` = `partner_inactive|partner_denied|partner_not_approved`. Add Conversion's response stays `{ conversionId }` (the stored status may be `pending`) and its `currency` still defaults to `USD` when omitted (imports default to the offer's currency).

Decisions (kept on purpose):

- Click report `/api/reports/grouped` with `conversionStatus`: conversions with no click row (offline/import) are excluded — the filter is a click-level predicate.
- `/api/reports/goals`: approved conversions without a goal and with a null event are labelled `(no event)`.
- Offer groups: a new group's omitted `currency` is the network's default currency; existing groups keep their stored value.

`/api/offer-groups` `currency` must be a 3-letter upper-case code (`usd`, `EURO` → 422, create and PATCH). On create, an omitted `currency` is the network's `default_currency` (`USD` only if that is unset); existing groups keep their stored value (the column is `NOT NULL DEFAULT 'USD'`, so groups created before this change that were defaulted read as `USD`). Today's stats (`GET /api/offer-groups` rows' `today`, `GET /api/offer-groups/:id/stats`) sum the member offers' conversions, whose currencies need not match each other or the group's `currency`; next to the unchanged summed fields they return `currencies` (sorted, distinct, non-null) and `moneyByCurrency` (`{ [currency]: { payout, revenue, margin } }`) built from exactly the same conversions.

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

### Impersonation (admin → portal account)
`POST /api/publishers/:id/impersonate`, `POST /api/advertisers/:id/impersonate` (admin) → `{ token, expiresAt, kind, ownerId, impersonatedBy }`: a dedicated **30-minute** token (`lib/auth/impersonation-token.ts`, HS256, `IMPERSONATION_JWT_SECRET`; 503 if unset) — no longer a Supabase magic link, and the account needn't have a portal login. Used as a Bearer it is that account's portal identity plus `impersonatedBy` (`dashboardAuth`). Every successful write is audited with `audit_log.impersonated_by` = the admin (routes without their own audit row get a generic `impersonation.write` row: method, path, status). Refused while impersonating: `/api/me/password`, `/api/me/email`, `/api/me/anonymize`, portal API key create/revoke. The start is audited as `publisher.impersonate` / `advertiser.impersonate` (actor = admin, `after: { impersonatedBy, expiresAt, sessionId }`). Expired/forged → 401.

### Portal logins (invites + sign-up)
Partners and advertisers get a portal login in-product (`lib/portal-invite.ts`, `lib/provisioning.ts` `ensurePortalLogin`):
- `POST /api/publishers/:id/invite`, `POST /api/advertisers/:id/invite` (admin/manager) — creates the Supabase login (claims `kind`, `network_id`, `owner_id`) with a **temporary password**, links it (`auth_user_id`) and emails it to the contact email via the network SMTP. Returns `{ outcome: created|reissued|linked, authUserId, email, emailed, emailError?, credentials? }`.
  - Idempotent by email: a second invite before they sign in re-issues the same login with a fresh password (`reissued`; follows a changed contact email); an existing, already-used login for the email is linked and its claims re-stamped (`linked`, password untouched, no email).
  - Errors: no contact email → 400 `details.reason=email_required`; this account's login is already active → 409 `already_active`; the email's login belongs to another account/network/staff → 409 `email_in_use` (never taken over; a login left by a deleted account of the same network is reused); Supabase not configured → 503.
  - When the email can't be sent (SMTP unset or failing) the login still exists; outside production `credentials: { loginUrl, email, temporaryPassword }` is returned for dev. Never in production — fix SMTP and invite again.
- Create (`POST /api/publishers`, `POST /api/advertisers`) invites automatically when a `contactEmail` is given, unless the body has `invite: false` or the account is created `inactive`. Best effort: the create never fails because of the invite; the response adds `invited` plus `invite` (as above) or `inviteError`.
- `POST /api/signup/partner` (unauthenticated): network by slug; creates a partner `pending` (shows in Partners › Pending) — or `active` when Control Center › Partners › Sign Up › Auto Approve Partners is on — and provisions its login the same way (the temporary password goes to the email, so only the inbox owner can sign in). 201 `{ status, emailed, message, credentials? (non-production, when not emailed) }`. One sign-up per email: a partner of this network or a login elsewhere → 409 `already_registered` (no partner left behind). Unknown/suspended network → 404; Supabase not configured → 503.
- Audit: `publisher.invite` / `advertiser.invite` (never the password); sign-ups write `publisher.signup` with actor `system`.

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

No API-key response carries a secret: `/api/v1/network/offers` uses `toNetworkApiDTO` (the dashboard admin offer DTO minus `securityCode`, the offer's postback secure code — only the session-authenticated dashboard shows it); advertiser/publisher offer DTOs never had it. No public-api path returns `conversions.raw_params`, postback URLs/logs, goals, creatives, offer groups, smart links or tracking domains.

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
| GET/POST | `/postback` | S2S postback (conversion) | `secure_code` required (tenant by host) |
| GET | `/pixel` | Pixel conversion (1x1 GIF) | Fired from the offer's own site (Referer/Origin; tenant by host) |
| GET | `/iframe` | Iframe conversion | Fired from the offer's own site (Referer/Origin; tenant by host) |

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
  - **Without a transaction ID** the conversion is unique per (network, click, event name) — permanently, not only while the 48h Redis key lives: once any conversion (any status) exists for that click + event with no transaction ID, the same click + event without a transaction ID returns `duplicate` with no conversion or ledger entry. The event name is the one stored on the conversion (the `event` param, or the offer's base event name when none is sent), compared exactly (case-sensitive). Distinct events on the same click still convert separately, and a conversion that has a transaction ID neither blocks nor is blocked by one that doesn't. Concurrent attempts are serialised by a transaction-scoped advisory lock on (network, click, event) taken before the check (`record.ts`).
  - A failed database write frees that attempt's Redis idempotency key (compare-and-delete on a per-attempt token, so another request's key is never removed and a committed conversion keeps its key), so a retry can record the conversion exactly once.
- `event` / `event_name` / `goal` — Event name (selects the goal with that event name)
- `payout` — Payout override (S2S postback only — ignored on pixel/iframe). `amount` is **not** a payout alias
- `revenue` — Revenue override (S2S postback only — ignored on pixel/iframe)
- `sale_amount` / `order_amount` / `amount` — Sale / order value: the base for Percentage / Mixed revenue offers only, never the payout. Explicit names win when several are sent (`sale_amount=200&amount=999` → base 200). Ignored when an explicit `revenue` is sent
- `secure_code` / `security_code` — **Required.** Every network has a code (generated at creation; Settings › Security shows and regenerates it); an offer's own code overrides it. Missing or wrong → `403` and nothing is recorded. The check fails closed: a network whose code was cleared rejects every postback until a code is regenerated. API-key conversions (`POST /api/v1/advertiser/conversions`) are authenticated by the key instead.
- `status` — `approved` (also confirmed/sale/success/1), `rejected` (declined/reversed/cancelled), anything else or omitted → `pending` (no ledger, no partner postback until approved)

The advertiser postback URL shown in the dashboard is `…/postback?click_id={click_id}&txn_id={txn_id}&status=approved&secure_code=<real code>`.

`/postback` is also rate-limited per `click_id` (`TRACKING_RL_POSTBACK_PER_CLICK_LIMIT`, alongside the per-IP limit; both off in development/test).

### Pixel / Iframe
Fired by the visitor's browser, so they carry no secret and are treated as untrusted (`conversions/origin.ts`, `record.ts`):
- Recorded only when the page that fired them belongs to the offer's own site — the `Origin` header when present, else `Referer` — matched against the offer's landing pages (default destination + geo-rule destination overrides; exact host or same registrable domain, so `checkout.brand.com` matches a `lp.brand.com` landing page) or exactly the tracking domain itself. No Referer/Origin, or a foreign site, records nothing; the GIF / HTML is still served so the page never breaks.
- Priced from the goal / click / offer defaults only: `payout`, `amount`, `revenue`, `sale_amount` / `order_amount` are ignored, and Customer Value rules (keyed off the client-supplied `user_id`) are not applied. Use the S2S postback for dynamic payouts or percentage revenue.

### Conversion pricing precedence
explicit `payout`/`revenue` param → **Offer Custom Settings › Revenue & Payout for this partner** (goal-scoped when that event goal fired, else the base conversion; CPA = fixed, CPS = % of the S2S sale amount; matched against the click's time/country/device/OS/browser) → goal matched by event name → partner payout override / country (geo) override frozen on the click → default goal → offer default. Custom Settings also apply per partner: Landing Pages replace the destination at /click; Caps (clicks at /click; conversions/payout/revenue per day/week/month/all-time at conversion → `rejected`, reason `custom_*_cap_reached`); Throttle Rates set that share of conversions to rejected/pending (reason `custom_throttle`). Offer and goal conversion caps (daily = UTC day, total) reject conversions past the cap (`reason=*_conversion_cap_reached`).

### Click access rules
Only an **active** partner of the network is attributed (`surfaces/tracking/partner-status.ts`, Redis load-through, busted by publishers PATCH/DELETE). A `pub_id` that is pending, inactive, unknown or another network's is dropped from the click: the visitor is still redirected, but the click and its conversions carry no partner, so nothing is ever credited to that id (log field `droppedPartner`). A partner that stops being active after the click (or is deleted) gets its conversions held: an approved conversion becomes `pending` with reason `partner_not_active` (no ledger, no partner postback) until an admin approves it. A partner explicitly denied is diverted. Private and Request-access (`ask`) offers only accept clicks from partners with an `allow` + `approved` access row; others are diverted. A partner's payout override is frozen onto their clicks.

### IP lists (Control Center › Security) — enforced (F-16)
- `PUT /api/control-center/ip-blacklist { ranges: [{from, to?}] }` — IPs, CIDRs or same-family from–to ranges (IPv4/IPv6; malformed → 422). `/click` from a listed client IP is diverted (like a blocking traffic control), from the next click on.
- `POST/DELETE /api/control-center/api-whitelist` (IP or CIDR; malformed → 422) — when a network has any entry, its **network-audience** API keys only work from listed IPs (others → 403); advertiser/publisher keys are not restricted by it.
- Both use the real client IP: X-Forwarded-For is trusted only from loopback, Cloudflare ranges and `TRACKING_TRUSTED_PROXIES` (tracking + public-api surfaces). Lists are cached per network in Redis and busted on write; a cache/DB error fails open.

### Finance (dashboard)
- `POST /api/finance/conversions/:conversionId/approve` — pending → approved: tiered commission, earning + billing ledger entries, partner postback (honours "Fire Partner Postback"). Admin/finance.
- `POST /api/finance/conversions/:conversionId/reject` — status + offsetting ledger entries in one transaction (net per account → 0). Admin/finance.
- Currency rule (ledger, `lib/ledger/ledger.ts`): balances are per account **and currency** — amounts in different currencies are never summed, netted or converted (no FX anywhere; `fx_rate` stays 1). Reversals offset every currency's net (idempotency key includes the currency); rebalancing a conversion whose ledger is in another currency is a 422 ("Reverse and re-record it instead") and writes nothing. `reconcileLedger` compares ledger payout debits with `payouts` per (network, publisher, currency).
- `POST /api/finance/payouts/batches` (and public API `POST /api/v1/network/payouts`) — body `{ publisherIds?, note?, currency? }`. A batch carries **one currency**: `currency` given → only that currency's positive approved balances are paid; omitted → the single currency among the payable balances (network default when there are none — an empty run, as before); payable balances in **several** currencies → 422 `validation_failed` (`details.currencies`) and nothing is written. An invalid code (not 3 upper-case letters) → 422. Response `{ batchId, currency, total, lines: [{ publisherId, amount }], skipped: [{ publisherId, currency, amount }] (balances with an invalid stored currency — never paid), otherCurrencies: [{ currency, publishers, total }] (left untouched — run them separately) }`. Runs are serialised per network (transaction-scoped advisory lock; balances read after it), so concurrent runs never pay a balance twice; a repeat run pays nothing.
- Balances (`accountBalances` → `[{ currency, balance }]`): `GET /api/finance/publishers/:id/balance` → `earned`/`payable`/`pending` are the single-currency value (`'0.0000'` when none) or **null when that status spans several currencies**, plus `currency` (null when mixed, the network default when there are no entries) and `balances: { approved: [...], pending: [...] }`. Same additive shape (`balance`, `currency`, `balances`) on `POST /api/publishers/request-balances` rows, portal `GET /api/portal/publisher/earnings`, public API `GET /api/v1/publisher/earnings`; portal `GET /api/portal/publisher/summary` uses `balance`, `balanceCurrency`, `balances` (its KPI already has `currencies`).
- Invoices (`GET /api/invoices`): rows ordered by currency, then the numeric amount (largest first), then account — amounts are never compared across currencies.
- Paying an invoice settles the ledger (`settleInvoice`, `lib/ledger/ledger.ts`), in one transaction with the status change:
  - `POST /api/partner-invoices/:id/approve-pay` → a real payout: a one-line payout batch (note `Partner invoice #<ref>`), a `payouts` row and a ledger `payout` debit, written by `recordPublisherPayout` — the same function payout runs use, so `reconcileLedger` stays clean. `POST /api/advertiser-invoices/:id/pay` → a ledger `receipt` credit against the advertiser's billing.
  - Payout runs and invoice payments share one per-network lock and count settlements oldest-first (FIFO): an invoice may settle only what is still open for its own period, capped by the account's current balance. A period a payout run already paid → `409` ("already paid"), even if newer earnings have arrived since; conversions reversed after the invoice was created → `409`; a payout run after an invoice pays only what is left. Nothing is written on a 409. Zero invoices are marked paid with no ledger entry; negative ones → `409`.
  - `POST /api/partner-invoices/bulk-approve-pay` → `{ updated, skipped: [{ id, reason }] }` — each invoice in its own transaction; one that can't be paid is listed with the reason instead of failing the batch.
  - Create (`POST /api/partner-invoices`, `POST /api/advertiser-invoices`): a period overlapping another live (non-deleted) invoice for the same account + currency → `409` naming that invoice. Enforced in the DB too (exclusion constraints `*_no_overlapping_periods`); deleting an invoice frees its period. Advertiser billed amounts exclude `receipt` entries.
- Add Conversion (`POST /api/offline/conversions`): `currency` omitted → the offer's currency (network default when the offer has none); a supplied one must be 3 upper-case letters; `payout`/`revenue` follow `lib/money.ts` (decimal, ≤ 4 dp, fits numeric(14,4), not negative) → else 422 with a field error.

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
