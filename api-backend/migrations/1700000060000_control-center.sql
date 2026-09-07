-- Control Center — documents, segmentations, security lists, login events, user metadata.
-- Uses IF NOT EXISTS for tables that may already exist from prior DB-only migrations.

-- Up Migration

ALTER TABLE users ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS network_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  ref             bigserial,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  file_url        text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deleted')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS network_documents_network_idx ON network_documents (network_id, status, created_at DESC);
DROP TRIGGER IF EXISTS trg_network_documents_updated_at ON network_documents;
CREATE TRIGGER trg_network_documents_updated_at BEFORE UPDATE ON network_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS segmentation_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  ref             bigserial,
  name            text NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deleted')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS segmentation_categories_network_name ON segmentation_categories (network_id, lower(name));
CREATE INDEX IF NOT EXISTS segmentation_categories_network_idx ON segmentation_categories (network_id, status);
DROP TRIGGER IF EXISTS trg_segmentation_categories_updated_at ON segmentation_categories;
CREATE TRIGGER trg_segmentation_categories_updated_at BEFORE UPDATE ON segmentation_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS segmentation_channels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name            text NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deleted')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS segmentation_channels_network_name ON segmentation_channels (network_id, lower(name));
CREATE INDEX IF NOT EXISTS segmentation_channels_network_idx ON segmentation_channels (network_id, status);
DROP TRIGGER IF EXISTS trg_segmentation_channels_updated_at ON segmentation_channels;
CREATE TRIGGER trg_segmentation_channels_updated_at BEFORE UPDATE ON segmentation_channels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS business_units (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name            text NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deleted')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE business_units ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
CREATE UNIQUE INDEX IF NOT EXISTS business_units_network_name ON business_units (network_id, lower(name));
CREATE INDEX IF NOT EXISTS business_units_network_idx ON business_units (network_id, status);
DROP TRIGGER IF EXISTS trg_business_units_updated_at ON business_units;
CREATE TRIGGER trg_business_units_updated_at BEFORE UPDATE ON business_units
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS network_api_whitelist (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  ip_address      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS network_api_whitelist_network_ip ON network_api_whitelist (network_id, ip_address);

CREATE TABLE IF NOT EXISTS network_ip_blacklist (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  ip_from         text NOT NULL,
  ip_to           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS network_ip_blacklist_network_idx ON network_ip_blacklist (network_id);
DROP TRIGGER IF EXISTS trg_network_ip_blacklist_updated_at ON network_ip_blacklist;
CREATE TRIGGER trg_network_ip_blacklist_updated_at BEFORE UPDATE ON network_ip_blacklist
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS network_domain_managers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  first_name      text NOT NULL,
  last_name       text NOT NULL DEFAULT '',
  email           text NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deleted')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS network_domain_managers_network_idx ON network_domain_managers (network_id, status);
DROP TRIGGER IF EXISTS trg_network_domain_managers_updated_at ON network_domain_managers;
CREATE TRIGGER trg_network_domain_managers_updated_at BEFORE UPDATE ON network_domain_managers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS login_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid REFERENCES networks(id) ON DELETE SET NULL,
  user_id         uuid,
  employee_name   text,
  employee_email  text,
  ip              text,
  user_agent      text,
  country         text,
  city            text,
  platform        text,
  device_type     text,
  os_version      text,
  browser         text,
  existing_device boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_events_network_idx ON login_events (network_id, created_at DESC);

CREATE TABLE IF NOT EXISTS partner_referral_overrides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  ref             bigserial,
  publisher_id    uuid REFERENCES publishers(id) ON DELETE SET NULL,
  enabled         boolean NOT NULL DEFAULT true,
  commission_structure text NOT NULL DEFAULT '',
  fixed_amount_rate text NOT NULL DEFAULT '',
  minimum_threshold text NOT NULL DEFAULT '',
  duration        text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deleted')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_referral_overrides_network_idx ON partner_referral_overrides (network_id, status);
DROP TRIGGER IF EXISTS trg_partner_referral_overrides_updated_at ON partner_referral_overrides;
CREATE TRIGGER trg_partner_referral_overrides_updated_at BEFORE UPDATE ON partner_referral_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS terms_acceptances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  publisher_id    uuid REFERENCES publishers(id) ON DELETE SET NULL,
  partner_user    text NOT NULL DEFAULT '',
  user_agent      text,
  ip_address      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS terms_acceptances_network_idx ON terms_acceptances (network_id, created_at DESC);

-- Down Migration

DROP TABLE IF EXISTS terms_acceptances;
DROP TABLE IF EXISTS partner_referral_overrides;
DROP TABLE IF EXISTS login_events;
DROP TABLE IF EXISTS network_domain_managers;
DROP TABLE IF EXISTS network_ip_blacklist;
DROP TABLE IF EXISTS network_api_whitelist;
DROP TABLE IF EXISTS business_units;
DROP TABLE IF EXISTS segmentation_channels;
DROP TABLE IF EXISTS segmentation_categories;
DROP TABLE IF EXISTS network_documents;
ALTER TABLE users DROP COLUMN IF EXISTS metadata;
