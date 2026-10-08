-- Consolidate the duplicated Category / Channel catalogs onto the Control Center tables.
--
-- 055 created offer_categories + partner_channels (and publishers.channel_id → partner_channels);
-- 060 created segmentation_categories + segmentation_channels for the same concepts. Only the
-- segmentation_* tables are registered in the tenant table registry and edited by Control Center;
-- the 055 pair could not be read through the API at all (every call 500'd) and nothing ever wrote
-- publishers.channel_id. This migration makes segmentation_* the single source of truth:
--
--   1. copy any 055 catalog rows into segmentation_* (same network, de-duplicated by name,
--      case-insensitive — an existing segmentation row with that name wins);
--   2. seed segmentation_categories with the free-text category names offers already use, so the
--      offer form / Offers › Category filter (which now read this catalog) lose nothing;
--   3. repoint publishers.channel_id to segmentation_channels, translating ids by (network, name)
--      and clearing any value that would point at another network's channel;
--   4. drop the 055 tables.
--
-- offers.category stays free text (no new offer column — by decision). node-pg-migrate runs this
-- file in one transaction, so a failure leaves the schema untouched.

-- Up Migration

-- 1. Catalog rows → Control Center tables.
INSERT INTO segmentation_categories (network_id, name, status, created_at, updated_at)
SELECT DISTINCT ON (oc.network_id, lower(btrim(oc.name)))
       oc.network_id, btrim(oc.name), oc.status, oc.created_at, oc.updated_at
  FROM offer_categories oc
 WHERE btrim(oc.name) <> ''
 ORDER BY oc.network_id, lower(btrim(oc.name)), oc.created_at
ON CONFLICT (network_id, lower(name)) DO NOTHING;

INSERT INTO segmentation_channels (network_id, name, status, created_at, updated_at)
SELECT DISTINCT ON (pc.network_id, lower(btrim(pc.name)))
       pc.network_id, btrim(pc.name), pc.status, pc.created_at, pc.updated_at
  FROM partner_channels pc
 WHERE btrim(pc.name) <> ''
 ORDER BY pc.network_id, lower(btrim(pc.name)), pc.created_at
ON CONFLICT (network_id, lower(name)) DO NOTHING;

-- 2. Categories already used by offers become catalog entries (active).
INSERT INTO segmentation_categories (network_id, name, status)
SELECT DISTINCT ON (o.network_id, lower(btrim(o.category)))
       o.network_id, btrim(o.category), 'active'
  FROM offers o
 WHERE o.category IS NOT NULL AND btrim(o.category) <> ''
 ORDER BY o.network_id, lower(btrim(o.category))
ON CONFLICT (network_id, lower(name)) DO NOTHING;

-- 3. publishers.channel_id → segmentation_channels.
ALTER TABLE publishers DROP CONSTRAINT IF EXISTS publishers_channel_id_fkey;

UPDATE publishers p
   SET channel_id = sc.id
  FROM partner_channels pc
  JOIN segmentation_channels sc
    ON sc.network_id = pc.network_id AND lower(sc.name) = lower(btrim(pc.name))
 WHERE p.channel_id = pc.id
   AND p.network_id = pc.network_id;

-- Anything still not pointing at a same-network Control Center channel (cross-tenant or orphaned
-- legacy ids) is cleared rather than left dangling.
UPDATE publishers p
   SET channel_id = NULL
 WHERE p.channel_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM segmentation_channels sc WHERE sc.id = p.channel_id AND sc.network_id = p.network_id);

ALTER TABLE publishers
  ADD CONSTRAINT publishers_channel_id_fkey
  FOREIGN KEY (channel_id) REFERENCES segmentation_channels(id) ON DELETE SET NULL;

-- 4. The duplicate catalogs are now empty of meaning — drop them.
DROP TABLE offer_categories;
DROP TABLE partner_channels;

-- Down Migration

-- Recreate the 055 tables (same shape), copy the Control Center rows back, and repoint the FK.
-- Lossless for names/status; categories seeded from offers.category in step 2 remain in
-- segmentation_categories (harmless — they are real names in use).
CREATE TABLE offer_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref        bigserial,
  network_id uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name       text NOT NULL,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX offer_categories_name_key ON offer_categories (network_id, lower(name));
CREATE INDEX offer_categories_network_idx ON offer_categories (network_id);
CREATE TRIGGER trg_offer_categories_updated_at BEFORE UPDATE ON offer_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE partner_channels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref        bigserial,
  network_id uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name       text NOT NULL,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX partner_channels_name_key ON partner_channels (network_id, lower(name));
CREATE INDEX partner_channels_network_idx ON partner_channels (network_id);
CREATE TRIGGER trg_partner_channels_updated_at BEFORE UPDATE ON partner_channels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO offer_categories (network_id, name, status, created_at, updated_at)
SELECT network_id, name, status, created_at, updated_at FROM segmentation_categories WHERE status <> 'deleted';
INSERT INTO partner_channels (network_id, name, status, created_at, updated_at)
SELECT network_id, name, status, created_at, updated_at FROM segmentation_channels WHERE status <> 'deleted';

ALTER TABLE publishers DROP CONSTRAINT IF EXISTS publishers_channel_id_fkey;
UPDATE publishers p
   SET channel_id = pc.id
  FROM segmentation_channels sc
  JOIN partner_channels pc ON pc.network_id = sc.network_id AND lower(pc.name) = lower(sc.name)
 WHERE p.channel_id = sc.id AND p.network_id = sc.network_id;
UPDATE publishers p SET channel_id = NULL
 WHERE p.channel_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM partner_channels pc WHERE pc.id = p.channel_id);
ALTER TABLE publishers
  ADD CONSTRAINT publishers_channel_id_fkey
  FOREIGN KEY (channel_id) REFERENCES partner_channels(id) ON DELETE SET NULL;
