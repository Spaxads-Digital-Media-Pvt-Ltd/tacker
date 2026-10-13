-- Smart-Link KPI rotation (audit F-17b): a worker scores each item of a KPI smart link over its
-- lookback window and stores the weight /sl picks with (NULL = not computed yet → plain rotation).

-- Up Migration

ALTER TABLE smart_link_items ADD COLUMN kpi_weight integer CHECK (kpi_weight >= 0);
ALTER TABLE smart_link_items ADD COLUMN kpi_score numeric(24,8);
ALTER TABLE smart_link_items ADD COLUMN kpi_clicks integer;
ALTER TABLE smart_links ADD COLUMN kpi_computed_at timestamptz;

-- Down Migration

ALTER TABLE smart_links DROP COLUMN IF EXISTS kpi_computed_at;
ALTER TABLE smart_link_items DROP COLUMN IF EXISTS kpi_clicks;
ALTER TABLE smart_link_items DROP COLUMN IF EXISTS kpi_score;
ALTER TABLE smart_link_items DROP COLUMN IF EXISTS kpi_weight;
