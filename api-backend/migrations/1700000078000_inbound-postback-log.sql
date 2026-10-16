-- Inbound postback log: every conversion request the tracker receives — S2S postback, pixel, iframe,
-- and the public API — with what happened to it: counted (approved / pending / rejected, with the
-- conversion), or not (duplicate, click not found, wrong security code, …) and why. Nothing an
-- advertiser sends goes unrecorded; the Advertiser Postback report reads it, and reconciling with
-- another tracker's numbers is a matter of comparing lines. Pruned on the network's click window.
-- Request params are stored redacted (secure_code and other secrets → "[redacted]").

-- Up Migration

CREATE TABLE inbound_postback_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id     uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  source         text NOT NULL CHECK (source IN ('postback', 'pixel', 'iframe', 'api')),
  method         text,
  click_id       text,
  transaction_id text,
  event_name     text,
  offer_id       uuid,
  publisher_id   uuid,
  advertiser_id  uuid,
  outcome        text NOT NULL,
  reason         text,
  conversion_id  text,
  payout         numeric(14,4),
  revenue        numeric(14,4),
  currency       text,
  sale_amount    numeric(14,4),
  http_status    integer,
  ip             inet,
  user_agent     text,
  params         jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX inbound_postback_logs_network_idx ON inbound_postback_logs (network_id, created_at DESC);
CREATE INDEX inbound_postback_logs_click_idx ON inbound_postback_logs (network_id, click_id);
CREATE INDEX inbound_postback_logs_txn_idx ON inbound_postback_logs (network_id, transaction_id) WHERE transaction_id IS NOT NULL;

-- Down Migration

DROP TABLE IF EXISTS inbound_postback_logs;
