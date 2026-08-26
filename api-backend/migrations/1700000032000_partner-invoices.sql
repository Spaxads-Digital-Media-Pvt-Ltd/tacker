-- Up Migration

-- Manage Invoices (Partners › Invoices): Accounts Payable invoices generated for a Partner over a
-- billing period, matching the reference's "Manage Invoices" page. `billed_amount` is a snapshot —
-- computed once from ledger_entries for the publisher/period at creation time (see routes.ts),
-- not recomputed live, matching how a real invoice locks in an amount once issued.
-- `payment_method` is a snapshot of the publisher's own payment_method at creation time (reference's
-- "Billing" panel shows the same); the detail page reads the publisher's live billing_frequency/
-- tax_id directly rather than duplicating them here.
CREATE TABLE partner_invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id          uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  ref                 bigserial,
  publisher_id        uuid NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'deleted')),
  visible_to_partner  boolean NOT NULL DEFAULT true,
  payment_terms       text,
  payment_method      text,
  currency            text NOT NULL DEFAULT 'USD',
  period_start        date NOT NULL,
  period_end          date NOT NULL,
  billed_amount       numeric(14,2) NOT NULL DEFAULT 0,
  payments_amount     numeric(14,2) NOT NULL DEFAULT 0,
  paid_at             timestamptz,
  public_notes        text,
  internal_notes      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX partner_invoices_network_idx ON partner_invoices (network_id);
CREATE INDEX partner_invoices_publisher_idx ON partner_invoices (network_id, publisher_id);
CREATE INDEX partner_invoices_ref_idx ON partner_invoices (ref);
CREATE TRIGGER trg_partner_invoices_updated_at BEFORE UPDATE ON partner_invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS partner_invoices;
