-- Everflow-parity Offers-flyout features with no prior backend concept: Offer Templates, Offer
-- Groups, Traffic Controls, network-wide Custom Settings, and SmartSwitch rules (+ auto-logged
-- history). All tenant-scoped by network_id (spec §3A). Association fields (offer/advertiser/
-- partner ids) are plain jsonb arrays of uuids rather than join tables — these are simple
-- multi-select tags on each row, not queried relationally elsewhere.

-- Up Migration

CREATE TABLE offer_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id   uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name         text NOT NULL,
  is_default   boolean NOT NULL DEFAULT false,
  offer_fields jsonb NOT NULL DEFAULT '[]',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX offer_templates_network_idx ON offer_templates (network_id);
CREATE TRIGGER trg_offer_templates_updated_at BEFORE UPDATE ON offer_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE offer_groups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id        uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name              text NOT NULL,
  advertiser_id     uuid REFERENCES advertisers(id) ON DELETE SET NULL,
  offer_ids         jsonb NOT NULL DEFAULT '[]',
  daily_payout_cap  numeric(14,4),
  daily_revenue_cap numeric(14,4),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX offer_groups_network_idx ON offer_groups (network_id);
CREATE TRIGGER trg_offer_groups_updated_at BEFORE UPDATE ON offer_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE traffic_controls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name            text NOT NULL,
  control_type    text NOT NULL DEFAULT 'blacklist' CHECK (control_type IN ('blacklist', 'whitelist')),
  offer_ids       jsonb NOT NULL DEFAULT '[]',
  advertiser_ids  jsonb NOT NULL DEFAULT '[]',
  partner_ids     jsonb NOT NULL DEFAULT '[]',
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX traffic_controls_network_idx ON traffic_controls (network_id);
CREATE TRIGGER trg_traffic_controls_updated_at BEFORE UPDATE ON traffic_controls
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Network-wide Custom Settings (Offers › Custom Settings) — a cross-offer view grouped by
-- category, distinct from each Offer's own per-country payout/revenue geo-rules.
CREATE TABLE offer_custom_settings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id         uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  category           text NOT NULL CHECK (category IN ('revenue_payout', 'caps', 'throttle_rates', 'landing_pages', 'creatives')),
  name               text NOT NULL,
  offer_id           uuid REFERENCES offers(id) ON DELETE CASCADE,
  partner_ids        jsonb NOT NULL DEFAULT '[]',
  description        text,
  public_description text,
  event              text,
  value              text,             -- generic value column (cap number / throttle rate / URL / creative name depending on category)
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX offer_custom_settings_network_idx ON offer_custom_settings (network_id, category);
CREATE TRIGGER trg_offer_custom_settings_updated_at BEFORE UPDATE ON offer_custom_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE smartswitch_rules (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id           uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  action               text NOT NULL DEFAULT 'notify' CHECK (action IN ('notify', 'block')),
  action_delay         text,
  variable             text,
  actionable_variables text,
  offer_ids            jsonb NOT NULL DEFAULT '[]',
  advertiser_ids       jsonb NOT NULL DEFAULT '[]',
  partner_ids          jsonb NOT NULL DEFAULT '[]',
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX smartswitch_rules_network_idx ON smartswitch_rules (network_id);
CREATE TRIGGER trg_smartswitch_rules_updated_at BEFORE UPDATE ON smartswitch_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auto-logged whenever a rule is created/updated/deleted — makes the SmartSwitch "History" sub-tab
-- genuinely real instead of a static shell.
CREATE TABLE smartswitch_history (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  rule_id    uuid,
  rule_name  text NOT NULL,
  change     text NOT NULL,
  employee   text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX smartswitch_history_network_idx ON smartswitch_history (network_id, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS smartswitch_history;
DROP TABLE IF EXISTS smartswitch_rules;
DROP TABLE IF EXISTS offer_custom_settings;
DROP TABLE IF EXISTS traffic_controls;
DROP TABLE IF EXISTS offer_groups;
DROP TABLE IF EXISTS offer_templates;
