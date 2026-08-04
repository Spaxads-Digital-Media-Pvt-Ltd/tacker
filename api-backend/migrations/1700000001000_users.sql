-- Operator-side users (spec §4). Portal logins (publisher/advertiser) are represented by the
-- `publishers`/`advertisers` rows they own; their auth identity carries owner_id in the JWT.
-- `auth_user_id` links to the Supabase Auth user (sub claim).

-- Up Migration
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id    uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  auth_user_id  uuid,                       -- Supabase Auth user id (sub); nullable pre-invite
  email         text NOT NULL,
  name          text,
  role          text NOT NULL DEFAULT 'read_only'
                CHECK (role IN ('admin', 'manager', 'finance', 'read_only')),
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'invited', 'disabled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Email unique per network (same email may exist in different tenants).
CREATE UNIQUE INDEX users_network_email_key ON users (network_id, lower(email));
CREATE UNIQUE INDEX users_auth_user_id_key ON users (auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE INDEX users_network_idx ON users (network_id);

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE IF EXISTS users;
