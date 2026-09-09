-- ClickHouse schema: clicks (spec §3B, §9, §10.1; Phase 8 analytics store).
--
-- Design notes:
-- * Source of truth remains Postgres `clicks`. This table is the analytics mirror populated by the
--  AnalyticsWriter (Phase 8). Writer is idempotent on (network_id, click_id) — see ReplacingMergeTree.
-- * Engine: ReplacingMergeTree. Multiple inserts for the same event must collapse to one row
-- during merges; the `version` column is the ingested_at epoch ms of the insert. The standard
-- trick: pick the highest version during background merges. Workers retried by BullMQ therefore
-- leave exactly one row in the table.
-- * PARTITION BY toYYYYMM: monthly parts are the sweet spot for high-volume append-only event
-- tables (small-parts overhead under control; drop-partition retention is one click away).
-- * ORDER BY (network_id, timestamp, offer_id, click_id):
--  - Leading `network_id` is mandatory for tenant isolation. Every query MUST filter by it
-- (the ReportingProvider already does); the order-by prefix lets ClickHouse prune whole
-- granules of unrelated tenants.
-- - Second column is `timestamp` because the dominant query pattern is "clicks within a time
-- range, grouped by offer/publisher/country/etc.". Coarse timestamp granularity (granule
-- marker) trims date-range scans dramatically.
-- - `offer_id` after timestamp because it's the next-most-common filter; sorting rows for the
-- same timestamp by offer makes filter-by-offer range scans contiguous.
-- - `click_id` last to break remaining ties — no uniqueness guarantee is required, but the
-- ReplacingMergeTree dedup happens on the entire ORDER BY tuple and we want that key to be
-- unambiguous (click_id is the natural primary key on the Postgres side).
-- * LowCardinality(String) for bounded-cardinality string columns (country/device/os/browser/isp/region
-- and currency). Saves both storage and CPU on group-by queries.
-- * Nullable(...) ONLY where the column can genuinely be missing — every Nullable column adds an
-- extra byte and complicates aggregations. Most fields are not nullable here.
-- * money_payout / money_revenue use Decimal(14, 4) to mirror Postgres numeric(14,4). Money is
--  NEVER Float (project rule).
-- * IPv4 / IPv6 columns use IPv6 (ClickHouse's superset type) — ipv6 + assumeDual() handles both.
-- We store NULL rather than 0.0.0.0 to preserve "unknown" semantics.
-- * fraud_flags is Array(LowCardinality(String)) — small bounded set, queried via empty/non-empty
--  checks ("Others > Ignore Fail Traffic") and length().
-- * No projections / materialized views in this migration. ReportingProvider's queries are small
-- group-by rollups over low-cardinality dimensions; the primary-index design above is sufficient
-- for the expected scale (100M+ rows/month at the click volume targeted). Adding a projection
-- for every popular group-by is premature; we revisit when query latencies warrant it.

CREATE TABLE IF NOT EXISTS tracker.clicks
(
 -- identifiers
 click_id String, -- public, unguessable id (also in Postgres)
 network_id UUID, -- tenant isolation, leading ORDER BY column
 offer_id  UUID,
 publisher_id Nullable(UUID),
 smart_link_id  Nullable(UUID), -- added in 1700000015000_smart-links-offline

 -- timestamps (DateTime64(3) = ms precision; matches the project's millisecond default)
 timestamp DateTime64(3) CODEC(DoubleDelta, ZSTD),
 inserted_at DateTime64(3) DEFAULT now64(3), -- ReplacingMergeTree version

 -- money — never Float (project rule). Decimal(14,4) matches Postgres numeric(14,4).
 payout Nullable(Decimal(14, 4)),
 revenue Nullable(Decimal(14, 4)),
 currency LowCardinality(Nullable(String)),

 -- network / geo
 ip Nullable(IPv6),
 country LowCardinality(Nullable(String)),
 region  LowCardinality(Nullable(String)),
 city Nullable(String),
 isp LowCardinality(Nullable(String)),

 -- device / browser
 device LowCardinality(Nullable(String)),
 os LowCardinality(Nullable(String)),
 browser  LowCardinality(Nullable(String)),

 -- referrer / user agent — high-cardinality, often long, low query value: kept but NOT in ORDER BY
 referrer Nullable(String),
 user_agent  Nullable(String),

 -- sub-ids (publisher-side tracking slots)
 sub1 Nullable(String),
 sub2 Nullable(String),
 sub3 Nullable(String),
 sub4 Nullable(String),
 sub5 Nullable(String),

 -- fraud / validity
 is_unique UInt8,  -- boolean -> UInt8 in ClickHouse
 fraud_score  UInt16, -- Postgres integer -> UInt16 (max 65535)
 fraud_flags Array(LowCardinality(String)) DEFAULT []
)
ENGINE = ReplacingMergeTree(inserted_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (network_id, timestamp, offer_id, click_id)
TTL toDate(timestamp) + INTERVAL 24 MONTH; -- 2-year retention default; tune per env
