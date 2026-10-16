-- The platform's own email (Super Admin › Settings › Email): the platform team's SMTP (platform_settings
-- 'email', the password encrypted) sends what the platform says — a ticket was answered, a new invoice, an
-- overdue invoice, a suspension, a demo request, a task — through the same email queue as the networks'
-- emails. A platform email has no network_id (it never shows in a network's email log and never uses a
-- network's SMTP); `about_network_id` (no FK — the log outlives a purge) says which network it concerns.

-- Up Migration

ALTER TABLE email_outbox ALTER COLUMN network_id DROP NOT NULL;
ALTER TABLE email_outbox ADD COLUMN about_network_id uuid;
CREATE INDEX email_outbox_platform_idx ON email_outbox (created_at DESC) WHERE network_id IS NULL;

-- Down Migration

DROP INDEX IF EXISTS email_outbox_platform_idx;
DELETE FROM email_outbox WHERE network_id IS NULL;
ALTER TABLE email_outbox DROP COLUMN IF EXISTS about_network_id;
ALTER TABLE email_outbox ALTER COLUMN network_id SET NOT NULL;
