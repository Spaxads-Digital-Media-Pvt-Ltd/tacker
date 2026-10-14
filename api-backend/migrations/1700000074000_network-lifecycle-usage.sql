-- Network lifecycle + plan metering (audit F-26).
-- networks: deleting a network is now a soft delete (status 'deleted' + deleted_at — tracking, the
-- dashboard and the API stop, every row is kept); the hard delete is a separate, confirmed purge that
-- wants a data export first (exported_at) and a grace period after deleted_at.
-- usage_records: the usage meter also records 'events' (conversions that carry an event name).

-- Up Migration

ALTER TABLE networks
  ADD COLUMN deleted_at  timestamptz,
  ADD COLUMN exported_at timestamptz;

ALTER TABLE usage_records DROP CONSTRAINT usage_records_metric_check;
ALTER TABLE usage_records ADD CONSTRAINT usage_records_metric_check
  CHECK (metric IN ('clicks', 'conversions', 'events', 'api_calls', 'storage'));

-- Down Migration

DELETE FROM usage_records WHERE metric = 'events';
ALTER TABLE usage_records DROP CONSTRAINT usage_records_metric_check;
ALTER TABLE usage_records ADD CONSTRAINT usage_records_metric_check
  CHECK (metric IN ('clicks', 'conversions', 'api_calls', 'storage'));

ALTER TABLE networks
  DROP COLUMN IF EXISTS exported_at,
  DROP COLUMN IF EXISTS deleted_at;
