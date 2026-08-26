-- Up Migration

-- Traffic Sources (Partners › Traffic Sources): reusable presets of tracking-link query
-- parameters (name→value pairs, values often containing macros like {sub1}) a Partner picks when
-- generating a link, plus an optional postback URL fired on conversion. parameters stored as a
-- jsonb array to preserve the reference's ordered Parameter/Value row list.
CREATE TABLE traffic_sources (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id         uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name               text NOT NULL,
  enable_postback    boolean NOT NULL DEFAULT false,
  postback_url       text,
  visible_to_partners boolean NOT NULL DEFAULT false,
  parameters         jsonb NOT NULL DEFAULT '[]',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX traffic_sources_network_idx ON traffic_sources (network_id);
CREATE TRIGGER trg_traffic_sources_updated_at BEFORE UPDATE ON traffic_sources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS traffic_sources;
