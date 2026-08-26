-- Offers › Templates: add a stable, human-friendly numeric ID matching the reference's own "ID"
-- column, same convention every other "Manage X" list in this app already uses.

-- Up Migration

ALTER TABLE offer_templates ADD COLUMN ref bigserial;
CREATE INDEX offer_templates_ref_idx ON offer_templates (ref);

-- Down Migration

ALTER TABLE offer_templates DROP COLUMN ref;
