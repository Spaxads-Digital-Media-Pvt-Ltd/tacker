-- ClickHouse schema: conversions (spec §3B, §6, §9; Phase 8 analytics store).
--
-- Mirrors Postgres `conversions`. Same engine family as `clicks`:
-- * ReplacingMergeTree(inserted_at) — workers retried by BullMQ collapse to one row.
-- * Monthly PARTITION BY for cheap retention.
-- * Tenant isolation enforced by leading network_id in ORDER BY and the ReportingProvider's
-- mandatory network_id filter.
--
-- ORDER BY (network_id, toDate(timestamp), offer_id, conversion_id):
-- - `toDate(timestamp)` derives a coarse date marker for ClickHouse primary-index granules, while
-- the underlying `timestamp` stays millisecond-precision for downstream aggregations and joins.
-- 21st-arg toDate() is the canonical ClickHouse pattern when primary-key ordering benefits from
-- coarser granularity than the data itself.
-- - `offer_id` follows date for the same reasons as on the clicks table.
-- - `conversion_id` last; natural key from the Postgres side; makes ReplacingMergeTree dedup
-- resolve unambiguously within (network_id, date, offer_id).
--
-- Note that `click_id`, `publisher_id`, and the geo/device dimensions can be missing for conversions
-- where the originating click was never seen in this analytics store (e.g. imported conversions
-- from offline). We model them as Nullable accordingly.
--
-- `status` is the only multi-value, low-cardinality, query-heavy column on conversions that
-- participates in WHERE filters (status = 'approved' for the financially-realized slice). It is the
-- first candidate for a future projection, but the primary-index ORDER BY is sufficient for the
-- expected scale today.
--
-- `raw_params` (Postgres jsonb) is NOT mirrored. Raw postback payloads are kept in Postgres only;
-- analytics never needs them, and they would dominate storage if included.

CREATE TABLE IF NOT EXISTS tracker.conversions
(
 -- identifiers
 conversion_id String, -- public id
 network_id UUID,
 click_id String, -- originating click (clicks.click_id; may not exist in this table)
 offer_id UUID,
 publisher_id Nullable(UUID),
 advertiser_id Nullable(UUID),
 goal_id Nullable(UUID), -- added in 1700000013000_offer-assets

 -- timestamps
 timestamp DateTime64(3) CODEC(DoubleDelta, ZSTD),
 inserted_at DateTime64(3) DEFAULT now64(3), -- ReplacingMergeTree version

 -- status / reason / source / event
 status LowCardinality(String), -- pending|approved|rejected (matches Postgres CHECK)
 reason Nullable(String), -- e.g. 'outside_attribution_window'
 source LowCardinality(String), -- postback|pixel|iframe|manual
 event_name Nullable(String),

 -- money
 payout Nullable(Decimal(14, 4)),
 revenue Nullable(Decimal(14, 4)),
 currency LowCardinality(Nullable(String)),

 -- attribution — denormalized from the originating click for reporting without a JOIN
 country LowCardinality(Nullable(String)),
 region LowCardinality(Nullable(String)),
 city Nullable(String),
 isp LowCardinality(Nullable(String)),
 device LowCardinality(Nullable(String)),
 os LowCardinality(Nullable(String)),
 browser LowCardinality(Nullable(String)),
 sub1 Nullable(String),
 sub2 Nullable(String),
 sub3 Nullable(String),
 sub4 Nullable(String),
 sub5 Nullable(String),
 smart_link_id  Nullable(UUID),

 -- fraud / validity
 fraud_score UInt16,
 fraud_flags Array(LowCardinality(String)) DEFAULT []
)
ENGINE = ReplacingMergeTree(inserted_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (network_id, toDate(timestamp), offer_id, conversion_id)
TTL toDate(timestamp) + INTERVAL 24 MONTH;
