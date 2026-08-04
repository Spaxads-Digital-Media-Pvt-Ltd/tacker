-- Audit log (spec §4, §12): every mutating admin action (who, what, when, before/after).

-- Up Migration
CREATE TABLE audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id   uuid REFERENCES networks(id) ON DELETE SET NULL,  -- null for platform-level actions
  actor_type   text NOT NULL CHECK (actor_type IN ('user', 'platform_admin', 'api_key', 'system')),
  actor_id     text,                          -- user_id / platform_admin_id / api_key_id
  action       text NOT NULL,                 -- e.g. 'advertiser.create', 'offer.update'
  entity_type  text,                          -- e.g. 'advertiser'
  entity_id    text,
  before       jsonb,
  after        jsonb,
  ip           inet,
  geo_country  text,                          -- geo-stamped admin sessions (§7)
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_network_idx ON audit_log (network_id, created_at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (network_id, entity_type, entity_id);
CREATE INDEX audit_log_actor_idx ON audit_log (network_id, actor_type, actor_id);

-- Down Migration
DROP TABLE IF EXISTS audit_log;
