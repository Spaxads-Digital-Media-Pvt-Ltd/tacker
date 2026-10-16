-- Rejected clicks (round 3): a click /click doesn't send to the offer — cap exceeded, partner blocked or
-- not approved, geo / targeting, IP list, traffic rules, fraud block, offer not active — is recorded
-- as an invalid click whose first fraud flag is the reason (lib/click-rejections.ts; D1 already did so
-- for inactive partners). Admin reports show them as invalid; partner / advertiser reports and the
-- automation (SmartSwitch, alert rules) leave them out — they never reached the offer. The click
-- rollups count them so those views can be served from the rollups too.

-- Up Migration

ALTER TABLE stats_clicks_15m ADD COLUMN rejected_clicks integer NOT NULL DEFAULT 0;

-- Re-roll the buckets that already hold rejected clicks (D1 recorded them before this column existed).
INSERT INTO stats_dirty_buckets (network_id, bucket)
SELECT DISTINCT network_id, date_bin('15 minutes', created_at, TIMESTAMPTZ '2000-01-01 00:00:00+00')
  FROM clicks
 WHERE fraud_flags && ARRAY['unknown_partner', 'partner_pending', 'partner_inactive']::text[]
ON CONFLICT DO NOTHING;

-- Down Migration

ALTER TABLE stats_clicks_15m DROP COLUMN IF EXISTS rejected_clicks;
