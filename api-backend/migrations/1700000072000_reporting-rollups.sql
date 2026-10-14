-- Reporting rollups (audit F-20): clicks and conversions pre-aggregated into 15-minute UTC buckets,
-- so aggregate reports and the dashboard stop scanning months of raw rows. 15 minutes, not an hour:
-- every real timezone offset is a whole number of quarter hours, so a report's days and hours in ANY
-- timezone (India's :30 boundaries too) are exact sets of buckets.
--
-- Maintained by the reporting-rollup worker (lib/reporting/rollups.ts): buckets older than ~3 hours are
-- frozen and rolled up; anything newer, and any "dirty" bucket, is read from the raw tables, so a
-- report is exact. The triggers below mark a bucket dirty when a row lands in, or changes in, an
-- already-old bucket (a late click, a conversion approved days later). Raw retention never touches the
-- rollups (deletes are not tracked), so aggregates outlive the raw rows.

-- Up Migration

CREATE TABLE stats_clicks_15m (
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  bucket          timestamptz NOT NULL,
  offer_id        uuid,
  publisher_id    uuid,
  smart_link_id   uuid,
  country         text,
  device          text,
  clicks          integer NOT NULL,
  unique_clicks   integer NOT NULL,
  invalid_clicks  integer NOT NULL,
  fraud_score_sum bigint NOT NULL
);
CREATE INDEX stats_clicks_15m_idx ON stats_clicks_15m (network_id, bucket);

CREATE TABLE stats_conversions_15m (
  network_id        uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  bucket            timestamptz NOT NULL,
  offer_id          uuid,
  publisher_id      uuid,
  advertiser_id     uuid,
  smart_link_id     uuid,
  country           text,
  device            text,
  currency          text,
  total_conversions integer NOT NULL,   -- every status
  conversions       integer NOT NULL,   -- approved
  payout            numeric NOT NULL,   -- approved; unbounded numeric, so sums stay exact
  revenue           numeric NOT NULL
);
CREATE INDEX stats_conversions_15m_idx ON stats_conversions_15m (network_id, bucket);

-- Rollups are complete for buckets in [low_mark, high_mark) (minus dirty ones); backfill walks
-- low_mark back to backfill_floor (the oldest raw row when the rollups were first built).
CREATE TABLE stats_rollup_state (
  id             text PRIMARY KEY,
  low_mark       timestamptz NOT NULL,
  high_mark      timestamptz NOT NULL,
  backfill_floor timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stats_dirty_buckets (
  network_id uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  bucket     timestamptz NOT NULL,
  PRIMARY KEY (network_id, bucket)
);

-- A row whose bucket is older than 2 hours (the worker freezes buckets older than 3) marks it dirty;
-- a late CLICK also marks the buckets of conversions already recorded against it (their country /
-- device / smart link come from the click).
CREATE FUNCTION stats_mark_dirty() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  horizon timestamptz := now() - interval '2 hours';
  origin  timestamptz := TIMESTAMPTZ '2000-01-01 00:00:00+00';
BEGIN
  IF NEW.created_at < horizon THEN
    INSERT INTO stats_dirty_buckets (network_id, bucket)
    VALUES (NEW.network_id, date_bin('15 minutes', NEW.created_at, origin))
    ON CONFLICT DO NOTHING;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.created_at < horizon
     AND (OLD.created_at <> NEW.created_at OR OLD.network_id <> NEW.network_id) THEN
    INSERT INTO stats_dirty_buckets (network_id, bucket)
    VALUES (OLD.network_id, date_bin('15 minutes', OLD.created_at, origin))
    ON CONFLICT DO NOTHING;
  END IF;
  IF TG_TABLE_NAME = 'clicks' AND TG_OP = 'INSERT' AND NEW.created_at < horizon THEN
    INSERT INTO stats_dirty_buckets (network_id, bucket)
    SELECT c.network_id, date_bin('15 minutes', c.created_at, origin)
      FROM conversions c
     WHERE c.network_id = NEW.network_id AND c.click_id = NEW.click_id AND c.created_at < horizon
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER clicks_stats_dirty AFTER INSERT OR UPDATE ON clicks
  FOR EACH ROW EXECUTE FUNCTION stats_mark_dirty();
CREATE TRIGGER conversions_stats_dirty AFTER INSERT OR UPDATE ON conversions
  FOR EACH ROW EXECUTE FUNCTION stats_mark_dirty();

-- Down Migration

DROP TRIGGER IF EXISTS conversions_stats_dirty ON conversions;
DROP TRIGGER IF EXISTS clicks_stats_dirty ON clicks;
DROP FUNCTION IF EXISTS stats_mark_dirty();
DROP TABLE IF EXISTS stats_dirty_buckets;
DROP TABLE IF EXISTS stats_rollup_state;
DROP TABLE IF EXISTS stats_conversions_15m;
DROP TABLE IF EXISTS stats_clicks_15m;
