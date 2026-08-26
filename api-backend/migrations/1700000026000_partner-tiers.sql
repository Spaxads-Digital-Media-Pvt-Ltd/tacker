-- Up Migration

-- Partner Tiers (Partners › Tiers in the reference): groups of Partners sharing a payout margin
-- and offer visibility. margin_pct drives a derived Payout = Revenue * (1 - margin/100) preview
-- client-side (spec parity, not stored — the underlying revenue/payout numbers live on offers).
CREATE TABLE partner_tiers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id   uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name         text NOT NULL,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'deleted')),
  description  text,
  margin_pct   numeric(5,2) NOT NULL,
  is_default   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX partner_tiers_network_idx ON partner_tiers (network_id);
-- At most one default tier per network (mirrors the reference's single "New Partners"-style default).
CREATE UNIQUE INDEX partner_tiers_one_default_idx ON partner_tiers (network_id) WHERE is_default;
CREATE TRIGGER trg_partner_tiers_updated_at BEFORE UPDATE ON partner_tiers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE partner_tier_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id   uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  tier_id      uuid NOT NULL REFERENCES partner_tiers(id) ON DELETE CASCADE,
  publisher_id uuid NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX partner_tier_members_key ON partner_tier_members (tier_id, publisher_id);
CREATE INDEX partner_tier_members_publisher_idx ON partner_tier_members (network_id, publisher_id);

CREATE TABLE partner_tier_offers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id             uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  tier_id                uuid NOT NULL REFERENCES partner_tiers(id) ON DELETE CASCADE,
  offer_id               uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  apply_margin           boolean NOT NULL DEFAULT true,
  auto_approve_partners  boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX partner_tier_offers_key ON partner_tier_offers (tier_id, offer_id);
CREATE INDEX partner_tier_offers_offer_idx ON partner_tier_offers (network_id, offer_id);

-- Reuse the existing generic tags/taggings system for tier Labels (matches offers/publishers/advertisers).
ALTER TABLE taggings DROP CONSTRAINT taggings_entity_type_check;
ALTER TABLE taggings ADD CONSTRAINT taggings_entity_type_check
  CHECK (entity_type IN ('offer', 'publisher', 'advertiser', 'partner_tier'));

-- Down Migration

ALTER TABLE taggings DROP CONSTRAINT taggings_entity_type_check;
ALTER TABLE taggings ADD CONSTRAINT taggings_entity_type_check
  CHECK (entity_type IN ('offer', 'publisher', 'advertiser'));

DROP TABLE IF EXISTS partner_tier_offers;
DROP TABLE IF EXISTS partner_tier_members;
DROP TABLE IF EXISTS partner_tiers;
