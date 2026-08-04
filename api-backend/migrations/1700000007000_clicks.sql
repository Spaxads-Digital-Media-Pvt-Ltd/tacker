-- Clicks (spec §4, §5) — THE high-volume table. Written ONLY asynchronously by the click-persist
-- worker (never on the hot path, non-negotiable #1). Deliberately NO foreign keys here: FK checks
-- cost latency/locks at click volume, and this table is the one that moves to ClickHouse later
-- (spec §2, §8 Phase 8). Integrity is enforced upstream (offer/publisher validated from cache).

-- Up Migration
CREATE TABLE clicks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  click_id      text NOT NULL,              -- public, unguessable id echoed back on conversion
  network_id    uuid NOT NULL,
  offer_id      uuid NOT NULL,
  publisher_id  uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),

  ip            inet,
  country       text,
  region        text,
  city          text,
  isp           text,

  device        text,
  os            text,
  browser       text,

  referrer      text,
  user_agent    text,

  sub1 text, sub2 text, sub3 text, sub4 text, sub5 text,

  is_unique     boolean NOT NULL DEFAULT true,
  fraud_score   integer NOT NULL DEFAULT 0,
  fraud_flags   text[]  NOT NULL DEFAULT '{}',

  -- Payout/revenue resolved at click time (incl. geo overrides) so conversions can freeze them.
  resolved_payout  numeric(14,4),
  resolved_revenue numeric(14,4),
  currency      text
);

-- click_id is looked up on every conversion (spec §6) — must be unique + fast.
CREATE UNIQUE INDEX clicks_click_id_key ON clicks (click_id);
-- Reporting/attribution access patterns (spec §3B, §9).
CREATE INDEX clicks_network_created_idx ON clicks (network_id, created_at DESC);
CREATE INDEX clicks_offer_idx ON clicks (network_id, offer_id, created_at DESC);
CREATE INDEX clicks_publisher_idx ON clicks (network_id, publisher_id, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS clicks;
