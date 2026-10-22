-- Super Admin › staff security.
--
-- * platform_login_events — every platform sign-in attempt: who (when known), from where, and how it ended
--   (success, wrong password, unknown email, disabled, blocked address, two-factor failed / required).
-- * platform_sessions — one row per signed-in session (the token's jti): listed in Team › Your account,
--   revocable one by one or "everywhere"; the auth gate refuses a revoked or expired one.
-- * platform_notifications — the staff bell: a ticket for you, a customer's reply, a new lead, a task.
-- The IP allowlist lives in platform_settings 'security' { ipAllowlist: [...] }.

-- Up Migration

CREATE TABLE platform_login_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  email       text,
  ip          inet,
  user_agent  text,
  outcome     text NOT NULL CHECK (outcome IN ('success', 'bad_password', 'unknown_email', 'disabled', 'blocked_ip', 'mfa_required', 'mfa_failed', 'locked')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_login_events_admin_idx ON platform_login_events (admin_id, created_at DESC);
CREATE INDEX platform_login_events_created_idx ON platform_login_events (created_at DESC);

CREATE TABLE platform_sessions (
  id            uuid PRIMARY KEY,
  admin_id      uuid NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  revoked_by    uuid REFERENCES platform_admins(id) ON DELETE SET NULL
);
CREATE INDEX platform_sessions_admin_idx ON platform_sessions (admin_id, created_at DESC);

CREATE TABLE platform_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_notifications_admin_idx ON platform_notifications (admin_id, read_at, created_at DESC);

-- Down Migration

DROP TABLE IF EXISTS platform_notifications;
DROP TABLE IF EXISTS platform_sessions;
DROP TABLE IF EXISTS platform_login_events;
