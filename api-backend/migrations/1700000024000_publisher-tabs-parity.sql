-- Manage Partners tab parity (Existing/Pending/Unverified each show different reference columns):
-- Pending/Unverified need User Name (the actual contact person, distinct from the partner/company
-- Name), Tax ID/VAT/SSN; Pending also needs Notes. Existing needs a Website field. None of these
-- existed on publishers at all.

-- Up Migration
ALTER TABLE publishers ADD COLUMN contact_name text;
ALTER TABLE publishers ADD COLUMN tax_id text;
ALTER TABLE publishers ADD COLUMN website text;
ALTER TABLE publishers ADD COLUMN notes text;

-- Down Migration
ALTER TABLE publishers DROP COLUMN IF EXISTS notes;
ALTER TABLE publishers DROP COLUMN IF EXISTS website;
ALTER TABLE publishers DROP COLUMN IF EXISTS tax_id;
ALTER TABLE publishers DROP COLUMN IF EXISTS contact_name;
