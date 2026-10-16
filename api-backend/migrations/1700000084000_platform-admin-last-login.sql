-- Super Admin › Team: when each platform admin last signed in (set by POST /platform/login).

-- Up Migration
ALTER TABLE platform_admins ADD COLUMN last_login_at timestamptz;

-- Down Migration
ALTER TABLE platform_admins DROP COLUMN IF EXISTS last_login_at;
