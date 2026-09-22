-- Offer Templates: enforce at most one default per network.
-- The application-level clear-then-set in offer-templates/routes.ts is the
-- primary guard; this partial unique index is the concurrency-safe belt.
--
-- Pre-migration data check (run before deploying this migration):
--   SELECT network_id, COUNT(*)
--   FROM offer_templates
--   WHERE is_default = true
--   GROUP BY network_id
--   HAVING COUNT(*) > 1;
--
-- If any rows are returned, clean them up first (e.g. keep the most-recently
-- updated row per network, clear the rest) before running the migration.

-- Up Migration
CREATE UNIQUE INDEX offer_templates_one_default_idx
  ON offer_templates (network_id)
  WHERE is_default;

-- Down Migration
DROP INDEX IF EXISTS offer_templates_one_default_idx;
