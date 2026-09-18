-- Partition clicks, conversions, and postback_logs by created_at (monthly RANGE).
--
-- Once partitioned, retention can DROP PARTITION instead of row-by-row ctid deletes,
-- which is O(1) and produces no vacuum pressure.
--
-- Postgres 15+ supports ATTACH PARTITION on partitioned tables.
-- Strategy: create new partitioned tables, drop old indexes, attach old tables as partitions.
--
-- For existing data, old rows live in partitions until dropped by retention.
-- New rows will flow into the default partition unless the retention job creates
-- monthly partitions. See retention.ts for the partition-management logic.
--
-- Up Migration

-- 1. clicks: create partitioned replacement
CREATE TABLE clicks_new (
 id uuid NOT NULL,
 click_id text NOT NULL,
 network_id uuid NOT NULL,
 offer_id uuid NOT NULL,
 publisher_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 ip inet,
 country text,
 region text,
 city text,
 isp text,
 device text,
 os text,
 browser text,
 referrer text,
 user_agent text,
 sub1 text, sub2 text, sub3 text, sub4 text, sub5 text,
 is_unique boolean NOT NULL DEFAULT true,
 fraud_score integer NOT NULL DEFAULT 0,
 fraud_flags text[] NOT NULL DEFAULT '{}',
 resolved_payout numeric(14,4),
 resolved_revenue numeric(14,4),
 currency text
) PARTITION BY RANGE (created_at);

-- 2. Recreate indexes on the partitioned table (must be before attaching)
CREATE UNIQUE INDEX clicks_click_id_key ON clicks_new (click_id);
CREATE INDEX clicks_network_created_idx ON clicks_new (network_id, created_at DESC);
CREATE INDEX clicks_offer_idx ON clicks_new (network_id, offer_id, created_at DESC);
CREATE INDEX clicks_publisher_idx ON clicks_new (network_id, publisher_id, created_at DESC);

-- 3. Attach existing clicks data as a partition
ALTER TABLE clicks_new ATTACH PARTITION clicks PARTITION DEFAULT;

-- 4. Drop old table, rename
DROP TABLE clicks;
ALTER TABLE clicks_new RENAME TO clicks;

-- 5. conversions: create partitioned replacement
CREATE TABLE conversions_new (
 id uuid NOT NULL,
 conversion_id text NOT NULL,
 network_id uuid NOT NULL,
 click_id text NOT NULL,
 offer_id uuid NOT NULL,
 publisher_id uuid,
 advertiser_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 event_name text,
 status text NOT NULL DEFAULT 'pending'
 CHECK (status IN ('pending', 'approved', 'rejected')),
 reason text,
 payout numeric(14,4),
 revenue numeric(14,4),
 currency text,
 transaction_id text,
 source text NOT NULL CHECK (source IN ('postback', 'pixel', 'iframe')),
 raw_params jsonb NOT NULL DEFAULT '{}'::jsonb
) PARTITION BY RANGE (created_at);

CREATE UNIQUE INDEX conversions_conversion_id_key ON conversions_new (conversion_id);
CREATE UNIQUE INDEX conversions_offer_txn_key ON conversions_new (offer_id, transaction_id)
 WHERE transaction_id IS NOT NULL;
CREATE INDEX conversions_network_created_idx ON conversions_new (network_id, created_at DESC);
CREATE INDEX conversions_click_idx ON conversions_new (network_id, click_id);
CREATE INDEX conversions_offer_idx ON conversions_new (network_id, offer_id, created_at DESC);
CREATE INDEX conversions_publisher_idx ON conversions_new (network_id, publisher_id, created_at DESC);
CREATE INDEX conversions_status_idx ON conversions_new (network_id, status);

-- Attach existing data
ALTER TABLE conversions_new ATTACH PARTITION conversions PARTITION DEFAULT;

-- 6. publisher_postbacks (referenced by FK, not retention target — no partition change needed)
-- No changes to publisher_postbacks.

-- 7. postback_logs: create partitioned replacement
CREATE TABLE postback_logs_new (
 id uuid NOT NULL,
 network_id uuid NOT NULL,
 conversion_id text NOT NULL,
 publisher_id uuid,
 url text NOT NULL,
 attempt integer NOT NULL DEFAULT 1,
 status_code integer,
 success boolean NOT NULL DEFAULT false,
 error text,
 created_at timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

CREATE INDEX postback_logs_conversion_idx ON postback_logs_new (network_id, conversion_id);
CREATE INDEX postback_logs_created_idx ON postback_logs_new (network_id, created_at DESC);

ALTER TABLE postback_logs_new ATTACH PARTITION postback_logs PARTITION DEFAULT;
DROP TABLE postback_logs;
ALTER TABLE postback_logs_new RENAME TO postback_logs;

-- Down Migration
-- (Cannot fully reverse — drops partitioned tables, preserves data in default partitions)
-- Manual rollback: restore from backup or manually detach partitions.
