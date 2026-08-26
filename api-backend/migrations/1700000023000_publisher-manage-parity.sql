-- Manage Partners parity: the Manage Partners table (Everflow reference) has columns/filters this
-- app's publishers table had no backing for — Country, Partner Manager, Referred By, Payment
-- Method, Billing Frequency, Partner Tier, and an Account Executive (same "who owns this account"
-- concept the reference splits into two roles). Labels already exist via the tags/taggings system.

-- Up Migration
ALTER TABLE publishers ADD COLUMN country text;
ALTER TABLE publishers ADD COLUMN payment_method text;
ALTER TABLE publishers ADD COLUMN billing_frequency text;
ALTER TABLE publishers ADD COLUMN tier text;
ALTER TABLE publishers ADD COLUMN partner_manager_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE publishers ADD COLUMN account_executive_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE publishers ADD COLUMN referred_by_id uuid REFERENCES publishers(id) ON DELETE SET NULL;

CREATE INDEX publishers_partner_manager_idx ON publishers (network_id, partner_manager_id);
CREATE INDEX publishers_account_executive_idx ON publishers (network_id, account_executive_id);

-- Down Migration
DROP INDEX IF EXISTS publishers_account_executive_idx;
DROP INDEX IF EXISTS publishers_partner_manager_idx;
ALTER TABLE publishers DROP COLUMN IF EXISTS referred_by_id;
ALTER TABLE publishers DROP COLUMN IF EXISTS account_executive_id;
ALTER TABLE publishers DROP COLUMN IF EXISTS partner_manager_id;
ALTER TABLE publishers DROP COLUMN IF EXISTS tier;
ALTER TABLE publishers DROP COLUMN IF EXISTS billing_frequency;
ALTER TABLE publishers DROP COLUMN IF EXISTS payment_method;
ALTER TABLE publishers DROP COLUMN IF EXISTS country;
