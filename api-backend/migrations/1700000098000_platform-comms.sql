-- Super Admin › Comms: what the platform team tells its customers.
--
-- * help_articles — the help center (markdown), per audience: everyone, network staff, partners or
--   advertisers; published ones show in the app's Help (search + categories).
-- * changelog_entries — "What's new": new / improved / fixed, published with a date.
-- * status_components / status_incidents / status_incident_updates — the public status page (/status):
--   each component's state, incidents with their timeline, scheduled maintenance.
-- * platform_broadcasts — an email to network teams picked by role, plan and network status (drafted,
--   previewed with its recipient count, sent once through the platform email queue).
-- All platform-level (no network_id).

-- Up Migration

CREATE TABLE help_articles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title        text NOT NULL,
  category     text NOT NULL DEFAULT 'General',
  body         text NOT NULL DEFAULT '',
  audience     text NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'staff', 'partner', 'advertiser')),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  position     integer NOT NULL DEFAULT 0,
  views        integer NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX help_articles_published_idx ON help_articles (status, category, position);
CREATE TRIGGER trg_help_articles_updated_at BEFORE UPDATE ON help_articles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE changelog_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  body         text NOT NULL DEFAULT '',
  kind         text NOT NULL DEFAULT 'new' CHECK (kind IN ('new', 'improved', 'fixed')),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at timestamptz,
  created_by   uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX changelog_entries_published_idx ON changelog_entries (status, published_at DESC);
CREATE TRIGGER trg_changelog_entries_updated_at BEFORE UPDATE ON changelog_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE status_components (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  position    integer NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'operational'
              CHECK (status IN ('operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_status_components_updated_at BEFORE UPDATE ON status_components FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE status_incidents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  impact        text NOT NULL DEFAULT 'minor' CHECK (impact IN ('none', 'minor', 'major', 'critical', 'maintenance')),
  status        text NOT NULL DEFAULT 'investigating'
                CHECK (status IN ('scheduled', 'investigating', 'identified', 'monitoring', 'resolved')),
  component_ids uuid[] NOT NULL DEFAULT '{}',
  starts_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  created_by    uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX status_incidents_open_idx ON status_incidents (status, starts_at DESC);
CREATE TRIGGER trg_status_incidents_updated_at BEFORE UPDATE ON status_incidents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE status_incident_updates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES status_incidents(id) ON DELETE CASCADE,
  status      text NOT NULL CHECK (status IN ('scheduled', 'investigating', 'identified', 'monitoring', 'resolved')),
  body        text NOT NULL,
  created_by  uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX status_incident_updates_incident_idx ON status_incident_updates (incident_id, created_at DESC);

CREATE TABLE platform_broadcasts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject     text NOT NULL,
  body        text NOT NULL,
  -- { roles: ['admin', ...], planIds: [...], networkStatuses: ['active', ...] } — empty list = any.
  audience    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'sent')),
  recipients  integer,
  sent_at     timestamptz,
  created_by  uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_platform_broadcasts_updated_at BEFORE UPDATE ON platform_broadcasts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS platform_broadcasts;
DROP TABLE IF EXISTS status_incident_updates;
DROP TABLE IF EXISTS status_incidents;
DROP TABLE IF EXISTS status_components;
DROP TABLE IF EXISTS changelog_entries;
DROP TABLE IF EXISTS help_articles;
