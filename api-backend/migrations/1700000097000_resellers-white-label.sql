-- Super Admin › Resellers and white-label.
--
-- * platform_resellers — agencies / partners who sell the platform to networks for a commission on what
--   those networks pay (Super Admin › Resellers). networks.reseller_id names the network's reseller.
-- * network_white_label — a network's own brand on a dashboard domain of its own: brand name, primary
--   colour, support link, "hide the platform's branding", and dashboard_domain (verified by a DNS TXT
--   record like custom tracking domains). The platform grants it (enabled); the network then sets it up.
--   The SPA asks GET /api/public/brand?host= on that domain and wears the network's brand.
-- * The 'resellers' permission section for the built-in roles.

-- Up Migration

CREATE TABLE platform_resellers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  contact_name   text,
  contact_email  text,
  commission_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (commission_pct >= 0 AND commission_pct <= 100),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_platform_resellers_updated_at BEFORE UPDATE ON platform_resellers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE networks ADD COLUMN reseller_id uuid REFERENCES platform_resellers(id) ON DELETE SET NULL;
CREATE INDEX networks_reseller_idx ON networks (reseller_id) WHERE reseller_id IS NOT NULL;

CREATE TABLE network_white_label (
  network_id             uuid PRIMARY KEY REFERENCES networks(id) ON DELETE CASCADE,
  enabled                boolean NOT NULL DEFAULT false,
  brand_name             text,
  primary_color          text CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9a-fA-F]{6}$'),
  support_url            text,
  hide_platform_branding boolean NOT NULL DEFAULT false,
  dashboard_domain       text,
  domain_token           text,
  domain_verified_at     timestamptz,
  domain_checked_at      timestamptz,
  domain_check_result    text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX network_white_label_domain_key ON network_white_label (lower(dashboard_domain)) WHERE dashboard_domain IS NOT NULL;
CREATE TRIGGER trg_network_white_label_updated_at BEFORE UPDATE ON network_white_label FOR EACH ROW EXECUTE FUNCTION set_updated_at();

UPDATE platform_roles SET permissions = permissions || '{"resellers": "full"}'::jsonb WHERE key IN ('owner', 'admin');
UPDATE platform_roles SET permissions = permissions || '{"resellers": "read"}'::jsonb WHERE key IN ('finance', 'sales', 'read_only');
UPDATE platform_roles SET permissions = permissions || '{"resellers": "none"}'::jsonb WHERE key IN ('account_manager', 'support', 'trust_safety');

-- Down Migration

UPDATE platform_roles SET permissions = permissions - 'resellers';
DROP TABLE IF EXISTS network_white_label;
DROP INDEX IF EXISTS networks_reseller_idx;
ALTER TABLE networks DROP COLUMN IF EXISTS reseller_id;
DROP TABLE IF EXISTS platform_resellers;
