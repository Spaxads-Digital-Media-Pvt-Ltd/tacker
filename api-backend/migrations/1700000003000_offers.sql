-- Offers + geo rules + publisher access (spec §4). Money is numeric(14,4) — NEVER float (§8).

-- Up Migration
CREATE TABLE offers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id         uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  advertiser_id      uuid NOT NULL REFERENCES advertisers(id) ON DELETE RESTRICT,
  name               text NOT NULL,
  status             text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  -- Destination URL with macro placeholders ({click_id}, {sub1}, …) substituted on redirect (§5).
  destination_url    text NOT NULL,
  payout_model       text NOT NULL DEFAULT 'CPA'
                     CHECK (payout_model IN ('CPA', 'CPL', 'CPC', 'CPI', 'RevShare')),
  default_payout     numeric(14,4) NOT NULL DEFAULT 0,
  default_revenue    numeric(14,4) NOT NULL DEFAULT 0,
  currency           text NOT NULL DEFAULT 'USD',
  -- Caps (null = unlimited). Enforced atomically in Redis on the hot path (§5); stored here as config.
  daily_conversion_cap integer,
  total_conversion_cap integer,
  daily_click_cap      integer,
  attribution_window_s integer NOT NULL DEFAULT 2592000,
  dedup_window_s       integer NOT NULL DEFAULT 86400,
  allowed_traffic_types text[] NOT NULL DEFAULT '{}',
  -- Where to send traffic when denied/capped (never a hard error to the user, §5).
  fallback_url       text,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX offers_network_idx ON offers (network_id);
CREATE INDEX offers_network_status_idx ON offers (network_id, status);
CREATE INDEX offers_advertiser_idx ON offers (network_id, advertiser_id);
CREATE TRIGGER trg_offers_updated_at BEFORE UPDATE ON offers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE offer_geo_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id     uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  offer_id       uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  country        text NOT NULL,             -- ISO 3166-1 alpha-2, or '*' for default
  region         text,                      -- optional subdivision
  action         text NOT NULL DEFAULT 'allow' CHECK (action IN ('allow', 'deny')),
  payout_override  numeric(14,4),
  revenue_override numeric(14,4),
  destination_override text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX offer_geo_rules_offer_idx ON offer_geo_rules (network_id, offer_id);
CREATE UNIQUE INDEX offer_geo_rules_offer_country_key
  ON offer_geo_rules (offer_id, country, COALESCE(region, ''));
CREATE TRIGGER trg_offer_geo_rules_updated_at BEFORE UPDATE ON offer_geo_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE offer_publisher_access (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  offer_id        uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  publisher_id    uuid NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
  access          text NOT NULL DEFAULT 'allow' CHECK (access IN ('allow', 'deny')),
  approval_status text NOT NULL DEFAULT 'approved'
                  CHECK (approval_status IN ('approved', 'pending', 'rejected')),
  payout_override numeric(14,4),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX offer_publisher_access_key ON offer_publisher_access (offer_id, publisher_id);
CREATE INDEX offer_publisher_access_pub_idx ON offer_publisher_access (network_id, publisher_id);
CREATE INDEX offer_publisher_access_offer_idx ON offer_publisher_access (network_id, offer_id);
CREATE TRIGGER trg_offer_publisher_access_updated_at BEFORE UPDATE ON offer_publisher_access
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE IF EXISTS offer_publisher_access;
DROP TABLE IF EXISTS offer_geo_rules;
DROP TABLE IF EXISTS offers;
