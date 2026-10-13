-- Invoice settlement integrity (audit F-03).
--
-- 1. Paying an invoice now settles the ledger: a partner invoice becomes a real payout (batch +
--    payouts row + ledger 'payout' debit, exactly like a payout run — so reconcileLedger stays
--    clean), and an advertiser invoice writes the new 'receipt' entry: a CREDIT to the advertiser
--    that offsets their 'billing' debits. 'payout' stays publisher-only, so payout reporting and
--    reconciliation keep meaning money paid OUT.
-- 2. Two live (non-deleted) invoices for the same account + currency may not cover overlapping
--    periods: an exclusion constraint makes double billing impossible even under concurrent
--    creates. A soft-deleted invoice frees its period. Existing data was checked: no overlaps.
--
-- Down: removing 'receipt' from the CHECK fails while receipt rows exist — the ledger is
-- append-only, so those rows can never be removed; that rollback is intentionally impossible then.

-- Up Migration
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_entry_type_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check
  CHECK (entry_type IN ('earning', 'billing', 'reversal', 'adjustment', 'payout', 'receipt'));

ALTER TABLE partner_invoices ADD CONSTRAINT partner_invoices_no_overlapping_periods
  EXCLUDE USING gist (
    network_id WITH =, publisher_id WITH =, currency WITH =,
    daterange(period_start, period_end, '[]') WITH &&
  ) WHERE (status <> 'deleted');

ALTER TABLE advertiser_invoices ADD CONSTRAINT advertiser_invoices_no_overlapping_periods
  EXCLUDE USING gist (
    network_id WITH =, advertiser_id WITH =, currency WITH =,
    daterange(period_start, period_end, '[]') WITH &&
  ) WHERE (status <> 'deleted');

-- Down Migration
ALTER TABLE advertiser_invoices DROP CONSTRAINT IF EXISTS advertiser_invoices_no_overlapping_periods;
ALTER TABLE partner_invoices DROP CONSTRAINT IF EXISTS partner_invoices_no_overlapping_periods;
ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_entry_type_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check
  CHECK (entry_type IN ('earning', 'billing', 'reversal', 'adjustment', 'payout'));
