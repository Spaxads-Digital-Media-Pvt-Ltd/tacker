-- Platform layer (spec §3C) — ABOVE all tenants. platform_admins + subscription_plans are
-- global (no network_id). subscriptions + usage_records are per-network (network_id).

-- Up Migration
CREATE TABLE platform_admins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid,                       -- Supabase Auth user (sub) for the platform login
  email         text NOT NULL,
  name          text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX platform_admins_email_key ON platform_admins (lower(email));
CREATE UNIQUE INDEX platform_admins_auth_user_id_key ON platform_admins (auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE TRIGGER trg_platform_admins_updated_at BEFORE UPDATE ON platform_admins
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE subscription_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL,              -- e.g. 'starter', 'growth', 'enterprise'
  name          text NOT NULL,
  price_cents   integer NOT NULL DEFAULT 0, -- money as integer minor units (never float)
  currency      text NOT NULL DEFAULT 'USD',
  -- Entitlements/limits (spec §3C): clicks/mo, offers, seats, api_rate_tier, etc.
  limits        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX subscription_plans_code_key ON subscription_plans (code);
CREATE TRIGGER trg_subscription_plans_updated_at BEFORE UPDATE ON subscription_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id    uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  plan_id       uuid NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  status        text NOT NULL DEFAULT 'trialing'
                CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
  current_period_start timestamptz,
  current_period_end   timestamptz,
  renews_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- One live subscription per network (history kept via status, not extra rows).
CREATE UNIQUE INDEX subscriptions_network_key ON subscriptions (network_id);
CREATE INDEX subscriptions_plan_idx ON subscriptions (plan_id);
CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE usage_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id    uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  metric        text NOT NULL CHECK (metric IN ('clicks', 'conversions', 'api_calls', 'storage')),
  value         bigint NOT NULL DEFAULT 0,
  period_date   date NOT NULL,              -- daily bucket for metering/billing
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- One row per network/metric/day; upserts increment value.
CREATE UNIQUE INDEX usage_records_key ON usage_records (network_id, metric, period_date);
CREATE INDEX usage_records_network_period_idx ON usage_records (network_id, period_date);

-- Down Migration
DROP TABLE IF EXISTS usage_records;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS subscription_plans;
DROP TABLE IF EXISTS platform_admins;
