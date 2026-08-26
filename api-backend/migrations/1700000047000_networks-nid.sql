-- Control Center › Platform Configurations › General: add a stable, human-friendly numeric ID
-- ("NID" in the reference's own real UI) to networks, matching the same convention every other
-- real "Manage X" list/detail in this app already uses for its ID column.

-- Up Migration

ALTER TABLE networks ADD COLUMN ref bigserial;
CREATE INDEX networks_ref_idx ON networks (ref);

-- Down Migration

ALTER TABLE networks DROP COLUMN ref;
