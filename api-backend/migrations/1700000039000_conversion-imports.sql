-- Up Migration

-- Conversion Imports (Reporting › Conversion Imports): real bulk CSV import jobs against the
-- conversions table, logged as `import_export_logs` rows (kind='import', entity='conversions') —
-- the same table single offline-conversion creates already log to (see offline/routes.ts). Extends
-- it with the per-job tracking the reference's real "Manage Conversion Imports" page shows:
-- total rows vs. total processed (progress), a structured per-row error list, and when processing
-- finished.
ALTER TABLE import_export_logs ADD COLUMN total_processed integer;
ALTER TABLE import_export_logs ADD COLUMN error_count integer NOT NULL DEFAULT 0;
ALTER TABLE import_export_logs ADD COLUMN errors jsonb NOT NULL DEFAULT '[]';
ALTER TABLE import_export_logs ADD COLUMN processed_at timestamptz;

-- Down Migration

ALTER TABLE import_export_logs DROP COLUMN IF EXISTS processed_at;
ALTER TABLE import_export_logs DROP COLUMN IF EXISTS errors;
ALTER TABLE import_export_logs DROP COLUMN IF EXISTS error_count;
ALTER TABLE import_export_logs DROP COLUMN IF EXISTS total_processed;
