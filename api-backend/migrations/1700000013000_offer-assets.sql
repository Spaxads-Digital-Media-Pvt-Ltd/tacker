-- Wave 1 (feature depth): multi-goal offers + offer assets (creatives, coupons, deals) + generic
-- tags. Brings the offer model up to Trackier/Everflow parity. Money stays numeric(14,4) (spec §8);
-- everything tenant-scoped by network_id (spec §3A).

-- Up Migration

-- ── Multiple goals per offer ────────────────────────────────────────────────
-- An offer can convert on several events (e.g. "install", "signup", "purchase"), each with its own
-- payout/revenue/model and caps. event_name is what an inbound postback's `event` param matches
-- against; exactly one goal per offer is is_default (used when no event is supplied).
CREATE TABLE offer_goals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id     uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  offer_id       uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  name           text NOT NULL,
  event_name     text,                       -- inbound postback `event` this goal matches (null = default)
  payout_model   text NOT NULL DEFAULT 'CPA'
                 CHECK (payout_model IN ('CPA', 'CPL', 'CPC', 'CPI', 'RevShare')),
  payout         numeric(14,4) NOT NULL DEFAULT 0,
  revenue        numeric(14,4) NOT NULL DEFAULT 0,
  currency       text NOT NULL DEFAULT 'USD',
  daily_conversion_cap integer,
  total_conversion_cap integer,
  is_default     boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX offer_goals_offer_idx ON offer_goals (network_id, offer_id);
-- event_name unique per offer (case-insensitive) so postback matching is deterministic.
CREATE UNIQUE INDEX offer_goals_event_key ON offer_goals (offer_id, lower(event_name))
  WHERE event_name IS NOT NULL;
-- At most one default goal per offer.
CREATE UNIQUE INDEX offer_goals_one_default ON offer_goals (offer_id) WHERE is_default;
CREATE TRIGGER trg_offer_goals_updated_at BEFORE UPDATE ON offer_goals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Creatives (banners / links / html / email / video) ──────────────────────
CREATE TABLE offer_creatives (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id     uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  offer_id       uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  name           text NOT NULL,
  type           text NOT NULL DEFAULT 'image'
                 CHECK (type IN ('image', 'html', 'link', 'email', 'video')),
  url            text,                        -- asset URL (image/video/link)
  html           text,                        -- html/email snippet
  width          integer,
  height         integer,
  language       text,                        -- ISO language, optional
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX offer_creatives_offer_idx ON offer_creatives (network_id, offer_id);
CREATE TRIGGER trg_offer_creatives_updated_at BEFORE UPDATE ON offer_creatives
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Coupon codes (optionally assigned to a specific publisher) ───────────────
CREATE TABLE offer_coupons (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id     uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  offer_id       uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  publisher_id   uuid REFERENCES publishers(id) ON DELETE SET NULL,  -- null = available to all
  code           text NOT NULL,
  description    text,
  discount       text,                        -- freeform, e.g. "20% off" or "$10"
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'disabled')),
  starts_at      timestamptz,
  ends_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX offer_coupons_offer_idx ON offer_coupons (network_id, offer_id);
CREATE UNIQUE INDEX offer_coupons_code_key ON offer_coupons (offer_id, lower(code));
CREATE TRIGGER trg_offer_coupons_updated_at BEFORE UPDATE ON offer_coupons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Deals (special terms / promotions on an offer) ──────────────────────────
CREATE TABLE offer_deals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id     uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  offer_id       uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  name           text NOT NULL,
  description    text,
  deal_type      text NOT NULL DEFAULT 'payout_boost'
                 CHECK (deal_type IN ('payout_boost', 'flat_bonus', 'custom')),
  value          numeric(14,4),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'scheduled', 'ended')),
  starts_at      timestamptz,
  ends_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX offer_deals_offer_idx ON offer_deals (network_id, offer_id);
CREATE TRIGGER trg_offer_deals_updated_at BEFORE UPDATE ON offer_deals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Generic tags + polymorphic taggings (offers / publishers / advertisers) ──
CREATE TABLE tags (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id     uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name           text NOT NULL,
  color          text,                        -- optional UI hint
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tags_network_name_key ON tags (network_id, lower(name));

CREATE TABLE taggings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id     uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  tag_id         uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  entity_type    text NOT NULL CHECK (entity_type IN ('offer', 'publisher', 'advertiser')),
  entity_id      uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX taggings_key ON taggings (tag_id, entity_type, entity_id);
CREATE INDEX taggings_entity_idx ON taggings (network_id, entity_type, entity_id);

-- ── Conversions: attribute to a specific goal ───────────────────────────────
ALTER TABLE conversions ADD COLUMN goal_id uuid;
CREATE INDEX conversions_goal_idx ON conversions (network_id, goal_id);

-- Down Migration
ALTER TABLE conversions DROP COLUMN IF EXISTS goal_id;
DROP TABLE IF EXISTS taggings;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS offer_deals;
DROP TABLE IF EXISTS offer_coupons;
DROP TABLE IF EXISTS offer_creatives;
DROP TABLE IF EXISTS offer_goals;
