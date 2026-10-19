-- Platform billing (Super Admin): the platform bills its tenant networks for their plan.
--
-- - subscription_plans: monthly or yearly, an optional free trial, a description.
-- - subscriptions: when a trial ends, cancel at the period end (or now).
-- - networks.suspended_reason: 'billing' (an unpaid invoice — lifted when it's paid or its deadline is
--   pushed) or 'manual' (a Super Admin's call — only a Super Admin lifts it). NULL when not suspended.
-- - platform_settings: platform-wide key → value (billing: invoice prefix, due / grace days, tax, …).
-- - platform_invoices: one per subscription period (+ one-off ones). Paid by hand for now ("Mark as
--   paid" — the hook a payment gateway calls later). Unpaid at due_at → the subscription is past_due;
--   unpaid at suspend_at → the network is suspended (once per deadline; a Super Admin can push
--   suspend_at later). Platform-level money: amounts numeric(14,2), never float. network_id has NO
--   foreign key (like ledger_entries): an invoice outlives a purged network, with its bill_to snapshot.

-- Up Migration

ALTER TABLE subscription_plans
  ADD COLUMN billing_interval text NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('month', 'year')),
  ADD COLUMN trial_days integer NOT NULL DEFAULT 0 CHECK (trial_days BETWEEN 0 AND 365),
  ADD COLUMN description text;

ALTER TABLE subscriptions
  ADD COLUMN trial_ends_at timestamptz,
  ADD COLUMN cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN canceled_at timestamptz;

ALTER TABLE networks
  ADD COLUMN suspended_reason text CHECK (suspended_reason IN ('manual', 'billing'));
UPDATE networks SET suspended_reason = 'manual' WHERE status = 'suspended';

CREATE TABLE platform_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  uuid,                          -- platform_admins.id
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE platform_invoice_number_seq;

CREATE TABLE platform_invoices (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number                 text NOT NULL,             -- e.g. INV-2026-00042
  network_id             uuid NOT NULL,             -- no FK: kept after a purge (see above)
  subscription_id        uuid,
  plan_id                uuid,
  description            text NOT NULL,
  currency               text NOT NULL,
  subtotal               numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  tax_rate               numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  tax                    numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total                  numeric(14,2) NOT NULL CHECK (total >= 0),
  period_start           timestamptz,
  period_end             timestamptz,
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'void')),
  issued_at              timestamptz NOT NULL DEFAULT now(),
  due_at                 timestamptz NOT NULL,
  suspend_at             timestamptz NOT NULL,      -- unpaid by then → the network is suspended
  suspension_applied_at  timestamptz,               -- the suspension for the current suspend_at happened
  paid_at                timestamptz,
  paid_amount            numeric(14,2),
  payment_method         text,                      -- bank_transfer | upi | card | cash | cheque | other (a gateway's name later)
  payment_reference      text,
  voided_at              timestamptz,
  void_reason            text,
  bill_to                jsonb NOT NULL,            -- snapshot: { name, slug, email }
  notes                  text,
  created_by             text,                      -- platform_admins.id, or 'system' (the billing run)
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (suspend_at >= due_at)
);
CREATE UNIQUE INDEX platform_invoices_number_key ON platform_invoices (number);
CREATE INDEX platform_invoices_network_idx ON platform_invoices (network_id, issued_at DESC);
CREATE INDEX platform_invoices_open_idx ON platform_invoices (due_at) WHERE status = 'open';
-- One live invoice per subscription period: the billing run is idempotent.
CREATE UNIQUE INDEX platform_invoices_period_key ON platform_invoices (subscription_id, period_start)
  WHERE subscription_id IS NOT NULL AND period_start IS NOT NULL AND status <> 'void';
CREATE TRIGGER trg_platform_invoices_updated_at BEFORE UPDATE ON platform_invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS platform_invoices;
DROP SEQUENCE IF EXISTS platform_invoice_number_seq;
DROP TABLE IF EXISTS platform_settings;
ALTER TABLE networks DROP COLUMN IF EXISTS suspended_reason;
ALTER TABLE subscriptions
  DROP COLUMN IF EXISTS canceled_at,
  DROP COLUMN IF EXISTS cancel_at_period_end,
  DROP COLUMN IF EXISTS trial_ends_at;
ALTER TABLE subscription_plans
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS trial_days,
  DROP COLUMN IF EXISTS billing_interval;
