-- Offer Custom Settings, feature-depth v2 — matches the reference's real 5-tab "Manage Custom
-- Settings" wizards (Revenue & Payout / Caps / Throttle Rates / Landing Pages / Creatives), each
-- with its own real field set rather than the generic name/event/value columns v1 shared across all
-- five. offer_id becomes required (every category scopes to one offer, incl. Creatives which fans
-- out one row per selected offer, same pattern as the top-level /api/creatives router). The old
-- generic event/value columns are dropped in favor of category-specific columns.

-- Up Migration

ALTER TABLE offer_custom_settings ADD COLUMN ref bigserial;
CREATE INDEX offer_custom_settings_ref_idx ON offer_custom_settings (ref);

ALTER TABLE offer_custom_settings DROP CONSTRAINT offer_custom_settings_status_check;
UPDATE offer_custom_settings SET status = 'inactive' WHERE status = 'paused';
ALTER TABLE offer_custom_settings ADD CONSTRAINT offer_custom_settings_status_check CHECK (status IN ('active', 'inactive', 'deleted'));

-- Every category is scoped to one offer (matches the reference's "Offer Conditions" section on
-- Revenue & Payout, and the plain "Offer *" select on Caps/Throttle Rates/Landing Pages/Creatives).
DELETE FROM offer_custom_settings WHERE offer_id IS NULL;
ALTER TABLE offer_custom_settings ALTER COLUMN offer_id SET NOT NULL;

-- Caps has no Name field in the reference (its Add page is just Offer + Partner + the cap matrix).
ALTER TABLE offer_custom_settings ALTER COLUMN name DROP NOT NULL;

-- Single-partner scope (Caps, Throttle Rates) vs. dual-list partner scope (Revenue & Payout,
-- Landing Pages, Creatives) — the reference uses one or the other depending on category.
ALTER TABLE offer_custom_settings ADD COLUMN partner_id uuid REFERENCES publishers(id) ON DELETE CASCADE;
ALTER TABLE offer_custom_settings ADD COLUMN apply_all_partners boolean NOT NULL DEFAULT false;
UPDATE offer_custom_settings SET apply_all_partners = true WHERE jsonb_array_length(partner_ids) = 0;

ALTER TABLE offer_custom_settings ADD COLUMN effective_from timestamptz;
ALTER TABLE offer_custom_settings ADD COLUMN effective_to timestamptz;

-- Reduced, honest Targeting subset — reuses exactly the fields the tracking surface already
-- evaluates for Traffic Controls (country/device/os/browser), not the reference's full
-- geo/ISP/carrier tree, which this app has no real lookup data for.
ALTER TABLE offer_custom_settings ADD COLUMN targeting jsonb NOT NULL DEFAULT '{}';

-- Revenue & Payout
ALTER TABLE offer_custom_settings ADD COLUMN apply_custom_payout boolean NOT NULL DEFAULT false;
ALTER TABLE offer_custom_settings ADD COLUMN payout_model text
  CHECK (payout_model IN ('CPA', 'CPA_PPP', 'CPA_CPS', 'CPA_CPS_PPP', 'CPC', 'CPM', 'CPS', 'CPS_PPP', 'PRV', 'PRV_PPP'));
ALTER TABLE offer_custom_settings ADD COLUMN payout_value numeric(14,4);
ALTER TABLE offer_custom_settings ADD COLUMN apply_custom_revenue boolean NOT NULL DEFAULT false;
ALTER TABLE offer_custom_settings ADD COLUMN revenue_model text
  CHECK (revenue_model IN ('CPA', 'CPA_PPP', 'CPA_CPS', 'CPA_CPS_PPP', 'CPC', 'CPM', 'CPS', 'CPS_PPP', 'PRV', 'PRV_PPP'));
ALTER TABLE offer_custom_settings ADD COLUMN revenue_value numeric(14,4);
ALTER TABLE offer_custom_settings ADD COLUMN goal_id uuid REFERENCES offer_goals(id) ON DELETE SET NULL;
ALTER TABLE offer_custom_settings ADD COLUMN fire_partner_postback boolean NOT NULL DEFAULT true;

-- Caps — same {clicks,conversions,payout,revenue}×{daily,weekly,monthly,global} shape as Offer
-- Groups' caps, reused verbatim so the existing CapsCard/cap-matrix UI works unmodified.
ALTER TABLE offer_custom_settings ADD COLUMN caps jsonb NOT NULL DEFAULT '{}';

-- Throttle Rates
ALTER TABLE offer_custom_settings ADD COLUMN conversion_status text CHECK (conversion_status IN ('rejected', 'pending'));
ALTER TABLE offer_custom_settings ADD COLUMN throttle_rate numeric(5,2);
ALTER TABLE offer_custom_settings ADD COLUMN set_parameter_goal boolean NOT NULL DEFAULT false;

-- Landing Pages
ALTER TABLE offer_custom_settings ADD COLUMN landing_page_url text;

-- Creatives — mirrors offer_creatives' shape (this table fans out one row per offer on create,
-- same as the top-level /api/creatives router, plus partner scoping the global feature lacks).
ALTER TABLE offer_custom_settings ADD COLUMN creative_type text
  CHECK (creative_type IN ('archive', 'email', 'html', 'image', 'link', 'text', 'thumbnail', 'video'));
ALTER TABLE offer_custom_settings ADD COLUMN creative_url text;
ALTER TABLE offer_custom_settings ADD COLUMN creative_thumbnail_url text;
ALTER TABLE offer_custom_settings ADD COLUMN email_from text;
ALTER TABLE offer_custom_settings ADD COLUMN email_subject text;

ALTER TABLE offer_custom_settings DROP COLUMN event;
ALTER TABLE offer_custom_settings DROP COLUMN value;

-- Down Migration

ALTER TABLE offer_custom_settings ADD COLUMN event text;
ALTER TABLE offer_custom_settings ADD COLUMN value text;

UPDATE offer_custom_settings SET name = 'Untitled' WHERE name IS NULL;
ALTER TABLE offer_custom_settings ALTER COLUMN name SET NOT NULL;

ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS email_subject;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS email_from;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS creative_thumbnail_url;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS creative_url;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS creative_type;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS landing_page_url;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS set_parameter_goal;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS throttle_rate;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS conversion_status;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS caps;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS fire_partner_postback;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS goal_id;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS revenue_value;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS revenue_model;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS apply_custom_revenue;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS payout_value;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS payout_model;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS apply_custom_payout;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS targeting;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS effective_to;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS effective_from;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS apply_all_partners;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS partner_id;

ALTER TABLE offer_custom_settings ALTER COLUMN offer_id DROP NOT NULL;

ALTER TABLE offer_custom_settings DROP CONSTRAINT offer_custom_settings_status_check;
UPDATE offer_custom_settings SET status = 'paused' WHERE status = 'inactive';
ALTER TABLE offer_custom_settings ADD CONSTRAINT offer_custom_settings_status_check CHECK (status IN ('active', 'paused'));

DROP INDEX IF EXISTS offer_custom_settings_ref_idx;
ALTER TABLE offer_custom_settings DROP COLUMN IF EXISTS ref;
