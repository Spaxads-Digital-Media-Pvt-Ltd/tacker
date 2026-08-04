-- Short human-facing sequential IDs (Everflow/Spaxads "Offer ID 817", "Affiliate 433") alongside the
-- long unguessable UUID. bigserial auto-fills existing rows and auto-increments new ones.

-- Up Migration
ALTER TABLE offers ADD COLUMN ref bigserial;
ALTER TABLE publishers ADD COLUMN ref bigserial;
ALTER TABLE advertisers ADD COLUMN ref bigserial;
CREATE INDEX offers_ref_idx ON offers (ref);
CREATE INDEX publishers_ref_idx ON publishers (ref);
CREATE INDEX advertisers_ref_idx ON advertisers (ref);

-- Down Migration
ALTER TABLE advertisers DROP COLUMN IF EXISTS ref;
ALTER TABLE publishers DROP COLUMN IF EXISTS ref;
ALTER TABLE offers DROP COLUMN IF EXISTS ref;
