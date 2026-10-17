# Database Documentation

## Technology
- **PostgreSQL 16** — primary datastore
- **Redis 7** — cache (offer config, dedup, caps, attribution, BullMQ backend)

## Connection
- Local dev: `postgres://tracker:tracker_local_dev@localhost:5432/tracker`
- Staging/prod: Supabase Postgres via connection pooler (`DATABASE_URL`)
- Driver: `pg` (raw, no ORM)
- Max connections: 10 (dev), 20 (prod)

## Schema (86 Migrations)

### Core Tables

#### `networks`
Top-level tenant entity. Each advertiser runs their own network.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `name` | text | Display name |
| `slug` | text | URL-safe identifier |
| `status` | enum | active/suspended/deleted — only `active` tracks, serves the dashboard and answers API keys; `deleted` = soft-deleted (F-26) |
| `deleted_at` | timestamptz | When it was soft-deleted (purge grace period counts from here; cleared on restore) — migration 074 |
| `exported_at` | timestamptz | Last full data export (a purge wants one taken after `deleted_at`) — migration 074 |
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
| `cap_timezone` | text | When this offer's daily caps reset (IANA zone); NULL = the network's (settings.general.capTimezone), else UTC (migration 081) |
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
| `source_id` | text | Traffic source from the click URL (`source_id` / `source` / `src`, first non-blank); NULL when absent or blank and on clicks before migration 066 |
| `fbclid` | text | Meta click id from the click URL (`fbclid`); NULL when absent or blank |
| `gclid` | text | Google Ads click id from the click URL (`gclid`); NULL when absent or blank |
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

Unique `(offer_id, event_name, transaction_id) NULLS NOT DISTINCT WHERE transaction_id IS NOT NULL` (`conversions_offer_event_txn_key`, migration 079 — was `(offer_id, transaction_id)`): a transaction id is unique per offer + event, so one click can carry several conversions (Everflow model; the per-event duplicate rule is `offer_goals.duplicate_mode` — `one_per_click` / `unique_txn` / `every_postback`, NULL = the offer's `metadata.revenue_settings.duplicateMode`).

#### `ledger_entries`
Append-only money ledger.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `network_id` | uuid | FK to network |
| `account_type` / `account_id` | text / uuid | `publisher` or `advertiser` + its id |
| `conversion_id` | text | The conversion an earning/billing/reversal belongs to (null for payouts / receipts / manual entries) |
| `entry_type` | text | `earning` (publisher credit), `billing` (advertiser debit), `reversal`, `adjustment`, `payout` (publisher debit — payout runs and paid partner invoices), `receipt` (advertiser credit — paid advertiser invoices) |
| `direction` | text | `credit` / `debit` |
| `amount` | numeric(14,4) | Always ≥ 0; the sign comes from `direction` (API carries it as a string) |
| `idempotency_key` | text | Unique — a retried write never double-counts |
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
| `smart_links` | Smart link definitions (weight / priority / kpi, catch-all, KPI settings, `kpi_computed_at` — migration 071) |
| `smart_link_items` | Items within a smart link (offer_id, weight, position, country; KPI worker output `kpi_weight`, `kpi_score`, `kpi_clicks` — migration 071) |
| `offer_geo_rules` | Per-offer geo targeting rules |
| `offer_publisher_access` | Per-offer publisher allow/deny |
| `offer_templates` | Offer templates |
| `offer_groups` | Offer groups with shared caps |
| `offer_creatives` | Creative assets for offers — `url` is an object-storage or hosted http(s) URL (F-27); rows from before may still hold the file inline as a `data:` URI until `npm run creatives:backfill` |
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
| `audit_log` | Audit trail (`impersonated_by` = the admin behind writes made while impersonating a portal account — migration 1700000069000) |
| `stats_clicks_15m` | Click rollups per 15-min UTC bucket × network/offer/publisher/smart link/country/device: clicks, unique, invalid, fraud_score_sum (migration 072, F-20), `rejected_clicks` — clicks /click rejected (migration 080; portal / automation views subtract them) |
| `stats_conversions_15m` | Conversion rollups per bucket × network/offer/publisher/advertiser/smart link/country/device (click's)/currency: total + approved count, approved payout/revenue (unbounded numeric) |
| `stats_rollup_state` | Rollup window (`low_mark`, `high_mark`) + `backfill_floor` |
| `stats_dirty_buckets` | (network, bucket) to re-roll — written by the `clicks_stats_dirty` / `conversions_stats_dirty` triggers (`stats_mark_dirty()`) for rows landing/changing in buckets > 2h old |
| `usage_records` | Daily usage per network × metric (`clicks`, `conversions`, `events` — conversions with an event name — written hourly by the usage-meter worker; `api_calls`, `storage` reserved), unique (network, metric, period_date) — migration 074 added `events` (F-26) |
| `saved_reports` | Report pages' saved configs per owner (`network_id`, `owner_user_id`, `page`, `name` unique together; `config` jsonb) + optional schedule: `schedule` (5-field cron, network zone), `range_preset`, `recipients` text[], `next_run_at` (due index), `last_run_at` / `last_run_status` (sent\|skipped\|failed) / `last_run_detail` (migration 073, F-24) |
| `inbound_postback_logs` | Every inbound conversion request (postback / pixel / iframe / advertiser API — `source`) and what happened to it (migration 078): `outcome` (approved\|pending\|rejected = recorded, with `conversion_id`; duplicate\|click_not_found\|security_failed\|error = nothing recorded), `reason`, `click_id`, `transaction_id`, `event_name`, the click's `offer_id` / `publisher_id` / `advertiser_id`, `payout` / `revenue` / `currency` / `sale_amount`, `http_status`, `ip`, `user_agent`, `params` (secrets masked). Indexed (network, created_at), (network, click_id), (network, transaction_id). Pruned on the click retention window; FK-cascaded with the network (so exported / purged with it) |
| `purged_networks` | Tombstone of a purged network (D3, migration 082; platform-level, no FK): id (= the ledger rows' network_id), name, slug, default_currency, created / deleted / exported / purged at, `purged_by` (platform admin), `ledger_entries_retained`, `auth_users_deleted`, `rows_deleted`. Written in the purge transaction |
| `platform_invoices` | The platform's invoices to its tenant networks (migration 083): `number` (unique, from `platform_invoice_number_seq`), `network_id` (**no FK** — kept after a purge, with the `bill_to` snapshot), subscription / plan, description, currency, `subtotal` / `tax_rate` / `tax` / `total` numeric, period, `status` open\|paid\|void, `issued_at` / `due_at` / `suspend_at` (CHECK ≥ due), `suspension_applied_at` (once per deadline), paid at / amount / method / reference, void at / reason, notes, `created_by` (platform admin id or 'system'). Unique live invoice per (subscription_id, period_start) |
| `platform_settings` | Platform-wide key → jsonb (migration 083); `billing` = invoice prefix, due / grace days, tax rate, auto-suspend, seller, payment instructions |
| Migration 084 | `platform_admins.last_login_at` (set by `POST /platform/login`; Super Admin › Team) |
| Migration 092 | Two-factor sign-in on `platform_admins`: `totp_secret` (base32, encrypted `enc:v1:` with SETTINGS_ENC_KEY), `totp_pending_secret` (setup not finished), `totp_enabled_at` (NULL = off), `totp_last_step` (the last 30-second step used — a code is never accepted twice), `recovery_code_hashes` text[] (sha256 of each unused recovery code). The platform setting `platform_settings.security` = `{ requireTwoFactor }` |
| `sales_leads` | Super Admin › Sales (migration 086): `company`, contact (`contact_name`, `email`, `phone`, `website`, `country`), `source` (website\|referral\|event\|outbound\|partner\|inbound\|manual\|other), `stage` (new\|contacted\|qualified\|demo\|trial\|negotiation\|won\|lost), `owner_id` (→ platform_admins), `plan_id`, `expected_mrr` numeric (text in the API), `currency`, `monthly_clicks`, `tags`, `notes`, `message` (what an inbound lead wrote), `next_step` / `next_step_at`, `lost_reason`, `network_id` (unique; set when converted), `stage_changed_at`, `won_at`, `lost_at`, `created_by` |
| `sales_activities` | A lead's timeline (migration 086): `kind` note\|call\|email\|meeting (people) · stage\|owner\|created\|converted\|inbound\|task (the system), `body`, `meta` jsonb (from / to, network…), `actor_id`; `created_at` = clock_timestamp() so entries of one transaction keep their order |
| `platform_tasks` | The platform team's tasks (migration 086): `title`, `notes`, `kind` sales\|success\|support\|billing\|other, `priority`, `status` open\|done, `due_at`, `assignee_id`, `lead_id` / `network_id` (cascade), `completed_at` / `completed_by`, `created_by`. `sales_leads` / `platform_tasks` are platform-internal: never in a network's export (`PLATFORM_ONLY_TABLES` in lib/networks/lifecycle.ts) |
| `network_accounts` | Customer success per network (migration 087; PK network_id, cascade): `tags`, `health_score` 0–100, `health_status` healthy\|attention\|at_risk, `health_components` (usage, trend, engagement, billing, onboarding — each 0–100), `health_signals` (clicks 7d / prev 7d / today / 30d, conversions 7d, last sign-in, active users 14d, subscription, overdue invoices…), `onboarding` (10 milestones with dates), `onboarding_pct`, `health_computed_at` |
| `network_health_history` | One score per network per day (migration 087; PK network_id + day), ~400 days kept |
| `network_notes` | The team's notes about a network (migration 087): `body`, `pinned`, `author_id`. These three are platform-only (never in a network's export) |
| `support_tickets` | The help desk (migration 088): `number` (sequence from 1001), `network_id` (cascade), `subject`, `category`, `priority` low\|normal\|high\|urgent, `status` open\|pending\|on_hold\|resolved\|closed, requester (`requester_user_id` → users, email, name), `assignee_id`, `tags`, `first_response_due_at` (from `platform_settings.support` hours per priority), `first_response_at`, `last_customer_at`, `last_staff_at`, `resolved_at`, `closed_at`, `satisfaction` 1–5 + comment, `created_by_admin_id`. Platform-only (not in a network's export) |
| `support_messages` | A ticket's thread (migration 088): `author_kind` customer\|staff\|system, `author_user_id` / `author_admin_id`, `author_name`, `body`, `internal` (team-only notes; never a customer's), `created_at` = clock_timestamp() |
| `support_macros` | Saved replies (migration 088): `title`, `body`, `uses` |
| `platform_invoice_lines` | An invoice's lines (migration 089; cascade with the invoice): `position`, `kind` plan\|overage\|discount\|addon\|setup\|one_off, `description`, `quantity`, `unit_amount`, `amount` (discount negative), `meta`. Every older invoice got its one line back-filled. `subscription_plans.overage` jsonb `{ clicks: { per, price } }` (migration 089) |
| `platform_coupons` / `subscription_discounts` | Coupons (migration 089): `code` (unique upper), `kind` percent\|amount (`percent_off` or `amount_off` + `currency`), `duration` once\|repeating (`duration_cycles`)\|forever, `max_redemptions`, `redeemed`, `valid_until`, `status`. A network's discount: `coupon_id`, `cycles_left`, `applied_by`, `ended_at` — one active per network (partial unique index); platform-only |
| `platform_credit_notes` | Credit against a paid invoice (migration 089; no FK to networks — outlives a purge): `number` CN-<year>-…, `invoice_id`, `amount`, `currency`, `reason`, `refunded` + `refund_method` / `refund_reference` |
| `platform_mrr_snapshots` / `platform_mrr_days` / `platform_mrr_movements` | MRR history (migration 089; no FKs): one row per paying network per day (`mrr`, `currency`, `plan_id`, `status`); the days the snapshot ran; each change against the previous run day — `kind` new\|expansion\|contraction\|churn\|reactivation, `amount` (signed), `from_mrr` / `to_mrr`. Written by `lib/billing/revenue.ts snapshotMrr` after every billing run; the first run day is only the baseline |
| `platform_feature_flags` | Feature flags (migration 090): `key` (unique), `name`, `description`, `enabled`, `rollout_percent`, `plan_ids`, `network_ids_on`, `network_ids_off`, `kill_switch`, `created_by` / `updated_by` |
| `platform_announcements` / `platform_announcement_dismissals` | Announcements (migration 090): `title`, `body`, `kind`, `audience` all\|plans\|networks (+ `plan_ids` / `network_ids`), `roles` (admin\|publisher\|advertiser), `starts_at` / `ends_at`, `maintenance_starts_at` / `_ends_at` (required for kind maintenance), `dismissible`, `link_url` / `link_label`, `status` draft\|published\|archived. Dismissals per person (`user_key` = the auth user id) |
| `email_outbox` (migration 091) | `network_id` is now nullable: NULL = the platform's own email (sent with the platform SMTP, `platform_settings.email`), with `about_network_id` (no FK) for its log |
| `platform_roles` | Platform staff roles (migration 085): `key` (unique), `name`, `description`, `permissions` jsonb `{ <section>: none\|read\|full }`, `scope` all\|assigned, `home` (the page it lands on), `is_system`. Seeded with fixed ids: owner `…0001`, admin `…0002`, sales `…0003`, account_manager `…0004` (assigned), support `…0005`, finance `…0006`, read_only `…0007`. Also: `platform_admins.role_id` (NOT NULL, default = owner, ON DELETE RESTRICT); `networks.account_manager_id` / `networks.sales_owner_id` (→ platform_admins, ON DELETE SET NULL) — what an `assigned` role may see |
| Migration 083 also | `subscription_plans.billing_interval` (month\|year), `trial_days`, `description`; `subscriptions.trial_ends_at`, `cancel_at_period_end`, `canceled_at`; `networks.suspended_reason` (manual\|billing — billing suspensions lift when paid) |
| `email_outbox` | Every queued email, one row per recipient (O11, migration 075): `event`, `recipient`, `subject`, `html` (enc:v1 while `sensitive` — invites / reset links — and wiped once sent), `attachments`, `status` queued\|sent\|failed, `attempts`, `last_error`, `sent_at`. Kept 90 days (retention) |
| `partner_invoices` / `advertiser_invoices` (O8, migration 076) | Status adds `void` (+ `voided_at`, `voided_by`, `void_reason`); `deleted` only on rows soft-deleted before. The no-overlap exclusion ignores void + deleted. Trigger `invoice_paid_is_final`: a paid invoice's status can't change (no delete, no void) |
| `communication_hub` | Communication hub config |
| `customer_value_rules` | Customer value adjustment rules |
| `customer_value_data_points` | Custom customer data |
| `customer_value_conversion_events` | Customer conversion events |
| `marketplace_profiles` | Marketplace public profiles |
| `marketplace_connections` | Marketplace connections |
| `offer_scheduled_actions` | Offer scheduled actions; `params` (cap_change), `executed_at`, `result`, status pending\|executed\|cancelled\|failed (migration 070) |
| `automation_alert_rules` | Automation alert rules; `state` (what is firing), `last_evaluated_at`, `last_fired_at`, `last_error` (migration 070) |
| `smartswitch_rules` | SmartSwitch rules (D8, migration 077): `conditions`, `action` notify\|block\|redirect\|payout + `action_params` (`redirectUrl` / `payout`), `action_delay`, scope `offer_ids` / `advertiser_ids` / `partner_ids`, `state` (`holding` / `acted` per offer:partner), `last_evaluated_at`, `last_fired_at`, `last_error`; `variable` / `actionable_variables` are legacy free text |
| `smartswitch_history` | A rule's log: `kind` change (an edit, `employee` = the login) \| action (`offer_id`, `publisher_id`, `details`: action, outcome, values) |
| `automation_webhooks` | Outbound webhook config (`events` normalised list or `*`) |
| `automation_webhook_deliveries` | One row per webhook delivery: event, payload, status, attempts, status_code, error (migration 070) |
| `control_center_config` | Platform-level configuration |
| `notification_preferences` | Per-user notification settings |
| `segmentations` | Segmentation options |
| `business_units` | Business unit assignments |
| `segmentation_categories` | Category catalog (Control Center); source for offer category options — `offers.category` stays free text. 055's `offer_categories` was merged in and dropped by migration 065 |
| `segmentation_channels` | Channel catalog (Control Center); `publishers.channel_id` → here (repointed from 055's `partner_channels`, dropped by migration 065) |

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
- 84 migration files, timestamped `1700000000000_*.sql`
- `1700000062000_partition-retention` is an intentional no-op: the original partitioned `clicks`/`conversions`/`postback_logs` without creating partitions and dropped the global unique keys (`click_id`, `conversion_id`, `(offer_id, transaction_id)`) that idempotency depends on. `1700000064000_unpartition-tracking-tables` converts any DB that ran the original back to regular tables (rows preserved). These three tables must stay non-partitioned; retention prunes them with bounded ctid deletes.
- `1700000079000_multi-conversion` swaps the transaction-id key to `(offer_id, event_name, transaction_id)` and adds `offer_goals.duplicate_mode`; its down migration fails if two conversions share an offer + transaction id under different events (resolve those first).
- Run: `npm run migrate` (up), `npm run migrate:down`
- Create: `npm run migrate:create -j sql`

## Constraints
- Money values stored as **text** (never float — `default_payout`, `default_revenue`, amounts)
- `updated_at` triggers on most tables (`1700000000500_updated-at-trigger.sql`)
- Multi-tenancy enforced by `network_id` on every query (server-side, not DB-level)
