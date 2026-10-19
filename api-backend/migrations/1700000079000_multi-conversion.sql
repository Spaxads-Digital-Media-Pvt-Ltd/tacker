-- Several conversions per click, Everflow-style (round 3). Each event (offer goal) can have its own
-- duplicate rule — one per click, many with unique transaction ids, or every postback counts — and
-- NULL follows the offer's rule. A transaction id is unique per offer + EVENT (Everflow's
-- "transaction id + event"), so a lead and its later sale may carry the same advertiser order id;
-- the same id twice for the same event is still a duplicate.

-- Up Migration

ALTER TABLE offer_goals ADD COLUMN duplicate_mode text
  CHECK (duplicate_mode IN ('one_per_click', 'unique_txn', 'every_postback'));

CREATE UNIQUE INDEX conversions_offer_event_txn_key ON conversions (offer_id, event_name, transaction_id)
  NULLS NOT DISTINCT WHERE transaction_id IS NOT NULL;
DROP INDEX IF EXISTS conversions_offer_txn_key;

-- Down Migration

-- Fails if two conversions share an offer + transaction id under different events; resolve those first.
CREATE UNIQUE INDEX conversions_offer_txn_key ON conversions (offer_id, transaction_id) WHERE transaction_id IS NOT NULL;
DROP INDEX IF EXISTS conversions_offer_event_txn_key;
ALTER TABLE offer_goals DROP COLUMN IF EXISTS duplicate_mode;
