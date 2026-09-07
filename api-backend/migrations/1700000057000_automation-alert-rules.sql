-- Automation › Alerts — user-defined alert rules (conditions + in-app/email notify prefs).
-- Rules are stored and editable; firing/notifying is a separate worker (not yet implemented).

-- Up Migration

CREATE TABLE automation_alert_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  ref             bigserial,
  name            text NOT NULL,
  conditions      text NOT NULL,
  notify_in_app   boolean NOT NULL DEFAULT true,
  notify_email    boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automation_alert_rules_network_idx ON automation_alert_rules (network_id, status, created_at DESC);
CREATE TRIGGER trg_automation_alert_rules_updated_at BEFORE UPDATE ON automation_alert_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS automation_alert_rules;
