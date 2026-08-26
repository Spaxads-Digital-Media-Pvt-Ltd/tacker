-- Up Migration

-- Advertisers › Manage parity pass: adds the columns the reference's "Manage Advertisers" list,
-- Filters flyout and Add/Edit forms need (Account Manager, Sales Manager, Billing Frequency,
-- Verification token). Labels already work via the existing generic tags/taggings system.
ALTER TABLE advertisers ADD COLUMN account_manager_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE advertisers ADD COLUMN sales_manager_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE advertisers ADD COLUMN billing_frequency text;
ALTER TABLE advertisers ADD COLUMN verification_token text;

-- Down Migration

ALTER TABLE advertisers DROP COLUMN IF EXISTS verification_token;
ALTER TABLE advertisers DROP COLUMN IF EXISTS billing_frequency;
ALTER TABLE advertisers DROP COLUMN IF EXISTS sales_manager_id;
ALTER TABLE advertisers DROP COLUMN IF EXISTS account_manager_id;
