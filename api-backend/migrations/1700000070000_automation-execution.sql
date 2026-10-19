-- Automation execution (audit F-17a): scheduled actions run at their time, alert rules are evaluated,
-- webhooks are delivered. Until now these tables were written by the dashboard and read by nothing.

-- Up Migration

-- Scheduled actions: what a cap_change sets ({capType, capValue}), and when/how the action ran.
-- 'failed' = it came due but couldn't be applied (the reason is in result.error).
ALTER TABLE offer_scheduled_actions ADD COLUMN params jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE offer_scheduled_actions ADD COLUMN executed_at timestamptz;
ALTER TABLE offer_scheduled_actions ADD COLUMN result jsonb;
ALTER TABLE offer_scheduled_actions DROP CONSTRAINT IF EXISTS offer_scheduled_actions_status_check;
ALTER TABLE offer_scheduled_actions ADD CONSTRAINT offer_scheduled_actions_status_check
  CHECK (status IN ('pending', 'executed', 'cancelled', 'failed'));
CREATE INDEX offer_scheduled_actions_due_idx ON offer_scheduled_actions (scheduled_time) WHERE status = 'pending';

-- Alert rules: which entities are currently firing (edge-triggered — a rule alerts when its condition
-- starts to hold, not on every evaluation while it keeps holding), plus the last run's outcome.
ALTER TABLE automation_alert_rules ADD COLUMN state jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE automation_alert_rules ADD COLUMN last_evaluated_at timestamptz;
ALTER TABLE automation_alert_rules ADD COLUMN last_fired_at timestamptz;
ALTER TABLE automation_alert_rules ADD COLUMN last_error text;

-- One row per webhook delivery (attempts, last status code / error).
CREATE TABLE automation_webhook_deliveries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id   uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  webhook_id   uuid NOT NULL REFERENCES automation_webhooks(id) ON DELETE CASCADE,
  event        text NOT NULL,
  payload      jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'blocked')),
  attempts     integer NOT NULL DEFAULT 0,
  status_code  integer,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automation_webhook_deliveries_hook_idx ON automation_webhook_deliveries (network_id, webhook_id, created_at DESC);
CREATE TRIGGER trg_automation_webhook_deliveries_updated_at BEFORE UPDATE ON automation_webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS automation_webhook_deliveries;
ALTER TABLE automation_alert_rules DROP COLUMN IF EXISTS last_error;
ALTER TABLE automation_alert_rules DROP COLUMN IF EXISTS last_fired_at;
ALTER TABLE automation_alert_rules DROP COLUMN IF EXISTS last_evaluated_at;
ALTER TABLE automation_alert_rules DROP COLUMN IF EXISTS state;
DROP INDEX IF EXISTS offer_scheduled_actions_due_idx;
ALTER TABLE offer_scheduled_actions DROP CONSTRAINT IF EXISTS offer_scheduled_actions_status_check;
-- A failed action never ran; the old status set has no 'failed'.
UPDATE offer_scheduled_actions SET status = 'cancelled' WHERE status = 'failed';
ALTER TABLE offer_scheduled_actions ADD CONSTRAINT offer_scheduled_actions_status_check
  CHECK (status IN ('pending', 'executed', 'cancelled'));
ALTER TABLE offer_scheduled_actions DROP COLUMN IF EXISTS result;
ALTER TABLE offer_scheduled_actions DROP COLUMN IF EXISTS executed_at;
ALTER TABLE offer_scheduled_actions DROP COLUMN IF EXISTS params;
