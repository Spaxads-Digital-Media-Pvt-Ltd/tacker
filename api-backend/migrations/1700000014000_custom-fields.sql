-- Wave 2/3: network-defined custom fields for publishers & advertisers (Trackier/Everflow "Custom
-- Fields"). Definitions live here; the VALUES are stored in each entity's existing metadata jsonb
-- under a "custom" key (no schema churn per field). Tenant-scoped by network_id (spec §3A).

-- Up Migration
CREATE TABLE custom_field_defs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id   uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  entity_type  text NOT NULL CHECK (entity_type IN ('publisher', 'advertiser', 'offer')),
  key          text NOT NULL,                 -- machine key stored in metadata.custom[key]
  label        text NOT NULL,
  field_type   text NOT NULL DEFAULT 'text' CHECK (field_type IN ('text', 'number', 'boolean', 'select')),
  options      text[] NOT NULL DEFAULT '{}',  -- for field_type 'select'
  required     boolean NOT NULL DEFAULT false,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX custom_field_defs_key ON custom_field_defs (network_id, entity_type, lower(key));
CREATE INDEX custom_field_defs_entity_idx ON custom_field_defs (network_id, entity_type);

-- Down Migration
DROP TABLE IF EXISTS custom_field_defs;
