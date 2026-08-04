-- Public REST API keys (spec §8A). Three audiences, each key bound to ONE owner within ONE
-- network. Only the HASH of the secret is stored — the full key is shown exactly once at creation.

-- Up Migration
CREATE TABLE api_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  audience        text NOT NULL CHECK (audience IN ('advertiser', 'publisher', 'network')),
  owner_id        uuid NOT NULL,             -- advertiser_id / publisher_id / user_id the key acts as
  key_prefix      text NOT NULL,             -- public, shown in UI (e.g. adv_live_a1b2c3d4)
  key_hash        text NOT NULL,             -- sha256 of the full secret (store hash only)
  name            text,
  scopes          text[] NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  rate_limit_tier text NOT NULL DEFAULT 'default',
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  expires_at      timestamptz,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX api_keys_key_hash_key ON api_keys (key_hash);
CREATE INDEX api_keys_owner_idx ON api_keys (network_id, audience, owner_id);
CREATE INDEX api_keys_prefix_idx ON api_keys (key_prefix);

-- Down Migration
DROP TABLE IF EXISTS api_keys;
