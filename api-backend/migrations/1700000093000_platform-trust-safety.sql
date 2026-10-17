-- Super Admin › Trust & safety.
--
-- * platform_blocklist — addresses, user agents and referrer domains the platform blocks for EVERY network:
--   /click rejects them (reason 'platform_blocked') before any network's own rules. An IP entry is an address,
--   a CIDR, or a from–to range (value_to); a user-agent entry is a phrase the user agent contains; a referrer
--   entry is a domain (and its subdomains). Optional expiry. Cached in Redis + memoized in-process like the
--   network IP lists (lib/platform/blocklist.ts), so the click path never waits on Postgres for it.
-- * platform_fraud_ips — what the hourly trust scan found: addresses sending flagged or rejected clicks to
--   more than one network in the last 24 hours (only the platform sees across networks). Replaced each run.
-- * privacy_requests — GDPR / CCPA requests (erasure or access) about a person identified by an IP, a click
--   id, a sub id value or an email, for one network or all; due 30 days (GDPR) / 45 days (CCPA) after receipt.
--   An erasure clears the personal fields of the matching clicks / conversions (never amounts); the subject is
--   masked once the request is done (its hash stays for the record).
-- * The 'trust' permission section for the built-in roles, and a built-in Trust & Safety role.

-- Up Migration

CREATE TABLE platform_blocklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('ip', 'user_agent', 'referrer')),
  value text NOT NULL,
  value_to text,
  reason text,
  expires_at timestamptz,
  created_by uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX platform_blocklist_entry ON platform_blocklist (kind, lower(value), COALESCE(value_to, ''));

CREATE TABLE platform_fraud_ips (
  ip text PRIMARY KEY,
  network_ids uuid[] NOT NULL,
  clicks integer NOT NULL,
  flagged integer NOT NULL,
  avg_score integer NOT NULL,
  top_flags text[] NOT NULL DEFAULT '{}',
  first_seen timestamptz NOT NULL,
  last_seen timestamptz NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE privacy_request_number_seq START 1001;
CREATE TABLE privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigint NOT NULL DEFAULT nextval('privacy_request_number_seq') UNIQUE,
  network_id uuid REFERENCES networks(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('erasure', 'access')),
  regulation text NOT NULL DEFAULT 'gdpr' CHECK (regulation IN ('gdpr', 'ccpa', 'other')),
  subject_type text NOT NULL CHECK (subject_type IN ('ip', 'click_id', 'sub_id', 'email')),
  subject text NOT NULL,
  subject_hash text NOT NULL,
  requester_email text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'completed', 'rejected')),
  received_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  notes text,
  result jsonb,
  assignee_id uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_by uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX privacy_requests_open ON privacy_requests (due_at) WHERE status IN ('new', 'in_progress');
CREATE TRIGGER trg_privacy_requests_updated_at BEFORE UPDATE ON privacy_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The new section on the built-in roles (custom roles start without it — 'none' — until an Owner grants it).
UPDATE platform_roles SET permissions = permissions || '{"trust": "full"}'::jsonb WHERE key IN ('owner', 'admin');
UPDATE platform_roles SET permissions = permissions || '{"trust": "read"}'::jsonb WHERE key IN ('support', 'read_only');
UPDATE platform_roles SET permissions = permissions || '{"trust": "none"}'::jsonb WHERE key IN ('sales', 'account_manager', 'finance');

INSERT INTO platform_roles (id, key, name, description, scope, home, is_system, permissions) VALUES
('00000000-0000-4000-a000-000000000008', 'trust_safety', 'Trust & Safety', 'Fraud across networks, the platform blocklist and privacy requests.', 'all', '/admin/trust', true,
 '{"dashboard":"read","networks":"read","access":"none","sales":"none","success":"read","support":"read","billing":"none","plans":"none","revenue":"none","comms":"none","platform":"read","team":"none","settings":"none","activity":"read","trust":"full"}');

-- Down Migration

DELETE FROM platform_roles WHERE id = '00000000-0000-4000-a000-000000000008';
UPDATE platform_roles SET permissions = permissions - 'trust';
DROP TABLE IF EXISTS privacy_requests;
DROP SEQUENCE IF EXISTS privacy_request_number_seq;
DROP TABLE IF EXISTS platform_fraud_ips;
DROP TABLE IF EXISTS platform_blocklist;
