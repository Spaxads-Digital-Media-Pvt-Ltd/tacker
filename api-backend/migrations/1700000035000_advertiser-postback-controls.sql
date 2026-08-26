-- Up Migration

-- Manage Postback Controls (Advertisers › Postback Controls): rules that automatically accept,
-- reject, or hold incoming conversions based on real variables available at conversion-record time
-- (event, payout, revenue, sub1-5, source), optionally scoped to specific Offers/Advertisers and/or
-- Partners. Enforced for real in recordConversion() (see conversions/record.ts) — not just CRUD.
CREATE TABLE advertiser_postback_controls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id        uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  ref               bigserial,
  name              text NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  effective_start   timestamptz,
  effective_end     timestamptz,
  control_type      text NOT NULL CHECK (control_type IN ('accept', 'reject', 'hold')),
  target_type       text CHECK (target_type IN ('offer', 'advertiser')),
  target_ids        uuid[] NOT NULL DEFAULT '{}',
  partner_ids       uuid[] NOT NULL DEFAULT '{}',
  condition_logic   text NOT NULL DEFAULT 'all' CHECK (condition_logic IN ('all', 'any')),
  rules             jsonb NOT NULL DEFAULT '[]',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX advertiser_postback_controls_network_idx ON advertiser_postback_controls (network_id);
CREATE INDEX advertiser_postback_controls_active_idx ON advertiser_postback_controls (network_id, status, ref);
CREATE INDEX advertiser_postback_controls_ref_idx ON advertiser_postback_controls (ref);
CREATE TRIGGER trg_advertiser_postback_controls_updated_at BEFORE UPDATE ON advertiser_postback_controls
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS advertiser_postback_controls;
