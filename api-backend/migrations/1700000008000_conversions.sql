-- Conversions + outbound-postback config + delivery log (spec §4, §6). Conversions dedup via a
-- DB unique constraint on (offer_id, transaction_id) — the second half of the idempotency guard
-- (Redis SETNX is the first). Like clicks, no FKs on the high-volume path; integrity is upstream.

-- Up Migration
CREATE TABLE conversions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversion_id  text NOT NULL,             -- public id
  network_id     uuid NOT NULL,
  click_id       text NOT NULL,             -- the originating click (clicks.click_id)
  offer_id       uuid NOT NULL,
  publisher_id   uuid,
  advertiser_id  uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  event_name     text,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected')),
  reason         text,                      -- e.g. 'outside_attribution_window'
  payout         numeric(14,4),
  revenue        numeric(14,4),
  currency       text,
  transaction_id text,                      -- advertiser-supplied; used for dedup
  source         text NOT NULL CHECK (source IN ('postback', 'pixel', 'iframe')),
  raw_params     jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX conversions_conversion_id_key ON conversions (conversion_id);
-- Idempotency: an advertiser's txn_id is unique per offer (when supplied).
CREATE UNIQUE INDEX conversions_offer_txn_key ON conversions (offer_id, transaction_id)
  WHERE transaction_id IS NOT NULL;
CREATE INDEX conversions_network_created_idx ON conversions (network_id, created_at DESC);
CREATE INDEX conversions_click_idx ON conversions (network_id, click_id);
CREATE INDEX conversions_offer_idx ON conversions (network_id, offer_id, created_at DESC);
CREATE INDEX conversions_publisher_idx ON conversions (network_id, publisher_id, created_at DESC);
CREATE INDEX conversions_status_idx ON conversions (network_id, status);

CREATE TABLE publisher_postbacks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id    uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  publisher_id  uuid NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
  offer_id      uuid REFERENCES offers(id) ON DELETE CASCADE,   -- null = applies to all offers
  url           text NOT NULL,              -- with {macros}: {click_id},{payout},{txn_id},...
  method        text NOT NULL DEFAULT 'GET' CHECK (method IN ('GET', 'POST')),
  event         text,                       -- null = fire for any event
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX publisher_postbacks_pub_idx ON publisher_postbacks (network_id, publisher_id);
CREATE INDEX publisher_postbacks_offer_idx ON publisher_postbacks (network_id, offer_id);
CREATE TRIGGER trg_publisher_postbacks_updated_at BEFORE UPDATE ON publisher_postbacks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE postback_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id    uuid NOT NULL,
  conversion_id text NOT NULL,
  publisher_id  uuid,
  url           text NOT NULL,
  attempt       integer NOT NULL DEFAULT 1,
  status_code   integer,
  success       boolean NOT NULL DEFAULT false,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX postback_logs_conversion_idx ON postback_logs (network_id, conversion_id);
CREATE INDEX postback_logs_created_idx ON postback_logs (network_id, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS postback_logs;
DROP TABLE IF EXISTS publisher_postbacks;
DROP TABLE IF EXISTS conversions;
