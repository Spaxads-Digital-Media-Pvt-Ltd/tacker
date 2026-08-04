-- Shared trigger to keep `updated_at` current on row updates. Applied by every table below.

-- Up Migration
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill onto networks (created in the Phase 0 migration without a trigger).
DROP TRIGGER IF EXISTS trg_networks_updated_at ON networks;
CREATE TRIGGER trg_networks_updated_at BEFORE UPDATE ON networks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TRIGGER IF EXISTS trg_networks_updated_at ON networks;
DROP FUNCTION IF EXISTS set_updated_at();
