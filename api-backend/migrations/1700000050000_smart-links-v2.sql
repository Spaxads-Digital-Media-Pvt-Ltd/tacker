-- Smart Links, feature-depth v2 — matches the reference's real "Add Smart Link" wizard: a
-- Redirect Mechanism (KPI / Priority / Weight) instead of a plain "rotation" toggle, a Catch-All
-- Offer, Labels/Force SSL/Show to Partners/Tracking Domain, and per-item Offer URL override +
-- Position (for Priority mechanism). `rotation`/`fallback_url` are superseded and dropped.

-- Up Migration

ALTER TABLE smart_links ADD COLUMN ref bigserial;
CREATE INDEX smart_links_ref_idx ON smart_links (ref);

ALTER TABLE smart_links DROP CONSTRAINT smart_links_status_check;
ALTER TABLE smart_links ADD CONSTRAINT smart_links_status_check CHECK (status IN ('active', 'paused', 'deleted'));

ALTER TABLE smart_links ADD COLUMN redirect_mechanism text NOT NULL DEFAULT 'weight'
  CHECK (redirect_mechanism IN ('kpi', 'priority', 'weight'));
UPDATE smart_links SET redirect_mechanism = CASE WHEN rotation = 'round_robin' THEN 'priority' ELSE 'weight' END;

ALTER TABLE smart_links ADD COLUMN catch_all_offer_id uuid REFERENCES offers(id) ON DELETE SET NULL;
ALTER TABLE smart_links ADD COLUMN labels text;
ALTER TABLE smart_links ADD COLUMN force_ssl boolean NOT NULL DEFAULT true;
ALTER TABLE smart_links ADD COLUMN show_to_partners boolean NOT NULL DEFAULT false;
ALTER TABLE smart_links ADD COLUMN tracking_domain_id uuid REFERENCES tracking_domains(id) ON DELETE SET NULL;
ALTER TABLE smart_links ADD COLUMN kpi_run_frequency_hours integer;
ALTER TABLE smart_links ADD COLUMN kpi_lookback_hours integer;
ALTER TABLE smart_links ADD COLUMN kpi_metric text;
ALTER TABLE smart_links ADD COLUMN kpi_min_clicks integer;

ALTER TABLE smart_links DROP COLUMN rotation;
ALTER TABLE smart_links DROP COLUMN fallback_url;

ALTER TABLE smart_link_items ADD COLUMN offer_url text;
ALTER TABLE smart_link_items ADD COLUMN position integer;

-- Down Migration

ALTER TABLE smart_link_items DROP COLUMN IF EXISTS position;
ALTER TABLE smart_link_items DROP COLUMN IF EXISTS offer_url;

ALTER TABLE smart_links ADD COLUMN fallback_url text;
ALTER TABLE smart_links ADD COLUMN rotation text NOT NULL DEFAULT 'weighted' CHECK (rotation IN ('weighted', 'round_robin'));
UPDATE smart_links SET rotation = CASE WHEN redirect_mechanism = 'priority' THEN 'round_robin' ELSE 'weighted' END;

ALTER TABLE smart_links DROP COLUMN IF EXISTS kpi_min_clicks;
ALTER TABLE smart_links DROP COLUMN IF EXISTS kpi_metric;
ALTER TABLE smart_links DROP COLUMN IF EXISTS kpi_lookback_hours;
ALTER TABLE smart_links DROP COLUMN IF EXISTS kpi_run_frequency_hours;
ALTER TABLE smart_links DROP COLUMN IF EXISTS tracking_domain_id;
ALTER TABLE smart_links DROP COLUMN IF EXISTS show_to_partners;
ALTER TABLE smart_links DROP COLUMN IF EXISTS force_ssl;
ALTER TABLE smart_links DROP COLUMN IF EXISTS labels;
ALTER TABLE smart_links DROP COLUMN IF EXISTS catch_all_offer_id;
ALTER TABLE smart_links DROP COLUMN IF EXISTS redirect_mechanism;
ALTER TABLE smart_links DROP CONSTRAINT smart_links_status_check;
ALTER TABLE smart_links ADD CONSTRAINT smart_links_status_check CHECK (status IN ('active', 'paused'));
ALTER TABLE smart_links DROP COLUMN IF EXISTS ref;
