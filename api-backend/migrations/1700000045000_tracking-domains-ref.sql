-- Traffic Health: add a stable, human-friendly numeric ID (`ref`) to tracking_domains, matching
-- the reference's own real "ID 1520" style domain identifiers, and the same convention every
-- other real "Manage X" list in this app already uses for its ID column.

-- Up Migration

ALTER TABLE tracking_domains ADD COLUMN ref bigserial;
CREATE INDEX tracking_domains_ref_idx ON tracking_domains (ref);

-- Down Migration

ALTER TABLE tracking_domains DROP COLUMN ref;
