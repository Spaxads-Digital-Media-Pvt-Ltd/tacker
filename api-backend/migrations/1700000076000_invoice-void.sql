-- Invoices are financial records (O8): a paid invoice is never deleted or voided, and an unpaid one is
-- VOIDED rather than deleted — it keeps its number, amounts and history, with who voided it, when and
-- why, and its period is free for a corrected invoice. 'deleted' stays only for rows soft-deleted
-- before this change. A trigger makes "paid is final" hold for every writer, not just the API.

-- Up Migration

ALTER TABLE partner_invoices DROP CONSTRAINT partner_invoices_status_check;
ALTER TABLE partner_invoices ADD CONSTRAINT partner_invoices_status_check
  CHECK (status IN ('unpaid', 'paid', 'deleted', 'void'));
ALTER TABLE partner_invoices
  ADD COLUMN voided_at   timestamptz,
  ADD COLUMN voided_by   text,
  ADD COLUMN void_reason text;
ALTER TABLE partner_invoices DROP CONSTRAINT partner_invoices_no_overlapping_periods;
ALTER TABLE partner_invoices ADD CONSTRAINT partner_invoices_no_overlapping_periods
  EXCLUDE USING gist (
    network_id WITH =, publisher_id WITH =, currency WITH =,
    daterange(period_start, period_end, '[]') WITH &&
  ) WHERE (status NOT IN ('deleted', 'void'));

ALTER TABLE advertiser_invoices DROP CONSTRAINT advertiser_invoices_status_check;
ALTER TABLE advertiser_invoices ADD CONSTRAINT advertiser_invoices_status_check
  CHECK (status IN ('unpaid', 'paid', 'deleted', 'void'));
ALTER TABLE advertiser_invoices
  ADD COLUMN voided_at   timestamptz,
  ADD COLUMN voided_by   text,
  ADD COLUMN void_reason text;
ALTER TABLE advertiser_invoices DROP CONSTRAINT advertiser_invoices_no_overlapping_periods;
ALTER TABLE advertiser_invoices ADD CONSTRAINT advertiser_invoices_no_overlapping_periods
  EXCLUDE USING gist (
    network_id WITH =, advertiser_id WITH =, currency WITH =,
    daterange(period_start, period_end, '[]') WITH &&
  ) WHERE (status NOT IN ('deleted', 'void'));

CREATE FUNCTION invoice_paid_is_final() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'paid' AND NEW.status <> 'paid' THEN
    RAISE EXCEPTION 'A paid invoice is final: it can''t be deleted or voided.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER partner_invoices_paid_is_final BEFORE UPDATE OF status ON partner_invoices
  FOR EACH ROW EXECUTE FUNCTION invoice_paid_is_final();
CREATE TRIGGER advertiser_invoices_paid_is_final BEFORE UPDATE OF status ON advertiser_invoices
  FOR EACH ROW EXECUTE FUNCTION invoice_paid_is_final();

-- Down Migration

DROP TRIGGER IF EXISTS advertiser_invoices_paid_is_final ON advertiser_invoices;
DROP TRIGGER IF EXISTS partner_invoices_paid_is_final ON partner_invoices;
DROP FUNCTION IF EXISTS invoice_paid_is_final();
-- Void invoices go back to the old soft-delete status (the closest the old model had).
UPDATE advertiser_invoices SET status = 'deleted' WHERE status = 'void';
UPDATE partner_invoices SET status = 'deleted' WHERE status = 'void';
ALTER TABLE advertiser_invoices DROP CONSTRAINT advertiser_invoices_no_overlapping_periods;
ALTER TABLE advertiser_invoices ADD CONSTRAINT advertiser_invoices_no_overlapping_periods
  EXCLUDE USING gist (
    network_id WITH =, advertiser_id WITH =, currency WITH =,
    daterange(period_start, period_end, '[]') WITH &&
  ) WHERE (status <> 'deleted');
ALTER TABLE advertiser_invoices DROP COLUMN voided_at, DROP COLUMN voided_by, DROP COLUMN void_reason;
ALTER TABLE advertiser_invoices DROP CONSTRAINT advertiser_invoices_status_check;
ALTER TABLE advertiser_invoices ADD CONSTRAINT advertiser_invoices_status_check CHECK (status IN ('unpaid', 'paid', 'deleted'));
ALTER TABLE partner_invoices DROP CONSTRAINT partner_invoices_no_overlapping_periods;
ALTER TABLE partner_invoices ADD CONSTRAINT partner_invoices_no_overlapping_periods
  EXCLUDE USING gist (
    network_id WITH =, publisher_id WITH =, currency WITH =,
    daterange(period_start, period_end, '[]') WITH &&
  ) WHERE (status <> 'deleted');
ALTER TABLE partner_invoices DROP COLUMN voided_at, DROP COLUMN voided_by, DROP COLUMN void_reason;
ALTER TABLE partner_invoices DROP CONSTRAINT partner_invoices_status_check;
ALTER TABLE partner_invoices ADD CONSTRAINT partner_invoices_status_check CHECK (status IN ('unpaid', 'paid', 'deleted'));
