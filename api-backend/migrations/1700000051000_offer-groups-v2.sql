-- Offer Groups, feature-depth v2 — matches the reference's real "Add Offer Group" wizard: a
-- currency, Labels/Notes, an "Enable Caps" toggle guarding a Click/Conversion/Payout/Revenue ×
-- Daily/Weekly/Monthly/Global cap matrix (replacing the old flat daily_payout_cap/daily_revenue_cap
-- pair), plus a Deleted status. `daily_payout_cap`/`daily_revenue_cap` are superseded and dropped.

-- Up Migration

ALTER TABLE offer_groups ADD COLUMN ref bigserial;
CREATE INDEX offer_groups_ref_idx ON offer_groups (ref);

ALTER TABLE offer_groups DROP CONSTRAINT offer_groups_status_check;
ALTER TABLE offer_groups ADD CONSTRAINT offer_groups_status_check CHECK (status IN ('active', 'paused', 'deleted'));

ALTER TABLE offer_groups ADD COLUMN currency text NOT NULL DEFAULT 'USD';
ALTER TABLE offer_groups ADD COLUMN labels text;
ALTER TABLE offer_groups ADD COLUMN notes text;
ALTER TABLE offer_groups ADD COLUMN caps_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE offer_groups ADD COLUMN caps jsonb NOT NULL DEFAULT '{}';

ALTER TABLE offer_groups DROP COLUMN daily_payout_cap;
ALTER TABLE offer_groups DROP COLUMN daily_revenue_cap;

-- Down Migration

ALTER TABLE offer_groups ADD COLUMN daily_revenue_cap numeric(14,4);
ALTER TABLE offer_groups ADD COLUMN daily_payout_cap numeric(14,4);

ALTER TABLE offer_groups DROP COLUMN IF EXISTS caps;
ALTER TABLE offer_groups DROP COLUMN IF EXISTS caps_enabled;
ALTER TABLE offer_groups DROP COLUMN IF EXISTS notes;
ALTER TABLE offer_groups DROP COLUMN IF EXISTS labels;
ALTER TABLE offer_groups DROP COLUMN IF EXISTS currency;

ALTER TABLE offer_groups DROP CONSTRAINT offer_groups_status_check;
ALTER TABLE offer_groups ADD CONSTRAINT offer_groups_status_check CHECK (status IN ('active', 'paused'));

ALTER TABLE offer_groups DROP COLUMN IF EXISTS ref;
