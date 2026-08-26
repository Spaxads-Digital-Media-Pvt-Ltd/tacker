-- Control Center › Accounts › History Log: add a stable, human-friendly numeric ID (`ref`) to
-- audit_log, matching the reference's own real "5923" style row IDs and the same convention every
-- other real "Manage X" list in this app already uses for its ID column.

-- Up Migration

ALTER TABLE audit_log ADD COLUMN ref bigserial;
CREATE INDEX audit_log_ref_idx ON audit_log (ref);

-- Down Migration

ALTER TABLE audit_log DROP COLUMN ref;
