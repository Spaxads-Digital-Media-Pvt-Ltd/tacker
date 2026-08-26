-- Up Migration

-- Manage Link Templates (Advertisers › Link Templates): default landing page URL templates per
-- Advertiser (macro-parameterized, e.g. {advertiser_id}/{sub1}), matching the reference's "Manage
-- Link Templates" page.
CREATE TABLE advertiser_link_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id        uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  ref               bigserial,
  advertiser_id     uuid NOT NULL REFERENCES advertisers(id) ON DELETE CASCADE,
  name              text NOT NULL,
  destination_url   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX advertiser_link_templates_network_idx ON advertiser_link_templates (network_id);
CREATE INDEX advertiser_link_templates_advertiser_idx ON advertiser_link_templates (network_id, advertiser_id);
CREATE INDEX advertiser_link_templates_ref_idx ON advertiser_link_templates (ref);
CREATE TRIGGER trg_advertiser_link_templates_updated_at BEFORE UPDATE ON advertiser_link_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS advertiser_link_templates;
