-- Customer Value › Custom Data Points: add a stable, human-friendly numeric ID (`ref`), matching
-- the same convention every other "Manage X" list in this app uses (advertiser_tiered_commissions,
-- customer_value_rules, etc.) for its real ID column.

-- Up Migration

ALTER TABLE customer_data_points ADD COLUMN ref bigserial;
CREATE INDEX customer_data_points_ref_idx ON customer_data_points (ref);

-- Down Migration

ALTER TABLE customer_data_points DROP COLUMN ref;
