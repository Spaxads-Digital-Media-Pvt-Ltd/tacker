-- Two-factor sign-in for the platform team (Super Admin): an authenticator app's 6-digit code after the
-- password. The secret is stored encrypted (secret-box); while being set up it waits in totp_pending_secret.
-- totp_last_step stops a code being used twice; recovery codes are kept only as SHA-256 hashes (one use each).
-- platform_settings 'security' { requireTwoFactor } makes it mandatory for every member.

-- Up Migration

ALTER TABLE platform_admins
  ADD COLUMN totp_secret text,
  ADD COLUMN totp_pending_secret text,
  ADD COLUMN totp_enabled_at timestamptz,
  ADD COLUMN totp_last_step bigint,
  ADD COLUMN recovery_code_hashes text[] NOT NULL DEFAULT '{}';

-- Down Migration

ALTER TABLE platform_admins
  DROP COLUMN IF EXISTS recovery_code_hashes,
  DROP COLUMN IF EXISTS totp_last_step,
  DROP COLUMN IF EXISTS totp_enabled_at,
  DROP COLUMN IF EXISTS totp_pending_secret,
  DROP COLUMN IF EXISTS totp_secret;
