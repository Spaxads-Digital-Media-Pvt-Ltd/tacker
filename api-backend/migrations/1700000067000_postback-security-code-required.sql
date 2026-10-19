-- Postback secure_code is required for every network (audit F-01).
--
-- /postback only verified secure_code when a network/offer had one configured, and nothing ever
-- generated one — so S2S postbacks were effectively unauthenticated. The tracking surface now
-- fails closed (no configured code -> postback rejected), so every network needs a code:
--   1. tracker_generate_secure_code(): the SQL twin of lib/security-code.ts generateSecureCode()
--      (same unambiguous base-56 alphabet, byte % 56, default length 12; pgcrypto randomness).
--   2. Backfill a code for every existing network that has none.
--   3. Default new rows to a generated code, so every insert path (platform-admin, seed scripts,
--      tests, raw SQL) gets one — not only the platform-admin create endpoint.
-- The column stays nullable: Settings > Security "Clear" still sets NULL, which now disables S2S
-- postbacks for that network (fail closed) instead of opening them to anyone.
--
-- Deploy note: existing S2S integrations must start sending &secure_code=<code> (Settings >
-- Security shows it). Postbacks without it are rejected with 403 once this ships.

-- Up Migration
CREATE OR REPLACE FUNCTION tracker_generate_secure_code(len integer DEFAULT 12)
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  bytes bytea := gen_random_bytes(len);
  code text := '';
BEGIN
  FOR i IN 0 .. len - 1 LOOP
    code := code || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  END LOOP;
  RETURN code;
END;
$$;

UPDATE networks
   SET postback_security_code = tracker_generate_secure_code()
 WHERE postback_security_code IS NULL;

ALTER TABLE networks ALTER COLUMN postback_security_code SET DEFAULT tracker_generate_secure_code();

-- Down Migration
ALTER TABLE networks ALTER COLUMN postback_security_code DROP DEFAULT;
DROP FUNCTION IF EXISTS tracker_generate_secure_code(integer);
