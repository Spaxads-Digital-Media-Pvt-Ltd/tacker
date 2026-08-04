-- Fraud & alerts (spec §10). alerts surfaces anomalies for the AI ops layer (Phase 7). fraud_rules
-- holds per-network configurable thresholds. Conversions gain fraud scoring like clicks.

-- Up Migration
CREATE TABLE alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id   uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  type         text NOT NULL,               -- high_datacenter_traffic | cr_spike | fast_conversions | high_velocity | ...
  severity     text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  entity_type  text,                         -- publisher | offer | click | conversion
  entity_id    text,
  title        text NOT NULL,
  description  text,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alerts_network_status_idx ON alerts (network_id, status, created_at DESC);
CREATE INDEX alerts_entity_idx ON alerts (network_id, entity_type, entity_id);
-- Dedup: at most one OPEN alert per (network, type, entity) so a repeating scan doesn't spam.
CREATE UNIQUE INDEX alerts_open_dedup ON alerts (network_id, type, COALESCE(entity_id, ''))
  WHERE status = 'open';
CREATE TRIGGER trg_alerts_updated_at BEFORE UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE fraud_rules (
  network_id  uuid PRIMARY KEY REFERENCES networks(id) ON DELETE CASCADE,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_fraud_rules_updated_at BEFORE UPDATE ON fraud_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Conversions get their own fraud scoring (clicks already have it).
ALTER TABLE conversions ADD COLUMN fraud_score integer NOT NULL DEFAULT 0;
ALTER TABLE conversions ADD COLUMN fraud_flags text[] NOT NULL DEFAULT '{}';

-- Down Migration
ALTER TABLE conversions DROP COLUMN IF EXISTS fraud_flags;
ALTER TABLE conversions DROP COLUMN IF EXISTS fraud_score;
DROP TABLE IF EXISTS fraud_rules;
DROP TABLE IF EXISTS alerts;
