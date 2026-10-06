-- NEUTRALIZED (intentional no-op). Originally partitioned clicks / conversions / postback_logs by
-- created_at. That broke every click and conversion write on any DB it ran on:
--   * it created no partitions at all, so every INSERT failed with "no partition of relation";
--   * Postgres requires unique indexes on a partitioned table to include the partition key, so
--     the global unique keys the money path depends on — clicks.click_id, conversions.conversion_id
--     and conversions(offer_id, transaction_id) (txn_id idempotency) — could no longer exist, and
--     every `ON CONFLICT (click_id)` / `ON CONFLICT (offer_id, transaction_id)` errored;
--   * it dropped the `id` defaults/primary keys and the 'manual' conversion source.
-- Retention does not need partitioning: retention.ts falls back to bounded ctid deletes on regular
-- tables. DBs that already applied the original version are repaired by
-- 1700000064000_unpartition-tracking-tables.

-- Up Migration
SELECT 1;

-- Down Migration
SELECT 1;
