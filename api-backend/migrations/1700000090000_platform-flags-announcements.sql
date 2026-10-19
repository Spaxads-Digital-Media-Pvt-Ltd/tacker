-- Super Admin › Platform: feature flags and announcements.
--
-- * platform_feature_flags — turn a tenant feature on or off per network: for everyone, for a % of networks
--   (a stable rollout — the same networks stay in as it grows), for networks on given plans, for listed
--   networks (or never for listed ones), and a kill switch that turns it off for everyone at once. A feature
--   with no flag is on (lib/platform/flags.ts); the gateable ones are also refused by the API when off.
-- * platform_announcements — news, warnings and maintenance windows shown as a banner in tenant dashboards
--   (staff and, if chosen, partner / advertiser portals): for all networks, networks on given plans, or
--   listed networks; from / until; dismissible or not. Dismissals are per person.

-- Up Migration

CREATE TABLE platform_feature_flags (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key              text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{1,49}$'),
  name             text NOT NULL,
  description      text,
  enabled          boolean NOT NULL DEFAULT false,
  rollout_percent  integer NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  plan_ids         uuid[] NOT NULL DEFAULT '{}',
  network_ids_on   uuid[] NOT NULL DEFAULT '{}',
  network_ids_off  uuid[] NOT NULL DEFAULT '{}',
  kill_switch      boolean NOT NULL DEFAULT false,
  created_by       uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  updated_by       uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_platform_feature_flags_updated_at BEFORE UPDATE ON platform_feature_flags FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE platform_announcements (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                  text NOT NULL,
  body                   text NOT NULL,
  kind                   text NOT NULL DEFAULT 'info' CHECK (kind IN ('info', 'success', 'warning', 'critical', 'maintenance')),
  audience               text NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'plans', 'networks')),
  plan_ids               uuid[] NOT NULL DEFAULT '{}',
  network_ids            uuid[] NOT NULL DEFAULT '{}',
  roles                  text[] NOT NULL DEFAULT '{admin}' CHECK (roles <@ ARRAY['admin', 'publisher', 'advertiser']::text[] AND cardinality(roles) > 0),
  starts_at              timestamptz NOT NULL DEFAULT now(),
  ends_at                timestamptz,
  maintenance_starts_at  timestamptz,
  maintenance_ends_at    timestamptz,
  dismissible            boolean NOT NULL DEFAULT true,
  link_url               text,
  link_label             text,
  status                 text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at           timestamptz,
  created_by             uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (kind <> 'maintenance' OR (maintenance_starts_at IS NOT NULL AND maintenance_ends_at > maintenance_starts_at))
);
CREATE INDEX platform_announcements_live_idx ON platform_announcements (status, starts_at, ends_at);
CREATE TRIGGER trg_platform_announcements_updated_at BEFORE UPDATE ON platform_announcements FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE platform_announcement_dismissals (
  announcement_id  uuid NOT NULL REFERENCES platform_announcements(id) ON DELETE CASCADE,
  user_key         text NOT NULL,
  network_id       uuid,
  dismissed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_key)
);

-- Down Migration

DROP TABLE IF EXISTS platform_announcement_dismissals;
DROP TABLE IF EXISTS platform_announcements;
DROP TABLE IF EXISTS platform_feature_flags;
