-- Tracking domains (spec §3D, §4). Tenant resolution keys off `host`. NEVER resolve a tenant
-- from an unverified/inactive host — the hot path checks verification_state + status.

-- Up Migration
CREATE TABLE tracking_domains (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id         uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  host               text NOT NULL,          -- FQDN, e.g. acme.ourtracking.com or track.acme.com
  mode               text NOT NULL CHECK (mode IN ('subdomain', 'custom')),
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'active', 'disabled')),
  -- Custom domains require DNS/CNAME verification before activation (§3D).
  verification_state text NOT NULL DEFAULT 'unverified'
                     CHECK (verification_state IN ('unverified', 'pending', 'verified', 'failed')),
  verification_token text,
  ssl_status         text NOT NULL DEFAULT 'none'
                     CHECK (ssl_status IN ('none', 'pending', 'issued', 'error')),
  is_primary         boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- Host is globally unique (it maps 1:1 to a tenant on inbound traffic).
CREATE UNIQUE INDEX tracking_domains_host_key ON tracking_domains (lower(host));
CREATE INDEX tracking_domains_network_idx ON tracking_domains (network_id);
-- At most one primary per network.
CREATE UNIQUE INDEX tracking_domains_one_primary ON tracking_domains (network_id) WHERE is_primary;
CREATE TRIGGER trg_tracking_domains_updated_at BEFORE UPDATE ON tracking_domains
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE IF EXISTS tracking_domains;
