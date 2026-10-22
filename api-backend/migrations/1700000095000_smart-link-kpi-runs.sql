-- Smart Links › Run Record: one row per KPI scoring run of a smart link (lib/smart-links/kpi.ts) — what
-- each item scored over the lookback window and the weight /sl picked with afterwards — so the
-- "Run Record" tab shows the history instead of only the latest weights on the items. Pruned after
-- 90 days by the retention job.

-- Up Migration

CREATE TABLE smart_link_kpi_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id     uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  smart_link_id  uuid NOT NULL REFERENCES smart_links(id) ON DELETE CASCADE,
  ran_at         timestamptz NOT NULL DEFAULT now(),
  metric         text NOT NULL CHECK (metric IN ('CVR', 'EPC', 'Revenue')),
  lookback_hours integer NOT NULL,
  min_clicks     integer NOT NULL,
  -- [{ itemId, offerId, clicks, conversions, payout, revenue, score, weight }] — money as text.
  items          jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- false = no item qualified (min clicks + a score above zero): /sl kept rotating evenly.
  weighted       boolean NOT NULL
);
CREATE INDEX smart_link_kpi_runs_link_idx ON smart_link_kpi_runs (network_id, smart_link_id, ran_at DESC);

-- Down Migration

DROP TABLE IF EXISTS smart_link_kpi_runs;
