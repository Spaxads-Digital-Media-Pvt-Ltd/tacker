-- Automation › Webhooks — outbound webhook endpoints (CRUD only; delivery worker not yet implemented).

-- Up Migration

CREATE TABLE automation_webhooks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name            text NOT NULL,
  events          text NOT NULL DEFAULT '',
  http_method     text NOT NULL DEFAULT 'POST' CHECK (http_method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  url             text NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automation_webhooks_network_idx ON automation_webhooks (network_id, status, created_at DESC);
CREATE TRIGGER trg_automation_webhooks_updated_at BEFORE UPDATE ON automation_webhooks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS automation_webhooks;
