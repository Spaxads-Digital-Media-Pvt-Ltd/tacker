-- Smart links (offer rotation), offline conversions, and import/export logs (feature-depth parity).
-- Tenant-scoped by network_id (spec §3A); money untouched.

-- Up Migration

-- Smart link: one tracking link that rotates across several offers (weighted, optional geo target),
-- with a fallback when nothing matches.
CREATE TABLE smart_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id   uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name         text NOT NULL,
  rotation     text NOT NULL DEFAULT 'weighted' CHECK (rotation IN ('weighted', 'round_robin')),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  fallback_url text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX smart_links_network_idx ON smart_links (network_id);
CREATE TRIGGER trg_smart_links_updated_at BEFORE UPDATE ON smart_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE smart_link_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id    uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  smart_link_id uuid NOT NULL REFERENCES smart_links(id) ON DELETE CASCADE,
  offer_id      uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  weight        integer NOT NULL DEFAULT 1 CHECK (weight >= 0),
  country       text,                        -- optional geo target (ISO-2); null = any
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX smart_link_items_link_idx ON smart_link_items (network_id, smart_link_id);

-- Import/Export job log (Import & Export Logs report).
CREATE TABLE import_export_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id  uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('import', 'export')),
  entity      text NOT NULL,                 -- e.g. 'conversions', 'clicks'
  status      text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
  row_count   integer NOT NULL DEFAULT 0,
  detail      text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_export_logs_network_idx ON import_export_logs (network_id, created_at DESC);

-- Attribute clicks to a smart link when one routed them.
ALTER TABLE clicks ADD COLUMN smart_link_id uuid;

-- Allow offline/manual conversions (Offline Report).
ALTER TABLE conversions DROP CONSTRAINT conversions_source_check;
ALTER TABLE conversions ADD CONSTRAINT conversions_source_check
  CHECK (source IN ('postback', 'pixel', 'iframe', 'manual'));

-- Down Migration
ALTER TABLE conversions DROP CONSTRAINT conversions_source_check;
ALTER TABLE conversions ADD CONSTRAINT conversions_source_check
  CHECK (source IN ('postback', 'pixel', 'iframe'));
ALTER TABLE clicks DROP COLUMN IF EXISTS smart_link_id;
DROP TABLE IF EXISTS import_export_logs;
DROP TABLE IF EXISTS smart_link_items;
DROP TABLE IF EXISTS smart_links;
