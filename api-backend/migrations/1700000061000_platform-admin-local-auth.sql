-- Platform-admin local auth (spec §3C security fix A-1).
--
-- Replaces Supabase Auth for platform-admin accounts with a self-contained HS256 JWT flow:
-- - Adds password_hash (bcrypt via crypto.scrypt) and auth_provider columns
-- - Drops the Supabase Auth linkage (auth_user_id + its unique index)
-- - pa_sub in the new JWT carries platform_admins.id (not auth_user_id)

-- Up Migration
ALTER TABLE platform_admins
 ADD COLUMN IF NOT EXISTS password_hash text,
 ADD COLUMN IF NOT EXISTS auth_provider text NOT NULL DEFAULT 'local';

UPDATE platform_admins SET auth_provider = 'supabase' WHERE auth_user_id IS NOT NULL;

ALTER TABLE platform_admins ALTER COLUMN auth_user_id DROP NOT NULL;
DROP INDEX IF EXISTS platform_admins_auth_user_id_key;

ALTER TABLE platform_admins
 ADD CONSTRAINT platform_admins_password_local CHECK (
 (auth_provider = 'supabase' AND password_hash IS NULL)
 OR (auth_provider = 'local' AND password_hash IS NOT NULL)
 );

-- Down Migration
ALTER TABLE platform_admins DROP CONSTRAINT IF EXISTS platform_admins_password_local;
ALTER TABLE platform_admins ALTER COLUMN auth_user_id SET NOT NULL;
CREATE UNIQUE INDEX platform_admins_auth_user_id_key ON platform_admins (auth_user_id) WHERE auth_user_id IS NOT NULL;
ALTER TABLE platform_admins DROP COLUMN IF EXISTS password_hash;
ALTER TABLE platform_admins DROP COLUMN IF EXISTS auth_provider;
