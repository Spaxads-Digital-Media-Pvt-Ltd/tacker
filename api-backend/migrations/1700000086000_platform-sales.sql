-- Super Admin › Sales: the platform's own pipeline of prospective tenant networks (what Trackier, Everflow
-- and Voluum's sales teams run in their CRM). A lead moves through stages to won — converted into a network
-- with an owner login and a trial — or lost (with the reason). Each lead keeps a timeline (notes, calls,
-- emails, meetings, stage and owner changes). Tasks are shared by the platform team's panels (sales,
-- customer success, support, billing): a title, a due date, an assignee, optionally about a lead or a network.
--
-- Platform-internal: these rows are never part of a network's data export (lib/networks/lifecycle.ts).
-- Money: expected_mrr is numeric here and text in the API.

-- Up Migration

CREATE TABLE sales_leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company           text NOT NULL,
  contact_name      text,
  email             text,
  phone             text,
  website           text,
  country           text,
  source            text NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('website', 'referral', 'event', 'outbound', 'partner', 'inbound', 'manual', 'other')),
  stage             text NOT NULL DEFAULT 'new'
                    CHECK (stage IN ('new', 'contacted', 'qualified', 'demo', 'trial', 'negotiation', 'won', 'lost')),
  owner_id          uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  plan_id           uuid REFERENCES subscription_plans(id) ON DELETE SET NULL,
  expected_mrr      numeric(14, 2) CHECK (expected_mrr IS NULL OR expected_mrr >= 0),
  currency          text NOT NULL DEFAULT 'USD',
  monthly_clicks    bigint CHECK (monthly_clicks IS NULL OR monthly_clicks >= 0),
  tags              text[] NOT NULL DEFAULT '{}',
  notes             text,
  message           text,
  next_step         text,
  next_step_at      timestamptz,
  lost_reason       text,
  network_id        uuid REFERENCES networks(id) ON DELETE SET NULL,
  stage_changed_at  timestamptz NOT NULL DEFAULT now(),
  won_at            timestamptz,
  lost_at           timestamptz,
  created_by        uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_leads_stage_idx ON sales_leads (stage, updated_at DESC);
CREATE INDEX sales_leads_owner_idx ON sales_leads (owner_id) WHERE owner_id IS NOT NULL;
CREATE UNIQUE INDEX sales_leads_network_idx ON sales_leads (network_id) WHERE network_id IS NOT NULL;
CREATE INDEX sales_leads_email_idx ON sales_leads (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX sales_leads_created_idx ON sales_leads (created_at DESC);
CREATE TRIGGER trg_sales_leads_updated_at BEFORE UPDATE ON sales_leads FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sales_activities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('note', 'call', 'email', 'meeting', 'stage', 'owner', 'created', 'converted', 'inbound', 'task')),
  body        text,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id    uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_activities_lead_idx ON sales_activities (lead_id, created_at DESC);
CREATE INDEX sales_activities_created_idx ON sales_activities (created_at DESC);

CREATE TABLE platform_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  notes         text,
  kind          text NOT NULL DEFAULT 'other' CHECK (kind IN ('sales', 'success', 'support', 'billing', 'other')),
  priority      text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  due_at        timestamptz,
  assignee_id   uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  lead_id       uuid REFERENCES sales_leads(id) ON DELETE CASCADE,
  network_id    uuid REFERENCES networks(id) ON DELETE CASCADE,
  completed_at  timestamptz,
  completed_by  uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_by    uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_tasks_assignee_idx ON platform_tasks (assignee_id, status, due_at);
CREATE INDEX platform_tasks_lead_idx ON platform_tasks (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX platform_tasks_network_idx ON platform_tasks (network_id) WHERE network_id IS NOT NULL;
CREATE TRIGGER trg_platform_tasks_updated_at BEFORE UPDATE ON platform_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS platform_tasks;
DROP TABLE IF EXISTS sales_activities;
DROP TABLE IF EXISTS sales_leads;
