-- Super Admin › Money: what the platform's invoices are made of and how its revenue moves.
--
-- * platform_invoice_lines — an invoice's lines: the plan for the period, overage for the period that ended
--   (usage over the plan's limits × subscription_plans.overage), a discount (a coupon), one-off charges.
--   Every existing invoice gets its one line back-filled (additive).
-- * platform_coupons + subscription_discounts — a coupon (percent or amount off; once, for N invoices or
--   forever; max redemptions; valid until) applied to a network's subscription: one active discount each.
-- * platform_credit_notes — credit against a paid invoice (a refund, a goodwill credit), numbered CN-<year>-…;
--   like invoices, no FK to networks (financial records outlive a purge).
-- * platform_mrr_snapshots / platform_mrr_movements — each network's MRR per day and how it moved (new,
--   expansion, contraction, churn, reactivation), written by the billing worker: the Revenue page's history.
-- Money is numeric here and text in the API.

-- Up Migration

CREATE TABLE platform_invoice_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   uuid NOT NULL REFERENCES platform_invoices(id) ON DELETE CASCADE,
  position     integer NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('plan', 'overage', 'discount', 'addon', 'setup', 'one_off')),
  description  text NOT NULL,
  quantity     numeric(18, 4) NOT NULL DEFAULT 1,
  unit_amount  numeric(14, 4) NOT NULL,
  amount       numeric(14, 2) NOT NULL,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX platform_invoice_lines_invoice_idx ON platform_invoice_lines (invoice_id, position);
INSERT INTO platform_invoice_lines (invoice_id, position, kind, description, quantity, unit_amount, amount)
SELECT id, 1, CASE WHEN subscription_id IS NOT NULL THEN 'plan' ELSE 'one_off' END, description, 1, subtotal, subtotal FROM platform_invoices;

ALTER TABLE subscription_plans ADD COLUMN overage jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE platform_coupons (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL,
  name             text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('percent', 'amount')),
  percent_off      numeric(5, 2) CHECK (percent_off IS NULL OR (percent_off > 0 AND percent_off <= 100)),
  amount_off       numeric(14, 2) CHECK (amount_off IS NULL OR amount_off > 0),
  currency         text,
  duration         text NOT NULL CHECK (duration IN ('once', 'repeating', 'forever')),
  duration_cycles  integer CHECK (duration_cycles IS NULL OR duration_cycles > 0),
  max_redemptions  integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  redeemed         integer NOT NULL DEFAULT 0,
  valid_until      timestamptz,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by       uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'percent') = (percent_off IS NOT NULL)),
  CHECK ((kind = 'amount') = (amount_off IS NOT NULL AND currency IS NOT NULL)),
  CHECK ((duration = 'repeating') = (duration_cycles IS NOT NULL))
);
CREATE UNIQUE INDEX platform_coupons_code ON platform_coupons (upper(code));
CREATE TRIGGER trg_platform_coupons_updated_at BEFORE UPDATE ON platform_coupons FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE subscription_discounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id   uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  coupon_id    uuid NOT NULL REFERENCES platform_coupons(id) ON DELETE RESTRICT,
  cycles_left  integer,
  applied_by   uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  applied_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz
);
CREATE UNIQUE INDEX subscription_discounts_active ON subscription_discounts (network_id) WHERE ended_at IS NULL;

CREATE SEQUENCE platform_credit_note_seq START 1;
CREATE TABLE platform_credit_notes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number            text NOT NULL UNIQUE,
  invoice_id        uuid NOT NULL REFERENCES platform_invoices(id) ON DELETE RESTRICT,
  network_id        uuid NOT NULL,
  amount            numeric(14, 2) NOT NULL CHECK (amount > 0),
  currency          text NOT NULL,
  reason            text NOT NULL,
  refunded          boolean NOT NULL DEFAULT false,
  refund_method     text,
  refund_reference  text,
  created_by        uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_credit_notes_invoice_idx ON platform_credit_notes (invoice_id);
CREATE INDEX platform_credit_notes_created_idx ON platform_credit_notes (created_at);

CREATE TABLE platform_mrr_snapshots (
  day         date NOT NULL,
  network_id  uuid NOT NULL,
  currency    text NOT NULL,
  mrr         numeric(14, 2) NOT NULL,
  status      text,
  plan_id     uuid,
  PRIMARY KEY (day, network_id)
);
CREATE INDEX platform_mrr_snapshots_network_idx ON platform_mrr_snapshots (network_id, day DESC);

-- The days the snapshot ran: movements compare today with the previous run day (a network that stopped
-- paying has no row then — it churns once, not on every later day).
CREATE TABLE platform_mrr_days (
  day          date PRIMARY KEY,
  computed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_mrr_movements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day         date NOT NULL,
  network_id  uuid NOT NULL,
  currency    text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('new', 'expansion', 'contraction', 'churn', 'reactivation')),
  amount      numeric(14, 2) NOT NULL,
  from_mrr    numeric(14, 2) NOT NULL,
  to_mrr      numeric(14, 2) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_mrr_movements_day_idx ON platform_mrr_movements (day);
CREATE INDEX platform_mrr_movements_network_idx ON platform_mrr_movements (network_id, day);

-- Down Migration

DROP TABLE IF EXISTS platform_mrr_movements;
DROP TABLE IF EXISTS platform_mrr_days;
DROP TABLE IF EXISTS platform_mrr_snapshots;
DROP TABLE IF EXISTS platform_credit_notes;
DROP SEQUENCE IF EXISTS platform_credit_note_seq;
DROP TABLE IF EXISTS subscription_discounts;
DROP TABLE IF EXISTS platform_coupons;
ALTER TABLE subscription_plans DROP COLUMN IF EXISTS overage;
DROP TABLE IF EXISTS platform_invoice_lines;
