-- Up Migration

-- Traffic Blocking (Partners › Traffic Blocking): per Partner+Offer rules that reject a click when
-- a sub-placement (sub1..sub10) or source_id matches a filter. Filters stored as jsonb keyed by
-- field name (only enabled fields present) rather than 33 flat columns: { "sub1": { "matchType":
-- "contains", "value": "moscow" }, "sourceId": { "matchType": "is_empty", "value": null } }.
CREATE TABLE traffic_blockings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id   uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  publisher_id uuid NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
  offer_id     uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  filters      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX traffic_blockings_network_idx ON traffic_blockings (network_id);
CREATE INDEX traffic_blockings_lookup_idx ON traffic_blockings (network_id, publisher_id, offer_id);
CREATE TRIGGER trg_traffic_blockings_updated_at BEFORE UPDATE ON traffic_blockings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS traffic_blockings;
