-- Offer Creatives, feature-depth v2 — matches the reference's real "Manage Creatives" (network-wide,
-- one creative can target several offers, stored as one row per offer): three more asset types
-- (archive/thumbnail/text), a Privacy toggle (Show/Hide to Partners), Email sub-fields (From/Subject),
-- a real ref, and a Deleted status (replacing "archived").

-- Up Migration

ALTER TABLE offer_creatives ADD COLUMN ref bigserial;
CREATE INDEX offer_creatives_ref_idx ON offer_creatives (ref);

ALTER TABLE offer_creatives DROP CONSTRAINT offer_creatives_type_check;
ALTER TABLE offer_creatives ADD CONSTRAINT offer_creatives_type_check
  CHECK (type IN ('image', 'html', 'link', 'email', 'video', 'archive', 'thumbnail', 'text'));

ALTER TABLE offer_creatives DROP CONSTRAINT offer_creatives_status_check;
UPDATE offer_creatives SET status = 'deleted' WHERE status = 'archived';
ALTER TABLE offer_creatives ADD CONSTRAINT offer_creatives_status_check
  CHECK (status IN ('active', 'paused', 'deleted'));

ALTER TABLE offer_creatives ADD COLUMN visible_to_partners boolean NOT NULL DEFAULT true;
ALTER TABLE offer_creatives ADD COLUMN email_from text;
ALTER TABLE offer_creatives ADD COLUMN email_subject text;

-- Down Migration

ALTER TABLE offer_creatives DROP COLUMN IF EXISTS email_subject;
ALTER TABLE offer_creatives DROP COLUMN IF EXISTS email_from;
ALTER TABLE offer_creatives DROP COLUMN IF EXISTS visible_to_partners;

ALTER TABLE offer_creatives DROP CONSTRAINT offer_creatives_status_check;
UPDATE offer_creatives SET status = 'archived' WHERE status = 'deleted';
ALTER TABLE offer_creatives ADD CONSTRAINT offer_creatives_status_check CHECK (status IN ('active', 'archived'));

ALTER TABLE offer_creatives DROP CONSTRAINT offer_creatives_type_check;
UPDATE offer_creatives SET type = 'image' WHERE type IN ('archive', 'thumbnail', 'text');
ALTER TABLE offer_creatives ADD CONSTRAINT offer_creatives_type_check CHECK (type IN ('image', 'html', 'link', 'email', 'video'));

ALTER TABLE offer_creatives DROP COLUMN IF EXISTS ref;
