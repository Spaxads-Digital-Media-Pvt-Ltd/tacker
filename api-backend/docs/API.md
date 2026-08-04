# Tracker — API Documentation

Multi-tenant affiliate tracking platform. The API is split into **three independent surfaces**, each with its own auth model and port. A credential for one surface can **never** authenticate another (strict surface segregation).

| Surface | Default base URL | Auth | Who uses it |
|---|---|---|---|
| **Dashboard API** | `http://localhost:4001` | Supabase JWT (Bearer) | The SPA / your admin dashboard |
| **Tracking API** | `http://localhost:4002` | None — tenant resolved by `Host` | Clicks & advertiser postbacks (hot path) |
| **Public REST API** | `http://localhost:4003` | API key (`X-Api-Key`) | External integrations (network / publisher / advertiser) |

In production each surface sits behind its own hostname; tenants are resolved by the request `Host` header on the tracking surface and by the network scope embedded in the JWT / API key elsewhere.

All JSON responses use a common envelope:

```json
{ "ok": true, "data": { /* ... */ }, "meta": { "limit": 50, "offset": 0, "total": 120 } }
```
Errors: `{ "ok": false, "error": { "message": "…", "code": "…" } }`.

---

## Table of contents
1. [Dashboard API](#1-dashboard-api-4001) — auth, account, offers, publishers, advertisers, reports, settings, keys…
2. [Tracking API](#2-tracking-api-4002) — click, postback, pixel, iframe, smart link
3. [Public REST API](#3-public-rest-api-4003) — network / publisher / advertiser key namespaces
4. [Common use cases](#4-common-use-cases) — end-to-end recipes with curl
5. [Postback security (secure_code)](#5-postback-security-secure_code)

---

## 1. Dashboard API (`:4001`)

Every route below (except `/api/auth/*`) requires a **Bearer JWT** obtained from login:

```
Authorization: Bearer <accessToken>
```

Roles/surfaces (the JWT `kind` claim): `admin` (network admin), `publisher`, `advertiser`; plus platform `super_admin`. Admin-only routes are marked **[admin]**. List routes accept `?limit=&offset=` pagination.

### 1.1 Authentication — `/api/auth`
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | Exchange `{ email, password }` → `{ accessToken, expiresAt, identity }`. Refresh token set as an httpOnly cookie. |
| POST | `/api/auth/refresh` | Exchange the refresh cookie → a fresh `accessToken`. |
| POST | `/api/auth/logout` | Clear the refresh cookie. |

`identity` includes `kind`, `networkId`, `role`, `email`, `name`, `theme`.

### 1.2 Account — `/api/me`
| Method | Path | Description |
|---|---|---|
| GET | `/api/me` | Current identity + scope. |
| PATCH | `/api/me/profile` | `{ name }` — update your display name. |
| PATCH | `/api/me/password` | `{ password }` — change your password (min 8). |
| PATCH | `/api/me/theme` | `{ theme: "A".."F" }` — save your UI accent theme. |

### 1.3 Offers — `/api/offers` **[admin]**
| Method | Path | Description |
|---|---|---|
| GET | `/api/offers` | List offers (network-scoped). |
| GET | `/api/offers/stats` | Counts by status. |
| GET | `/api/offers/:id` | Get one offer. |
| POST | `/api/offers` | Create an offer. |
| PATCH | `/api/offers/:id` | Update an offer. |
| DELETE | `/api/offers/:id` | Delete an offer. |
| GET / POST / DELETE | `/api/offers/:id/goals` | Multi-goal payouts. |
| GET / POST / DELETE | `/api/offers/:id/geo-rules[/:ruleId]` | Geo allow/deny + payout/destination overrides. |
| GET / POST / DELETE | `/api/offers/:id/publishers[/:accessId]` | Affiliate access (allow/deny, approval, payout override). |
| GET / POST / PATCH / DELETE | `/api/offers/:id/creatives · /coupons · /deals` | Offer assets. |
| POST | `/api/offers/:id/security-code/regenerate` | Generate/rotate the **per-offer** postback `secure_code`. |
| DELETE | `/api/offers/:id/security-code` | Remove the per-offer code (falls back to the network code). |
| GET / POST / DELETE | `/api/offers/:id/tags` | Tag assignments. |

### 1.4 Affiliates (publishers) — `/api/publishers` **[admin]**
| Method | Path | Description |
|---|---|---|
| GET / POST / PATCH / DELETE | `/api/publishers[/:id]` | CRUD. `GET /stats` for counts. |
| GET / POST | `/api/publishers/:id/postbacks` | List / add an **outbound** postback (fired to the affiliate on approved conversion). Body: `{ url, method, offerId?, event? }`. |
| PATCH / DELETE | `/api/publishers/:id/postbacks/:pbId` | Update / remove a postback. |
| POST | `/api/publishers/:id/postbacks/test` | Fire a test postback. Body: `{ url, method, country?, device? }`. |

### 1.5 Advertisers — `/api/advertisers` **[admin]**
| Method | Path | Description |
|---|---|---|
| GET / POST / PATCH / DELETE | `/api/advertisers[/:id]` | CRUD. `GET /stats` for counts. |
| POST | `/api/advertisers/:id/debug-postback` | Fire the advertiser's conversion postback with sample macros. Body: `{ url, method, country?, device? }`. |

### 1.6 Tracking domains — `/api/tracking-domains` **[admin]**
CRUD (`GET/POST/PATCH/DELETE`). Register the host(s) that serve `/click` and `/postback`; mark one `isPrimary`.

### 1.7 Reports — `/api/reports` **[admin]**
| Method | Path | Description |
|---|---|---|
| GET | `/api/reports?groupBy=&metrics=&from=&to=&offerId=&publisherId=&advertiserId=&country=&device=` | **Generic aggregate report.** `groupBy` (csv, up to 4): `offer,publisher,advertiser,country,device,day,hour,sub1..5`. `metrics` (csv): `clicks,unique_clicks,conversions,cr,payout,revenue,margin,epc`. |
| GET | `/api/reports/dashboard` | KPI board (today vs yesterday / month, sparkline series). |
| GET | `/api/reports/summary` | 24h summary. |
| GET | `/api/reports/clicks` | Row-level clicks (filters: from,to,offerId,publisherId,smartLinkId,country,region,city,device,os,browser,sub1..5,isUnique,fraudMin). |
| GET | `/api/reports/conversions` | Row-level conversions (filters incl. status,event,source,currency). |
| GET | `/api/reports/goals` | Per-goal totals. |
| GET | `/api/reports/caps` | Cap usage per offer. |
| GET | `/api/reports/postback-logs` | Outbound postback delivery log. |
| GET | `/api/reports/smart-links` | Smart-link performance. |

CR is a fraction (multiply by 100 for %).

### 1.8 Settings — `/api/settings` **[admin]**
| Method | Path | Description |
|---|---|---|
| GET | `/api/settings` | General + SMTP (password masked) + integrations. |
| PUT | `/api/settings/general · /smtp · /integrations` | Update each section. |
| GET | `/api/settings/security` | `{ securityCode }` — the **network-wide global** postback `secure_code`. |
| POST | `/api/settings/security/regenerate` | Generate/rotate the global code. |
| DELETE | `/api/settings/security` | Remove the global code. |

### 1.9 Catalog (cross-offer aggregates) — `/api/catalog` **[admin]**
`GET /creatives · /coupons · /deals · /access · /postbacks` — network-wide lists. `POST /postbacks/test` — network-level postback tester (`{ url, method, country?, device? }`).

### 1.10 Other admin resources
| Path | Purpose |
|---|---|
| `/api/smart-links` | CRUD smart links + `/:id/items` rotation entries. |
| `/api/offline/conversions` | GET list / POST record an offline conversion. |
| `/api/import-export` | GET history / `POST /export` (`{ entity, ...filters }` → rows for CSV/XLSX). |
| `/api/alerts`, `/api/fraud-rules` | Alerts + fraud rules. |
| `/api/tags`, `/api/custom-fields` | Network-defined tags & custom fields. |
| `/api/finance`, `/api/invoices`, `/api/subscription` | Ledger-derived billing/payables, invoices, plan/usage. |
| `/api/ai/status` + `/api/ai/*` | AI ops assistant. |

### 1.11 API keys — `/api/keys` **[admin]**
| Method | Path | Description |
|---|---|---|
| GET | `/api/keys` | List keys (prefix, name, scopes, status). |
| GET | `/api/keys/scopes` | Available scopes for the audience. |
| POST | `/api/keys` | Create a key. **The full key is returned once** — store it now. |
| DELETE | `/api/keys/:id` | Revoke a key. |

Portal users manage their own keys at `/api/portal/publisher/keys` and `/api/portal/advertiser/keys`.

### 1.12 Portals (publisher / advertiser logins)
`/api/portal/publisher/*` and `/api/portal/advertiser/*` — owner-scoped self-reads: `/me`, `/stats`, `/summary`, plus `/api/portal/offers`. A portal user only ever sees their own data (publishers never see revenue/margin; advertisers never see publisher payout).

---

## 2. Tracking API (`:4002`)

No auth — the **tenant is resolved from the `Host` header** (register the host under `/api/tracking-domains`, active + verified). Port is stripped, so `localhost:4002` works in dev once `localhost` is registered.

| Method | Path | Purpose | Key query params |
|---|---|---|---|
| GET | `/click` | Record a click → **302** to the offer destination (macros substituted). | `offer_id`, `pub_id`, `geo` (or `?geo=XX` dev override), `sub1..5`, `source`, `deeplink` |
| GET / POST | `/postback` | **S2S conversion** (the primary way advertisers report conversions). | `click_id` (req), `txn_id`, `event`, `status`, `payout`, `revenue`, **`secure_code`** |
| GET | `/pixel` | Image-pixel conversion (returns a 1×1 gif). | same as postback (minus secure_code) |
| GET | `/iframe` | Iframe conversion (returns a tiny html doc). | same as postback |
| GET | `/sl` | Smart-link resolver → 302 to the chosen offer. | smart-link id + click params |

**Destination macros** (substituted into the offer's destination URL on `/click`): `{click_id}`, `{offer_id}`, `{publisher_id}`, `{country}`, `{device}`, `{sub1}..{sub5}`. Pass `{click_id}` into a param your advertiser stores, so they can echo it back on the postback.

**Postback param aliases:** `click_id` = `cid`/`clickid`; `txn_id` = `transaction_id`/`tid`; `event` = `event_name`/`goal`; `payout` = `amount`; `secure_code` = `security_code`.

**Postback responses:** `200 {status: approved|pending|rejected|duplicate}` · `404 {status: click_not_found}` · **`403 {status: security_failed}`** when a required `secure_code` is missing/wrong.

---

## 3. Public REST API (`:4003`)

API-key auth via header **`X-Api-Key: <key>`**. Three key audiences, each locked to its namespace (a network key cannot call `/publisher/*`, etc.). Scopes gate each endpoint (e.g. `offers:read`, `conversions:write`).

| Method | Path | Scope | Description |
|---|---|---|---|
| GET | `/api/v1/openapi.json` | — | Machine-readable OpenAPI spec (public). |
| GET | `/api/v1/advertiser/offers` | `offers:read` | Your offers (revenue shown, not publisher payout). |
| GET | `/api/v1/advertiser/conversions` | `conversions:read` | Your conversions. |
| POST | `/api/v1/advertiser/conversions` | `conversions:write` | **Report a conversion** (server-authenticated; no secure_code needed). |
| GET | `/api/v1/publisher/offers` | `offers:read` | Offers available to you (payout only). |
| GET | `/api/v1/publisher/conversions` | `conversions:read` | Conversions attributed to you. |
| GET | `/api/v1/publisher/earnings` | `reports:read` | Your earnings. |
| GET | `/api/v1/network/offers · /publishers · /advertisers` | `*:read` | Full network detail (incl. margin). |
| GET | `/api/v1/network/reports/summary` | `reports:read` | Aggregate summary (clicks, conversions, revenue…). |
| POST | `/api/v1/network/payouts` | `payouts:write` | Record affiliate payouts. |

Key prefixes look like `net_live_…` (network), and per-audience equivalents.

---

## 4. Common use cases

Set once: `DASH=http://localhost:4001` · `TRACK=http://localhost:4002` · `PUB=http://localhost:4003`.

### 4.1 Log in and call the dashboard
```bash
TOKEN=$(curl -s "$DASH/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"demo-admin@tracker.test","password":"DemoPass123!"}' \
  | jq -r .data.accessToken)

curl -s "$DASH/api/offers" -H "authorization: Bearer $TOKEN" | jq '.data[] | {id, name, status}'
```

### 4.2 Run a report
```bash
curl -s "$DASH/api/reports?groupBy=offer,day&metrics=clicks,conversions,revenue,cr&from=2026-07-01&to=2026-07-31" \
  -H "authorization: Bearer $TOKEN" | jq '.data.rows'
```

### 4.3 Fire a test click, then a conversion (end-to-end)
```bash
# 1) Click → 302; capture the click_id your destination echoes (e.g. in a sub param)
curl -sI "$TRACK/click?offer_id=<OFFER_UUID>&pub_id=<PUB_UUID>&geo=CA" -H "Host: localhost" | grep -i location

# 2) Report the conversion via S2S postback
curl -s "$TRACK/postback?click_id=<CLICK_ID>&txn_id=order-123&event=purchase&status=approved&payout=5.00" \
  -H "Host: localhost"
# → {"status":"approved","conversion_id":"…"}
```

### 4.4 Give an advertiser their conversion postback URL
```
https://<your-tracking-domain>/postback?click_id={click_id}&txn_id={transaction_id}&payout={payout}&status=approved&secure_code=<code>
```
The advertiser fills `{click_id}` / `{transaction_id}` with the values you passed them at click time and fires this on conversion.

### 4.5 Add an outbound postback for an affiliate
```bash
curl -s "$DASH/api/publishers/<PUB_ID>/postbacks" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"url":"https://affiliate.example/pb?cid={click_id}&payout={payout}","method":"GET"}'
```
Fired to the affiliate when a conversion for them is approved. Macros: `{click_id} {conversion_id} {payout} {revenue} {currency} {txn_id} {event} {sub1..5}`.

### 4.6 Public API — report a conversion with an advertiser key
```bash
curl -s "$PUB/api/v1/advertiser/conversions" -H "X-Api-Key: <ADV_KEY>" \
  -H 'content-type: application/json' \
  -d '{"clickId":"<CLICK_ID>","txnId":"order-123","event":"purchase","status":"approved"}'
```
(Already authenticated by key → no `secure_code` required.)

---

## 5. Postback security (`secure_code`)

An extra layer for **S2S postbacks** so a leaked `click_id` alone can't forge conversions.

- **Global code** — one per network. Set it in **Settings → Integration & security** (or `POST /api/settings/security/regenerate`). Once set, every `/postback` must include a matching `secure_code`.
- **Per-offer code** — overrides the global for one offer. Set it on the **Offer → Postback & Security** card (or `POST /api/offers/:id/security-code/regenerate`).
- **Precedence:** offer code (if set) → else network code → else no check.
- **Enforcement:** only the unauthenticated tracking `/postback` is checked. The public REST API (`/api/v1/advertiser/conversions`) is already key-authenticated and is **not** subject to `secure_code`.
- **Failure:** `403 { "status": "security_failed" }`.

```bash
# Rejected — code required but missing:
curl -s "$TRACK/postback?click_id=<CID>&txn_id=t1&status=approved" -H "Host: localhost"
# → 403 {"status":"security_failed"}

# Accepted — correct code:
curl -s "$TRACK/postback?click_id=<CID>&txn_id=t1&status=approved&secure_code=<CODE>" -H "Host: localhost"
# → 200 {"status":"approved",…}
```

> Code changes propagate to the tracking hot path within the config cache TTL (≤5 min).

---

*Generated from the live route definitions across `src/surfaces/{dashboard,tracking,public-api}`. For the machine-readable public-API contract, fetch `GET /api/v1/openapi.json`.*
