-- Click Report fields captured from the click URL itself (no external provider):
--   source_id — the partner's traffic source (?source_id= / ?source= / ?src=), already read at
--               click time for Traffic Blocking but never stored.
--   fbclid    — Meta/Facebook click id (?fbclid=) when the traffic source appends it.
--   gclid     — Google Ads click id (?gclid=) when the traffic source appends it.
-- NULL = not present on the click URL (and for every click recorded before this migration).
-- Nullable, no default → metadata-only ADD COLUMN on PostgreSQL 11+ (no table rewrite).
-- Deploy order: apply this BEFORE the workers that write these columns (click-persist).

-- Up Migration
ALTER TABLE clicks ADD COLUMN IF NOT EXISTS source_id text;
ALTER TABLE clicks ADD COLUMN IF NOT EXISTS fbclid text;
ALTER TABLE clicks ADD COLUMN IF NOT EXISTS gclid text;

-- Down Migration
ALTER TABLE clicks DROP COLUMN IF EXISTS gclid;
ALTER TABLE clicks DROP COLUMN IF EXISTS fbclid;
ALTER TABLE clicks DROP COLUMN IF EXISTS source_id;
