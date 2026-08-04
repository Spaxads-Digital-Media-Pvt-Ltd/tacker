-- Postback security codes (secure_code) — an extra S2S security layer (Everflow/Trackog parity).
-- A global per-network code plus an optional per-offer override. The tracking /postback endpoint
-- requires a matching `secure_code` param when one is configured (offer code overrides network code).

-- Up Migration
ALTER TABLE networks ADD COLUMN postback_security_code text;
ALTER TABLE offers ADD COLUMN security_code text;

-- Down Migration
ALTER TABLE offers DROP COLUMN IF EXISTS security_code;
ALTER TABLE networks DROP COLUMN IF EXISTS postback_security_code;
