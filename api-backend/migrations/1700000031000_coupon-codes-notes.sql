-- Up Migration

-- Manage Coupon Codes (Partners › Coupon Codes): adds the reference's "Internal Notes" field.
-- Everything else (code, publisher_id, offer_id, description, status, starts_at, ends_at) already
-- exists on offer_coupons from the per-offer Coupons tab this new top-level page shares data with.
ALTER TABLE offer_coupons ADD COLUMN notes text;

-- Down Migration

ALTER TABLE offer_coupons DROP COLUMN IF EXISTS notes;
