-- Fidelity pass against the live reference's real "Manage Payout & Revenue Rules" list/filters:
--   - Apply Rule To targets Advertisers AND Offers independently (both filterable in Table
--     Filters), not just Offers.
--   - Custom Payout and Custom Revenue are two independent optional overrides (separate list
--     columns in the reference), not a single Fixed/Revenue-Share choice.

-- Up Migration

ALTER TABLE customer_value_rules ADD COLUMN apply_advertisers_mode text NOT NULL DEFAULT 'all'
  CHECK (apply_advertisers_mode IN ('all', 'specific'));
ALTER TABLE customer_value_rules ADD COLUMN apply_advertiser_ids uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE customer_value_rules ADD COLUMN revenue_value numeric(14,4);
ALTER TABLE customer_value_rules ALTER COLUMN payout_value DROP NOT NULL;
ALTER TABLE customer_value_rules DROP COLUMN payout_type;

-- Down Migration

ALTER TABLE customer_value_rules ADD COLUMN payout_type text NOT NULL DEFAULT 'fixed'
  CHECK (payout_type IN ('fixed', 'revenue_share'));
ALTER TABLE customer_value_rules ALTER COLUMN payout_value SET NOT NULL;
ALTER TABLE customer_value_rules DROP COLUMN revenue_value;
ALTER TABLE customer_value_rules DROP COLUMN apply_advertiser_ids;
ALTER TABLE customer_value_rules DROP COLUMN apply_advertisers_mode;
