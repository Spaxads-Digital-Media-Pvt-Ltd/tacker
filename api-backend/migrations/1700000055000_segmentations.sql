-- Control Center › Segmentation Options — matches the reference's real 4-tab structure (verified
-- live at /controls/segmentations): Categories and Channels are each their own real network-scoped
-- catalog (previously derived from free-text Offer.category / Publisher.traffic_source with no
-- backing table); Business Unit is a brand-new bare-bones catalog; Labels already had a real
-- backend (tags/taggings) — this just widens it to the two entity types the reference's own Labels
-- list shows usage counts for (Smart Links, Offer Groups) that weren't wired up yet.

-- Up Migration

CREATE TABLE offer_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref        bigserial,
  network_id uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name       text NOT NULL,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX offer_categories_name_key ON offer_categories (network_id, lower(name));
CREATE INDEX offer_categories_network_idx ON offer_categories (network_id);
CREATE TRIGGER trg_offer_categories_updated_at BEFORE UPDATE ON offer_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE partner_channels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref        bigserial,
  network_id uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name       text NOT NULL,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX partner_channels_name_key ON partner_channels (network_id, lower(name));
CREATE INDEX partner_channels_network_idx ON partner_channels (network_id);
CREATE TRIGGER trg_partner_channels_updated_at BEFORE UPDATE ON partner_channels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Publishers keep their existing free-text traffic_source (unrelated feature — Partners › Traffic
-- Sources tracking-link presets); this is a separate, additional real relation so a Partner can be
-- assigned one Channel from the new catalog, matching the reference's "Assign tags to identify
-- types of traffic sources at the Partner Level" description.
ALTER TABLE publishers ADD COLUMN channel_id uuid REFERENCES partner_channels(id) ON DELETE SET NULL;
CREATE INDEX publishers_channel_idx ON publishers (channel_id);

CREATE TABLE business_units (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref        bigserial,
  network_id uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX business_units_name_key ON business_units (network_id, lower(name));
CREATE INDEX business_units_network_idx ON business_units (network_id);
CREATE TRIGGER trg_business_units_updated_at BEFORE UPDATE ON business_units
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE taggings DROP CONSTRAINT taggings_entity_type_check;
ALTER TABLE taggings ADD CONSTRAINT taggings_entity_type_check
  CHECK (entity_type IN ('offer', 'publisher', 'advertiser', 'partner_tier', 'smart_link', 'offer_group'));

-- Down Migration

ALTER TABLE taggings DROP CONSTRAINT taggings_entity_type_check;
ALTER TABLE taggings ADD CONSTRAINT taggings_entity_type_check
  CHECK (entity_type IN ('offer', 'publisher', 'advertiser', 'partner_tier'));

DROP TABLE IF EXISTS business_units;

DROP INDEX IF EXISTS publishers_channel_idx;
ALTER TABLE publishers DROP COLUMN IF EXISTS channel_id;

DROP TABLE IF EXISTS partner_channels;
DROP TABLE IF EXISTS offer_categories;
