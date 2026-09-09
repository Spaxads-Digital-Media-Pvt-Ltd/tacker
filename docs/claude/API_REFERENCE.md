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
| GET,POST,PATCH,DELETE | `/api/partner-channels/*` | Partner channels | admin |
| GET,POST,PATCH,DELETE | `/api/offer-categories/*` | Offer categories | admin |
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
| GET,POST,PATCH,DELETE | `/api/control-center/*` | Control center | admin |

### API Key Management
| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| GET,POST | `/api/keys` | List/create network API keys | admin |
| PATCH,DELETE | `/api/keys/:id` | Update/revoke API keys | admin |
| GET,POST | `/api/portal/publisher/keys` | Publisher API keys | portal:publisher |
| GET,POST | `/api/portal/advertiser/keys` | Advertiser API keys | portal:advertiser |

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
- `offer_id` (required) — Offer to redirect for
- `pub_id` / `aff_id` / `p` — Publisher ID
- `sub1`–`sub5` — Sub-IDs
- `source_id` / `source` / `src` — Traffic source
- `geo` / `test_geo` — Force country (dev/testing)
- `sl` — Smart link ID (when routed via smart link)

### Postback Parameters
- `click_id` (required) — The click to attribute to
- `txn_id` / `transaction_id` / `tid` — External transaction ID
- `event` / `event_name` / `goal` — Event name
- `payout` / `amount` — Payout override
- `revenue` — Revenue override
- `secure_code` / `security_code` — Secure code verification
- `status` — Status hint
- `event` — Event name

## Health & Metrics
Every surface exposes:
- `GET /health` — JSON health report
- `GET /metrics` — Prometheus text exposition

## Workers (port 4005)
- `GET /health` — Health check
- `GET /metrics` — Prometheus metrics (includes queue depth)
