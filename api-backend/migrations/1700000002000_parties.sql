-- Parties: advertisers and publishers (spec §4). Both are tenant-scoped by network_id.
-- `auth_user_id` links a portal login to its owning party row (owner isolation, spec §3A).

-- Up Migration
CREATE TABLE advertisers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id     uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  auth_user_id   uuid,                      -- Supabase Auth user for the advertiser portal login
  name           text NOT NULL,
  status         text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'pending', 'inactive')),
  contact_email  text,
  billing_terms  text,
  default_currency text NOT NULL DEFAULT 'USD',
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX advertisers_network_idx ON advertisers (network_id);
CREATE INDEX advertisers_network_status_idx ON advertisers (network_id, status);
CREATE UNIQUE INDEX advertisers_auth_user_id_key ON advertisers (auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE TRIGGER trg_advertisers_updated_at BEFORE UPDATE ON advertisers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE publishers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  auth_user_id    uuid,                     -- Supabase Auth user for the publisher portal login
  name            text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('active', 'pending', 'inactive')),
  contact_email   text,
  traffic_source  text,
  payout_terms    text,
  -- Attribution/dedup defaults (seconds); offers may override.
  default_attribution_window_s integer NOT NULL DEFAULT 2592000,  -- 30 days
  default_dedup_window_s       integer NOT NULL DEFAULT 86400,     -- 1 day
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX publishers_network_idx ON publishers (network_id);
CREATE INDEX publishers_network_status_idx ON publishers (network_id, status);
CREATE UNIQUE INDEX publishers_auth_user_id_key ON publishers (auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE TRIGGER trg_publishers_updated_at BEFORE UPDATE ON publishers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE IF EXISTS publishers;
DROP TABLE IF EXISTS advertisers;
