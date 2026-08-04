-- Append-only money ledger + payouts (spec §8 — money-critical). Balances are DERIVED by summing
-- entries; corrections are new offsetting entries, never edits. All money is numeric — NEVER float.

-- Up Migration
CREATE TABLE ledger_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL,
  account_type    text NOT NULL CHECK (account_type IN ('publisher', 'advertiser')),
  account_id      uuid NOT NULL,
  conversion_id   text,                      -- null for manual adjustments/payouts
  entry_type      text NOT NULL CHECK (entry_type IN ('earning', 'billing', 'reversal', 'adjustment', 'payout')),
  direction       text NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount          numeric(14,4) NOT NULL CHECK (amount >= 0),  -- always positive; sign from direction
  currency        text NOT NULL,
  status          text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
  idempotency_key text NOT NULL,             -- UNIQUE — prevents double-writing the same event
  created_at      timestamptz NOT NULL DEFAULT now(),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX ledger_entries_idempotency_key ON ledger_entries (idempotency_key);
CREATE INDEX ledger_entries_account_idx ON ledger_entries (network_id, account_type, account_id, status);
CREATE INDEX ledger_entries_conversion_idx ON ledger_entries (network_id, conversion_id);
CREATE INDEX ledger_entries_created_idx ON ledger_entries (network_id, created_at DESC);

-- HARD guarantee (spec §8): no UPDATE / DELETE on ledger_entries, EVER. Defense-in-depth at the DB.
CREATE OR REPLACE FUNCTION ledger_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only: UPDATE/DELETE is forbidden (spec §8)';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_block_mutation();
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_block_mutation();

-- A payout run. FX rate is frozen here and never recomputed at today's rate (spec §8).
CREATE TABLE payout_batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id   uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'paid' CHECK (status IN ('draft', 'paid', 'failed')),
  currency     text NOT NULL DEFAULT 'USD',
  fx_rate      numeric(18,8) NOT NULL DEFAULT 1,   -- frozen at batch time
  total_amount numeric(14,4) NOT NULL DEFAULT 0,
  note         text,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payout_batches_network_idx ON payout_batches (network_id, created_at DESC);

-- Per-publisher payout line within a batch. The matching ledger 'payout' debit references this id.
CREATE TABLE payouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id    uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  batch_id      uuid NOT NULL REFERENCES payout_batches(id) ON DELETE CASCADE,
  publisher_id  uuid NOT NULL REFERENCES publishers(id) ON DELETE RESTRICT,
  amount        numeric(14,4) NOT NULL CHECK (amount >= 0),
  currency      text NOT NULL,
  fx_rate       numeric(18,8) NOT NULL DEFAULT 1,
  status        text NOT NULL DEFAULT 'paid' CHECK (status IN ('pending', 'paid', 'failed')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payouts_batch_idx ON payouts (network_id, batch_id);
CREATE INDEX payouts_publisher_idx ON payouts (network_id, publisher_id, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS payouts;
DROP TABLE IF EXISTS payout_batches;
DROP TRIGGER IF EXISTS ledger_no_delete ON ledger_entries;
DROP TRIGGER IF EXISTS ledger_no_update ON ledger_entries;
DROP TABLE IF EXISTS ledger_entries;
DROP FUNCTION IF EXISTS ledger_block_mutation();
