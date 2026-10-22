-- Network staff roles for account managers (Everflow / Affise style): an Affiliate Manager works with
-- the partners assigned to them (publishers.partner_manager_id), an Advertiser Manager with the
-- advertisers assigned to them (advertisers.account_manager_id / sales_manager_id). Each sees only
-- "My partners" / "My advertisers" (their own accounts' numbers, offers and recent conversions) and
-- may answer their partners' offer applications — nothing else in the dashboard (dashboard auth gate).

-- Up Migration

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'manager', 'finance', 'read_only', 'affiliate_manager', 'advertiser_manager'));

-- Down Migration

UPDATE users SET role = 'read_only' WHERE role IN ('affiliate_manager', 'advertiser_manager');
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'manager', 'finance', 'read_only'));
