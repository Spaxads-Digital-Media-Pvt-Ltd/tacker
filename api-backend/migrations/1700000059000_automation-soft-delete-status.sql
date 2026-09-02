-- Allow soft-delete status on automation alert rules and webhooks (Deleted filter).

-- Up Migration

ALTER TABLE automation_alert_rules DROP CONSTRAINT IF EXISTS automation_alert_rules_status_check;
ALTER TABLE automation_alert_rules ADD CONSTRAINT automation_alert_rules_status_check
  CHECK (status IN ('active', 'inactive', 'deleted'));

ALTER TABLE automation_webhooks DROP CONSTRAINT IF EXISTS automation_webhooks_status_check;
ALTER TABLE automation_webhooks ADD CONSTRAINT automation_webhooks_status_check
  CHECK (status IN ('active', 'inactive', 'deleted'));

-- Down Migration

ALTER TABLE automation_webhooks DROP CONSTRAINT IF EXISTS automation_webhooks_status_check;
ALTER TABLE automation_webhooks ADD CONSTRAINT automation_webhooks_status_check
  CHECK (status IN ('active', 'inactive'));

ALTER TABLE automation_alert_rules DROP CONSTRAINT IF EXISTS automation_alert_rules_status_check;
ALTER TABLE automation_alert_rules ADD CONSTRAINT automation_alert_rules_status_check
  CHECK (status IN ('active', 'inactive'));
