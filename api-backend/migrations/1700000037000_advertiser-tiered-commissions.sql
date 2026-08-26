-- Up Migration

-- Manage Tiered Commissions (Advertisers › Tiered Commissions): rules that increase/decrease a
-- conversion's payout and/or revenue once a Partner (optionally scoped to specific Offers or
-- Advertisers) crosses a volume threshold within a rolling period. Real enforcement, not just
-- CRUD — see lib/tiered-commissions/evaluate.ts, applied in recordConversion(). Variables are
-- limited to what this app can honestly compute (conversion count, total payout, total revenue) —
-- no fabricated "Sale Amount"/"Event" metrics distinct from those.
CREATE TABLE advertiser_tiered_commissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id        uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  ref               bigserial,
  name              text NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes             text,
  effective_start   timestamptz,
  effective_end     timestamptz,
  target_type       text NOT NULL CHECK (target_type IN ('offer', 'advertiser')),
  target_ids        uuid[] NOT NULL DEFAULT '{}',
  partner_ids       uuid[] NOT NULL DEFAULT '{}',
  time_period       text NOT NULL CHECK (time_period IN ('daily', 'weekly', 'monthly', 'quarterly', 'global')),
  retroactive_mode  text NOT NULL DEFAULT 'disabled' CHECK (retroactive_mode IN ('disabled', 'enabled', 'custom')),
  goals             jsonb NOT NULL DEFAULT '[]',
  payout_enabled    boolean NOT NULL DEFAULT false,
  payout_action     text CHECK (payout_action IN ('decrease_flat', 'decrease_pct', 'increase_flat', 'increase_pct')),
  payout_value      numeric(14,4),
  revenue_enabled   boolean NOT NULL DEFAULT false,
  revenue_action    text CHECK (revenue_action IN ('decrease_flat', 'decrease_pct', 'increase_flat', 'increase_pct')),
  revenue_value     numeric(14,4),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX advertiser_tiered_commissions_network_idx ON advertiser_tiered_commissions (network_id);
CREATE INDEX advertiser_tiered_commissions_active_idx ON advertiser_tiered_commissions (network_id, status, ref);
CREATE INDEX advertiser_tiered_commissions_ref_idx ON advertiser_tiered_commissions (ref);
CREATE TRIGGER trg_advertiser_tiered_commissions_updated_at BEFORE UPDATE ON advertiser_tiered_commissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS advertiser_tiered_commissions;
