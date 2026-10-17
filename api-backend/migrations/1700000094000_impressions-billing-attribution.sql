-- Offer features that were saved but not run: impressions (CPM + view-through), CPC billing, email ownership,
-- price per product.
--
-- * impressions — ad impressions from /impression, recorded like clicks (accepted, or rejected with the reason as
--   the first fraud flag) by the impression-persist worker, never on the request path. No foreign keys, for the
--   same reason as clicks (volume); a network purge and retention delete them explicitly.
-- * impression_billing — counters of the BILLABLE impressions of an offer priced per 1000 impressions (payout
--   model CPM, or Revenue Action "Impression"), per (offer, partner, day, country, device, currency, rates). The
--   impression-billing worker books what's new since the last booking as one conversion (source 'impression'),
--   so CPM money reaches the ledger, reports, invoices and balances like any other, and moves `booked` up in the
--   same transaction (exact, idempotent).
-- * conversions:
--     source 'click' — a paid click on a CPC offer (one per billable click) — and 'impression' (CPM bookings);
--     attribution — how the conversion found its partner: 'click' (its click id), 'coupon', 'email' (email
--       ownership), 'view_through' (an impression, no click), 'impression' (a CPM booking);
--     country / device — for conversions with no click row behind them (view-through, CPM bookings), so reports
--       can still place them; reports prefer the click's;
--     products — the priced product lines of a Price-Per-Product conversion.
-- * stats_conversions_15m.billed_rows — approved CPC / CPM booking rows. Their money counts in reports, but they
--   aren't conversions (conversions / total_conversions leave them out).
-- * email_owners — Email Ownership: which partner owns a customer (sha256 of the normalised address — the
--   address itself is never stored) on an offer.
-- * offer_products — Price Per Product: a product's payout / revenue (by SKU, else by category) on an offer.
-- * offers.payout_model 'CPM'.

-- Up Migration

CREATE TABLE impressions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  impression_id text NOT NULL,
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
  source_id     text,
  creative_id   text,
  is_unique     boolean NOT NULL DEFAULT true,
  fraud_score   integer NOT NULL DEFAULT 0,
  fraud_flags   text[]  NOT NULL DEFAULT '{}',
  -- Rates frozen at impression time, like a click's: per conversion, for a view-through conversion.
  resolved_payout  numeric(14,4),
  resolved_revenue numeric(14,4),
  currency      text
);
CREATE UNIQUE INDEX impressions_impression_id_key ON impressions (impression_id);
CREATE INDEX impressions_network_created_idx ON impressions (network_id, created_at DESC);
CREATE INDEX impressions_offer_idx ON impressions (network_id, offer_id, created_at DESC);
CREATE INDEX impressions_publisher_idx ON impressions (network_id, publisher_id, created_at DESC);
-- View-through by address (a conversion with no click id): the offer's latest impression from the visitor's IP.
CREATE INDEX impressions_vt_ip_idx ON impressions (network_id, offer_id, ip, created_at DESC);

CREATE TABLE impression_billing (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id     uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  offer_id       uuid NOT NULL,
  publisher_id   uuid NOT NULL,
  advertiser_id  uuid,
  day            date NOT NULL,
  country        text NOT NULL DEFAULT '',
  device         text NOT NULL DEFAULT '',
  currency       text NOT NULL,
  payout_cpm     numeric(14,4) NOT NULL DEFAULT 0,
  revenue_cpm    numeric(14,4) NOT NULL DEFAULT 0,
  impressions    bigint NOT NULL DEFAULT 0,
  booked         bigint NOT NULL DEFAULT 0,
  last_booked_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX impression_billing_key ON impression_billing
  (network_id, offer_id, publisher_id, day, country, device, currency, payout_cpm, revenue_cpm);
CREATE INDEX impression_billing_unbooked ON impression_billing (last_booked_at NULLS FIRST) WHERE impressions > booked;

ALTER TABLE conversions DROP CONSTRAINT conversions_source_check;
ALTER TABLE conversions ADD CONSTRAINT conversions_source_check
  CHECK (source IN ('postback', 'pixel', 'iframe', 'manual', 'click', 'impression'));
ALTER TABLE conversions ADD COLUMN attribution text NOT NULL DEFAULT 'click'
  CHECK (attribution IN ('click', 'coupon', 'email', 'view_through', 'impression'));
ALTER TABLE conversions ADD COLUMN country text;
ALTER TABLE conversions ADD COLUMN device text;
ALTER TABLE conversions ADD COLUMN products jsonb;
-- Coupon conversions recorded before the column existed (their virtual click ids start with "coupon-").
UPDATE conversions SET attribution = 'coupon' WHERE click_id LIKE 'coupon-%' AND attribution = 'click';

ALTER TABLE stats_conversions_15m ADD COLUMN billed_rows integer NOT NULL DEFAULT 0;

CREATE TABLE email_owners (
  network_id         uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  offer_id           uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  email_hash         text NOT NULL,
  publisher_id       uuid NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
  -- When this partner took ownership (the start of a "static" window) and the latest conversion with the
  -- address (the start of a "dynamic" one).
  owned_since        timestamptz NOT NULL DEFAULT now(),
  last_conversion_at timestamptz NOT NULL DEFAULT now(),
  conversions        integer NOT NULL DEFAULT 1,
  PRIMARY KEY (network_id, offer_id, email_hash)
);
CREATE INDEX email_owners_publisher_idx ON email_owners (network_id, publisher_id);

CREATE TABLE offer_products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id    uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  offer_id      uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  sku           text,
  category      text,
  name          text,
  payout_type   text NOT NULL DEFAULT 'fixed' CHECK (payout_type IN ('fixed', 'percent')),
  payout_value  numeric(14,4),
  revenue_type  text NOT NULL DEFAULT 'fixed' CHECK (revenue_type IN ('fixed', 'percent')),
  revenue_value numeric(14,4),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (sku IS NOT NULL OR category IS NOT NULL)
);
CREATE UNIQUE INDEX offer_products_sku_key ON offer_products (offer_id, lower(sku)) WHERE sku IS NOT NULL;
CREATE UNIQUE INDEX offer_products_category_key ON offer_products (offer_id, lower(category)) WHERE sku IS NULL;
CREATE INDEX offer_products_offer_idx ON offer_products (network_id, offer_id);
CREATE TRIGGER trg_offer_products_updated_at BEFORE UPDATE ON offer_products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE offers DROP CONSTRAINT offers_payout_model_check;
ALTER TABLE offers ADD CONSTRAINT offers_payout_model_check
  CHECK (payout_model IN ('CPA', 'CPL', 'CPC', 'CPI', 'CPM', 'RevShare'));

-- Down Migration

-- Fails while an offer uses CPM or a conversion has a new source; change those first.
ALTER TABLE offers DROP CONSTRAINT offers_payout_model_check;
ALTER TABLE offers ADD CONSTRAINT offers_payout_model_check
  CHECK (payout_model IN ('CPA', 'CPL', 'CPC', 'CPI', 'RevShare'));
DROP TABLE IF EXISTS offer_products;
DROP TABLE IF EXISTS email_owners;
ALTER TABLE stats_conversions_15m DROP COLUMN IF EXISTS billed_rows;
ALTER TABLE conversions DROP COLUMN IF EXISTS products;
ALTER TABLE conversions DROP COLUMN IF EXISTS device;
ALTER TABLE conversions DROP COLUMN IF EXISTS country;
ALTER TABLE conversions DROP COLUMN IF EXISTS attribution;
ALTER TABLE conversions DROP CONSTRAINT conversions_source_check;
ALTER TABLE conversions ADD CONSTRAINT conversions_source_check
  CHECK (source IN ('postback', 'pixel', 'iframe', 'manual'));
DROP TABLE IF EXISTS impression_billing;
DROP TABLE IF EXISTS impressions;
