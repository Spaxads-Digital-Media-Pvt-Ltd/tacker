-- Super Admin › Customer success: what the platform team knows about each customer network — beyond its own
-- data. A health score (0–100) recomputed by the workers (and on demand) from usage, its trend, sign-ins,
-- billing and onboarding, with the parts it was made from; its daily history; the onboarding milestones the
-- network reached; tags (enterprise, VIP…); and the team's notes about it. The account manager is
-- networks.account_manager_id (migration 085).
--
-- Platform-internal: never part of a network's export (lib/networks/lifecycle.ts PLATFORM_ONLY_TABLES).

-- Up Migration

CREATE TABLE network_accounts (
  network_id         uuid PRIMARY KEY REFERENCES networks(id) ON DELETE CASCADE,
  tags               text[] NOT NULL DEFAULT '{}',
  health_score       integer CHECK (health_score IS NULL OR health_score BETWEEN 0 AND 100),
  health_status      text CHECK (health_status IS NULL OR health_status IN ('healthy', 'attention', 'at_risk')),
  health_components  jsonb NOT NULL DEFAULT '{}'::jsonb,
  health_signals     jsonb NOT NULL DEFAULT '{}'::jsonb,
  onboarding         jsonb NOT NULL DEFAULT '{}'::jsonb,
  onboarding_pct     integer CHECK (onboarding_pct IS NULL OR onboarding_pct BETWEEN 0 AND 100),
  health_computed_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX network_accounts_status_idx ON network_accounts (health_status, health_score);
CREATE TRIGGER trg_network_accounts_updated_at BEFORE UPDATE ON network_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE network_health_history (
  network_id  uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  day         date NOT NULL,
  score       integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  status      text NOT NULL,
  PRIMARY KEY (network_id, day)
);

CREATE TABLE network_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id  uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  body        text NOT NULL,
  pinned      boolean NOT NULL DEFAULT false,
  author_id   uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX network_notes_network_idx ON network_notes (network_id, pinned DESC, created_at DESC);
CREATE TRIGGER trg_network_notes_updated_at BEFORE UPDATE ON network_notes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS network_notes;
DROP TABLE IF EXISTS network_health_history;
DROP TABLE IF EXISTS network_accounts;
