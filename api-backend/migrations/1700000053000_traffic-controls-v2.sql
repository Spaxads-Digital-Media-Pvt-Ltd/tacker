-- Traffic Controls, feature-depth v2 — matches the reference's real "Add Traffic Control" wizard:
-- a real Active/Inactive status (renamed from active/paused), an effective date range ("Always On"
-- vs "Set Specific Period"), an explicit offer scope (All / specific Offers / specific Advertisers —
-- offer_ids/advertiser_ids are now mutually exclusive by scope, not "both empty = all"), a partner
-- scope, and a real Control (Action + Variables + Comparison Method + Values) rule the tracking
-- surface actually enforces at /click.

-- Up Migration

ALTER TABLE traffic_controls ADD COLUMN ref bigserial;
CREATE INDEX traffic_controls_ref_idx ON traffic_controls (ref);

ALTER TABLE traffic_controls DROP CONSTRAINT traffic_controls_status_check;
UPDATE traffic_controls SET status = 'inactive' WHERE status = 'paused';
ALTER TABLE traffic_controls ADD CONSTRAINT traffic_controls_status_check CHECK (status IN ('active', 'inactive', 'deleted'));

ALTER TABLE traffic_controls ADD COLUMN effective_from timestamptz;
ALTER TABLE traffic_controls ADD COLUMN effective_to timestamptz;

ALTER TABLE traffic_controls ADD COLUMN offer_scope text NOT NULL DEFAULT 'all' CHECK (offer_scope IN ('all', 'offers', 'advertisers'));
UPDATE traffic_controls SET offer_scope = 'offers' WHERE jsonb_array_length(offer_ids) > 0;
UPDATE traffic_controls SET offer_scope = 'advertisers' WHERE offer_scope = 'all' AND jsonb_array_length(advertiser_ids) > 0;

ALTER TABLE traffic_controls ADD COLUMN partner_scope text NOT NULL DEFAULT 'all' CHECK (partner_scope IN ('all', 'specific'));
UPDATE traffic_controls SET partner_scope = 'specific' WHERE jsonb_array_length(partner_ids) > 0;

ALTER TABLE traffic_controls ADD COLUMN action text NOT NULL DEFAULT 'block' CHECK (action IN ('block', 'fail_traffic'));
ALTER TABLE traffic_controls ADD COLUMN variables jsonb NOT NULL DEFAULT '[]';
ALTER TABLE traffic_controls ADD COLUMN comparison_method text
  CHECK (comparison_method IN ('begins_with', 'contains', 'not_contains', 'not_match', 'ends_with', 'exact_match', 'is_empty'));
ALTER TABLE traffic_controls ADD COLUMN control_values jsonb NOT NULL DEFAULT '[]';

-- Down Migration

ALTER TABLE traffic_controls DROP COLUMN IF EXISTS control_values;
ALTER TABLE traffic_controls DROP COLUMN IF EXISTS comparison_method;
ALTER TABLE traffic_controls DROP COLUMN IF EXISTS variables;
ALTER TABLE traffic_controls DROP COLUMN IF EXISTS action;
ALTER TABLE traffic_controls DROP COLUMN IF EXISTS partner_scope;
ALTER TABLE traffic_controls DROP COLUMN IF EXISTS offer_scope;
ALTER TABLE traffic_controls DROP COLUMN IF EXISTS effective_to;
ALTER TABLE traffic_controls DROP COLUMN IF EXISTS effective_from;

ALTER TABLE traffic_controls DROP CONSTRAINT traffic_controls_status_check;
UPDATE traffic_controls SET status = 'paused' WHERE status = 'inactive';
ALTER TABLE traffic_controls ADD CONSTRAINT traffic_controls_status_check CHECK (status IN ('active', 'paused'));

ALTER TABLE traffic_controls DROP COLUMN IF EXISTS ref;
