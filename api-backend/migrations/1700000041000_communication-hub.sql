-- Communication Hub (spec feature-depth) — mirrors the live reference's Communication Hub:
-- Email Messages (real send via the network's own SMTP settings, previously unused),
-- Partner Banners (real display on the Publisher portal), Audiences (saved recipient
-- filters over the real publishers/advertisers tables), and Email Templates (reusable
-- subject/body pairs). Every table is tenant-scoped by network_id (spec §3A).

-- Up Migration

CREATE TABLE email_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id    uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name          text NOT NULL,
  message_type  text NOT NULL DEFAULT 'general' CHECK (message_type IN ('general', 'offer_details')),
  subject       text NOT NULL,
  body          text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_templates_network_idx ON email_templates (network_id);
CREATE TRIGGER trg_email_templates_updated_at BEFORE UPDATE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE audiences (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id    uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name          text NOT NULL,
  group_type    text NOT NULL CHECK (group_type IN ('publishers', 'advertisers')),
  status_filter text[] NOT NULL DEFAULT '{}',   -- subset of ('active','pending','inactive'); empty = any status
  tier_id       uuid REFERENCES partner_tiers(id) ON DELETE SET NULL,  -- publishers only
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audiences_network_idx ON audiences (network_id);
CREATE TRIGGER trg_audiences_updated_at BEFORE UPDATE ON audiences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE email_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id        uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  subject           text NOT NULL,
  body              text NOT NULL DEFAULT '',
  message_type      text NOT NULL DEFAULT 'general' CHECK (message_type IN ('general', 'offer_details')),
  audience_id       uuid REFERENCES audiences(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sent')),
  scheduled_at      timestamptz,
  sent_at           timestamptz,
  recipient_count   integer NOT NULL DEFAULT 0,
  send_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_messages_network_idx ON email_messages (network_id);
CREATE INDEX email_messages_network_status_idx ON email_messages (network_id, status);
CREATE TRIGGER trg_email_messages_updated_at BEFORE UPDATE ON email_messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE banners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id    uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name          text NOT NULL,
  message       text NOT NULL DEFAULT '',
  priority      text NOT NULL DEFAULT 'default' CHECK (priority IN ('default', 'high')),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published', 'expired')),
  publish_at    timestamptz,
  expire_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX banners_network_idx ON banners (network_id);
CREATE INDEX banners_network_status_idx ON banners (network_id, status);
CREATE TRIGGER trg_banners_updated_at BEFORE UPDATE ON banners
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE IF EXISTS banners;
DROP TABLE IF EXISTS email_messages;
DROP TABLE IF EXISTS audiences;
DROP TABLE IF EXISTS email_templates;
