-- Impersonation is attributed to the admin who did it (audit F-10).
--
-- An admin impersonating a partner/advertiser acts through a short-lived impersonation session
-- (lib/auth/impersonation-token.ts). Every audit row written during it records that admin here
-- (dashboard users' auth_user_id, text like actor_id); NULL for everything else. Additive only.

-- Up Migration
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS impersonated_by text;
CREATE INDEX IF NOT EXISTS audit_log_impersonated_by_idx
  ON audit_log (network_id, impersonated_by, created_at DESC) WHERE impersonated_by IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS audit_log_impersonated_by_idx;
ALTER TABLE audit_log DROP COLUMN IF EXISTS impersonated_by;
