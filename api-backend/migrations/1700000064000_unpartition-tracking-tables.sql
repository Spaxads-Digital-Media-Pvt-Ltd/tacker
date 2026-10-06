-- Repair for DBs that applied the original (now neutralized) 1700000062000_partition-retention:
-- convert any partitioned clicks / conversions / postback_logs back to regular tables with the
-- global unique keys the click + conversion paths depend on (click_id, conversion_id, and
-- (offer_id, transaction_id) for txn_id idempotency). Rows are preserved. On DBs where the tables
-- are already regular (62 never ran) every block below is a no-op.

-- Up Migration
DO $$
BEGIN
  IF (SELECT relkind FROM pg_class WHERE oid = 'public.clicks'::regclass) = 'p' THEN
    CREATE TABLE clicks_unpart (LIKE clicks INCLUDING DEFAULTS);
    INSERT INTO clicks_unpart SELECT * FROM clicks;
    DROP TABLE clicks;
    ALTER TABLE clicks_unpart RENAME TO clicks;
    ALTER TABLE clicks ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ALTER TABLE clicks ADD CONSTRAINT clicks_pkey PRIMARY KEY (id);
    CREATE UNIQUE INDEX clicks_click_id_key ON clicks (click_id);
    CREATE INDEX clicks_network_created_idx ON clicks (network_id, created_at DESC);
    CREATE INDEX clicks_offer_idx ON clicks (network_id, offer_id, created_at DESC);
    CREATE INDEX clicks_publisher_idx ON clicks (network_id, publisher_id, created_at DESC);
  END IF;

  IF (SELECT relkind FROM pg_class WHERE oid = 'public.conversions'::regclass) = 'p' THEN
    CREATE TABLE conversions_unpart (LIKE conversions INCLUDING DEFAULTS);
    INSERT INTO conversions_unpart SELECT * FROM conversions;
    DROP TABLE conversions;
    ALTER TABLE conversions_unpart RENAME TO conversions;
    ALTER TABLE conversions ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ALTER TABLE conversions ADD CONSTRAINT conversions_pkey PRIMARY KEY (id);
    ALTER TABLE conversions ADD CONSTRAINT conversions_status_check
      CHECK (status IN ('pending', 'approved', 'rejected'));
    ALTER TABLE conversions ADD CONSTRAINT conversions_source_check
      CHECK (source IN ('postback', 'pixel', 'iframe', 'manual'));
    CREATE UNIQUE INDEX conversions_conversion_id_key ON conversions (conversion_id);
    CREATE UNIQUE INDEX conversions_offer_txn_key ON conversions (offer_id, transaction_id)
      WHERE transaction_id IS NOT NULL;
    CREATE INDEX conversions_click_idx ON conversions (network_id, click_id);
    CREATE INDEX conversions_goal_idx ON conversions (network_id, goal_id);
    CREATE INDEX conversions_network_created_idx ON conversions (network_id, created_at DESC);
    CREATE INDEX conversions_offer_idx ON conversions (network_id, offer_id, created_at DESC);
    CREATE INDEX conversions_publisher_idx ON conversions (network_id, publisher_id, created_at DESC);
    CREATE INDEX conversions_status_idx ON conversions (network_id, status);
  END IF;

  IF (SELECT relkind FROM pg_class WHERE oid = 'public.postback_logs'::regclass) = 'p' THEN
    CREATE TABLE postback_logs_unpart (LIKE postback_logs INCLUDING DEFAULTS);
    INSERT INTO postback_logs_unpart SELECT * FROM postback_logs;
    DROP TABLE postback_logs;
    ALTER TABLE postback_logs_unpart RENAME TO postback_logs;
    ALTER TABLE postback_logs ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ALTER TABLE postback_logs ADD CONSTRAINT postback_logs_pkey PRIMARY KEY (id);
    CREATE INDEX postback_logs_conversion_idx ON postback_logs (network_id, conversion_id);
    CREATE INDEX postback_logs_created_idx ON postback_logs (network_id, created_at DESC);
  END IF;
END $$;

-- Down Migration
SELECT 1;
