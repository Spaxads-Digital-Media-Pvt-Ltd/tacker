# Database Documentation

## Technology
- **PostgreSQL 16** — primary datastore
- **Redis 7** — cache (offer config, dedup, caps, attribution, BullMQ backend)

## Connection
- Local dev: `postgres://tracker:tracker_local_dev@localhost:5432/tracker`
- Staging/prod: Supabase Postgres via connection pooler (`DATABASE_URL`)
- Driver: `pg` (raw, no ORM)
- Max connections: 10 (dev), 20 (prod)

## Schema (62 Migrations)

### Core Tables

#### `networks`
Top-level tenant entity. Each advertiser runs their own network.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `name` | text | Display name |
| `slug` | text | URL-safe identifier |
| `status` | enum | active/suspended/deleted |
| `default_currency` | text | Default currency |
| `subscription_status` | text | Subscription state |
| `plan_code` | text | Plan identifier |

#### `users`
Dashboard auth users (linked to Supabase Auth).

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `ref` | serial | Display ref number |
| `network_id` | uuid | FK to network (tenant) |
| `auth_user_id` | text | Supabase Auth user ID |
| `name` | text | Display name |
| `email` | text | Login email |
| `role` | enum | admin/manager/finance/read_only/super_admin |
| `status` | enum | active/inactive |
| `metadata` | jsonb | Profile fields (phone, address, theme, notifications, etc.) |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

#### `parties`
Unified table for both **advertisers** and **publishers**.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `network_id` | uuid | FK to network |
| `type` | enum | advertiser / publisher |
| `name` | text | Display name |
| `status` | enum | active/pending/inactive |
| `contact_email` | text | |
| `contact_name` | text | |
| `tax_id` | text | |
| `website` | text | |
| `payment_method` | text | (publisher) |
| `billing_terms` | text | (advertiser) |
| `country` | text | |
| `notes` | text | |
| `metadata` | jsonb | Extensible storage |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

#### `offers`
The central entity — what partners promote and advertisers run.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `ref` | serial | Display ref number |
| `network_id` | uuid | FK to network |
| `advertiser_id` | uuid | FK to parties |
| `name` | text | Offer name |
| `status` | enum | draft/active/paused/archived |
| `destination_url` | text | Final redirect URL |
| `payout_model` | enum | CPA/CPL/CPC/CPI/RevShare |
| `default_payout` | text | Numeric (stored as string, never float) |
| `default_revenue` | text | Numeric |
| `currency` | text | Currency code |
| `objective` | enum | conversions/sale/app_installs/leads/impressions/clicks |
| `visibility` | enum | public/private/ask |
| `category` | text | Category label |
| `preview_url` | text | Preview page |
| `security_code` | text | Secure code for postback verification |
| `attribution_window_s` | int | Attribution window (seconds) |
| `dedup_window_s` | int | Dedup window (seconds) |
| `daily_click_cap` | int | Max clicks/day (null = unlimited) |
| `daily_conversion_cap` | int | Max conversions/day |
| `total_conversion_cap` | int | Max conversions total |
| `allowed_traffic_types` | text[] | Allowed traffic types |
| `fallback_url` | text | Diversion URL when blocked |
| `tracking_domain_id` | uuid | FK to tracking_domains |
| `metadata` | jsonb | Extensible storage |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

#### `clicks`
Click records (append-only, written async by workers).

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `network_id` | uuid | FK to network |
| `offer_id` | uuid | FK to offer |
| `publisher_id` | uuid | FK to parties (publisher) |
| `click_id` | text | Unguessable ID (random UUID, no dashes) |
| `ip` | inet | Visitor IP |
| `country` | text | Geo country |
| `region` | text | Geo region |
| `city` | text | Geo city |
| `isp` | text | ISP |
| `device` | text | Device type |
| `os` | text | Operating system |
| `browser` | text | Browser |
| `user_agent` | text | Raw UA string |
| `referrer` | text | HTTP referrer |
| `sub1` – `sub5` | text | Sub-IDs (tracking parameters) |
| `source_id` | text | Traffic source ID |
| `is_unique` | boolean | Dedup flag |
| `fraud_score` | int | Fraud score |
| `fraud_flags` | text[] | Fraud flag list |
| `resolved_payout` | text | Geo-resolved payout |
| `resolved_revenue` | text | Geo-resolved revenue |
| `currency` | text | Currency |
| `smart_link_id` | uuid | FK to smart_links (if applicable) |
| `created_at` | timestamptz | |

#### `conversions`
Conversion records (append-only ledger).

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `network_id` | uuid | FK to network |
| `click_id` | uuid | FK to clicks (via click_id text) |
| `txn_id` | text | External transaction ID |
| `offer_id` | uuid | FK to offer |
| `publisher_id` | uuid | FK to parties |
| `advertiser_id` | uuid | FK to parties |
| `event` | text | Event/goal name |
| `status` | enum | pending/approved/rejected |
| `payout` | text | Payout amount |
| `revenue` | text | Revenue amount |
| `currency` | text | Currency |
| `secure_code_verified` | boolean | Security code check result |
| `source` | enum | postback/pixel/iframe |
| `created_at` | timestamptz | |

#### `ledger_entries`
Append-only money ledger.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `network_id` | uuid | FK to network |
| `conversion_id` | uuid | FK to conversion |
| `party_id` | uuid | FK to parties |
| `entry_type` | text | conversion/payout/adjustment |
| `direction` | enum | credit/debit |
| `amount` | text | Amount (stored as string) |
| `currency` | text | Currency |
| `created_at` | timestamptz | |

#### `tracking_domains`
Configured tracking domains for subdomain/custom tracking.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `ref` | text | Display ref |
| `network_id` | uuid | FK to network |
| `host` | text | Domain name |
| `mode` | enum | subdomain/custom |
| `status` | enum | pending/active/disabled |
| `verification_state` | enum | unverified/pending/verified/failed |
| `ssl_status` | enum | none/pending/issued/error |
| `is_primary` | boolean | Primary domain flag |
| `created_at` | timestamptz | |

#### `api_keys`
API keys for the Public REST API.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `network_id` | uuid | FK to network |
| `prefix` | text | Public prefix (e.g., `net_live_abc123`) |
| `key_hash` | text | SHA256 hash of full key |
| `audience` | enum | advertiser/publisher/network |
| `scopes` | text[] | Permitted scopes |
| `status` | enum | active/revoked |
| `created_at` | timestamptz | |

### Supporting Tables

| Table | Purpose |
|---|---|
| `smart_links` | Smart link definitions (weighted rotation, priority, geo) |
| `smart_link_items` | Items within a smart link (offer_id, weight, position, country) |
| `offer_geo_rules` | Per-offer geo targeting rules |
| `offer_publisher_access` | Per-offer publisher allow/deny |
| `offer_templates` | Offer templates |
| `offer_groups` | Offer groups with shared caps |
| `offer_creatives` | Creative assets for offers |
| `traffic_controls` | Offer traffic control rules |
| `traffic_blockings` | Partner traffic blocking rules |
| `partner_tiers` | Partner tier definitions |
| `partner_tier_members` | Tier membership |
| `partner_tier_offers` | Tier offer assignments |
| `offer_applications` | Publisher offer applications |
| `questionnaires` | Application questionnaires |
| `coupon_codes` | Coupon code tracking |
| `link_templates` | Advertiser link templates |
| `postback_controls` | Dynamic postback control rules |
| `invoices` (partner/advertiser) | Invoice records |
| `custom_fields` | Custom field definitions |
| `custom_metrics` | Custom reporting metrics |
| `conversion_imports` | Bulk conversion imports |
| `investigations` | Fraud investigations |
| `login_events` | Login audit trail |
| `audit_log` | Audit trail |
| `communication_hub` | Communication hub config |
| `customer_value_rules` | Customer value adjustment rules |
| `customer_value_data_points` | Custom customer data |
| `customer_value_conversion_events` | Customer conversion events |
| `marketplace_profiles` | Marketplace public profiles |
| `marketplace_connections` | Marketplace connections |
| `automation_rules` | Scheduled automation rules |
| `automation_webhooks` | Outbound webhook config |
| `control_center_config` | Platform-level configuration |
| `notification_preferences` | Per-user notification settings |
| `segmentations` | Segmentation options |
| `business_units` | Business unit assignments |
| `offer_categories` | Offer category definitions |
| `partner_channels` | Partner channel definitions |

### Relationships (simplified)
```
network (tenant)
 ├── users (auth users with roles)
 ├── parties (advertisers + publishers)
 │ ├── offer_publisher_access
 │ ├── partner_tiers
 │ ├── traffic_blockings
 │ └── invoices
 ├── offers
 │ ├── clicks → conversions → ledger_entries
 │ ├── offer_geo_rules
 │ ├── offer_publisher_access
 │ ├── smart_link_items (via smart_links)
 │ ├── traffic_controls
 │ └── offer_creatives
 ├── tracking_domains
 ├── api_keys
 └── conversions → ledger_entries
```

## Indexes
Indexes are defined within migration SQL files. Key indexes cover:
- `network_id` on all tenant-scoped tables (every query filters by network)
- `offer_id`, `publisher_id`, `click_id`, `txn_id` on click/conversion tables
- `created_at` on append-only tables (for retention queries)

## Migrations
- Tool: `node-pg-migrate` (SQL-based)
- 62 migration files, timestamped `1700000000000_*.sql`
- Run: `npm run migrate` (up), `npm run migrate:down`
- Create: `npm run migrate:create -j sql`

## Constraints
- Money values stored as **text** (never float — `default_payout`, `default_revenue`, amounts)
- `updated_at` triggers on most tables (`1700000000500_updated-at-trigger.sql`)
- Multi-tenancy enforced by `network_id` on every query (server-side, not DB-level)
