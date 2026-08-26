-- Up Migration

-- Manage Invoices (Advertisers › Invoices): Accounts Receivable invoices generated for an
-- Advertiser over a billing period, matching the reference's "Manage Invoices" page (the
-- advertiser-side counterpart to Partners' partner_invoices). billed_amount is a snapshot —
-- computed once from ledger_entries for the advertiser/period at creation time (see routes.ts),
-- same debit-sum formula the old /api/invoices aggregation used.
CREATE TABLE advertiser_invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id            uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  ref                   bigserial,
  advertiser_id         uuid NOT NULL REFERENCES advertisers(id) ON DELETE CASCADE,
  status                text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'deleted')),
  visible_to_advertiser boolean NOT NULL DEFAULT true,
  payment_terms         text,
  currency              text NOT NULL DEFAULT 'USD',
  period_start          date NOT NULL,
  period_end            date NOT NULL,
  billed_amount         numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount           numeric(14,2) NOT NULL DEFAULT 0,
  paid_at               timestamptz,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX advertiser_invoices_network_idx ON advertiser_invoices (network_id);
CREATE INDEX advertiser_invoices_advertiser_idx ON advertiser_invoices (network_id, advertiser_id);
CREATE INDEX advertiser_invoices_ref_idx ON advertiser_invoices (ref);
CREATE TRIGGER trg_advertiser_invoices_updated_at BEFORE UPDATE ON advertiser_invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS advertiser_invoices;
