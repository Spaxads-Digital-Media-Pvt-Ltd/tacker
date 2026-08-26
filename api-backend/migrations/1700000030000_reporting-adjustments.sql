-- Up Migration

-- Reporting Adjustments (Partners › Adjustments): manual per-day overrides on top of a Partner+
-- Offer's real reported numbers (clicks/conversions tables), matching the reference's "Manage
-- Reporting Adjustments" page. One row = one Add-form submission covering a date range; `days` is
-- a jsonb array of per-day overrides so only the metrics an admin actually touched are stored —
-- everything else keeps reading the real aggregate at request time (see routes.ts).
CREATE TABLE reporting_adjustments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id        uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  publisher_id      uuid NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
  offer_id          uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  date_from         date NOT NULL,
  date_to           date NOT NULL,
  days              jsonb NOT NULL DEFAULT '[]',
  last_modified_by  uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reporting_adjustments_network_idx ON reporting_adjustments (network_id);
CREATE INDEX reporting_adjustments_lookup_idx ON reporting_adjustments (network_id, publisher_id, offer_id);
CREATE TRIGGER trg_reporting_adjustments_updated_at BEFORE UPDATE ON reporting_adjustments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS reporting_adjustments;
