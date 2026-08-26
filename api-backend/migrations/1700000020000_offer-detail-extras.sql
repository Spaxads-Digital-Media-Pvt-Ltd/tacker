-- Offer Detail parity: Forwarding Rules, Scheduled Actions (new offer-nested collections, same
-- shape as offer_creatives/offer_coupons), a `level` on publisher_postbacks so the per-offer
-- Postbacks tab can group Conversion/Event/CPC, and a user_agent column on audit_log so the
-- History tab's "User Agent" is real captured data rather than a placeholder.

-- Up Migration
CREATE TABLE offer_forwarding_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id   uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  offer_id     uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  name         text NOT NULL,
  partner_ids  jsonb NOT NULL DEFAULT '[]',
  offer_urls   jsonb NOT NULL DEFAULT '[]',
  destination  text,
  countries    jsonb NOT NULL DEFAULT '[]',
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX offer_forwarding_rules_offer_idx ON offer_forwarding_rules (network_id, offer_id);
CREATE TRIGGER trg_offer_forwarding_rules_updated_at BEFORE UPDATE ON offer_forwarding_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE offer_scheduled_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  offer_id        uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  action_type     text NOT NULL DEFAULT 'pause' CHECK (action_type IN ('activate', 'pause', 'archive', 'cap_change')),
  partner_ids     jsonb NOT NULL DEFAULT '[]',
  event           text,
  scheduled_time  timestamptz,
  internal_notes  text,
  created_by      text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'cancelled')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX offer_scheduled_actions_offer_idx ON offer_scheduled_actions (network_id, offer_id);
CREATE TRIGGER trg_offer_scheduled_actions_updated_at BEFORE UPDATE ON offer_scheduled_actions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE publisher_postbacks ADD COLUMN level text NOT NULL DEFAULT 'conversion'
  CHECK (level IN ('conversion', 'event', 'cpc'));

ALTER TABLE audit_log ADD COLUMN user_agent text;

-- Down Migration
ALTER TABLE audit_log DROP COLUMN IF EXISTS user_agent;
ALTER TABLE publisher_postbacks DROP COLUMN IF EXISTS level;
DROP TABLE IF EXISTS offer_scheduled_actions;
DROP TABLE IF EXISTS offer_forwarding_rules;
