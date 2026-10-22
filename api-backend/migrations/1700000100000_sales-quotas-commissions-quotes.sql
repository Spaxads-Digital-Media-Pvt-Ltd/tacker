-- Super Admin › Sales, round 2: quotas, commissions and quotes.
--
-- * sales_quotas — a salesperson's target of new MRR won in a month, per currency (attainment = the
--   expected MRR of the leads they won that month, sales_leads.won_at UTC).
-- * sales_comp_plans — a salesperson's commission: a % of what the networks they sold
--   (networks.sales_owner_id) PAY (paid platform invoices), optionally only for the first N months after
--   the deal was won. Monthly statements are computed from the invoices; nothing is stored per month.
-- * sales_quotes — a priced proposal for a lead (lines, discount %, tax %, billing interval, valid until):
--   draft → sent (emailed with a private link) → accepted / declined by the prospect on that page (or
--   marked by staff). "Expired" is derived: sent and past valid_until. Money is numeric here, text in the API.
--
-- Platform-internal: none of this is part of a network's data export (no networks FK).

-- Up Migration

CREATE TABLE sales_quotas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  month       date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  currency    text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  target      numeric(14, 2) NOT NULL CHECK (target >= 0),
  updated_by  uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (admin_id, month, currency)
);
CREATE INDEX sales_quotas_month_idx ON sales_quotas (month);
CREATE TRIGGER trg_sales_quotas_updated_at BEFORE UPDATE ON sales_quotas FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sales_comp_plans (
  admin_id           uuid PRIMARY KEY REFERENCES platform_admins(id) ON DELETE CASCADE,
  commission_pct     numeric(5, 2) NOT NULL DEFAULT 0 CHECK (commission_pct >= 0 AND commission_pct <= 100),
  commission_months  integer CHECK (commission_months IS NULL OR commission_months BETWEEN 1 AND 120),
  updated_by         uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE sales_quote_number_seq START 1001;
CREATE TABLE sales_quotes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number            bigint NOT NULL UNIQUE DEFAULT nextval('sales_quote_number_seq'),
  lead_id           uuid NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  title             text NOT NULL,
  currency          text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  lines             jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal          numeric(14, 2) NOT NULL CHECK (subtotal >= 0),
  discount_pct      numeric(5, 2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  discount          numeric(14, 2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax_rate          numeric(5, 2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  tax               numeric(14, 2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total             numeric(14, 2) NOT NULL CHECK (total >= 0),
  billing_interval  text NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('month', 'year', 'once')),
  notes             text,
  terms             text,
  valid_until       date NOT NULL,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'declined')),
  public_token      text NOT NULL UNIQUE,
  sent_at           timestamptz,
  sent_to           text,
  viewed_at         timestamptz,
  responded_at      timestamptz,
  responder_name    text,
  decline_reason    text,
  created_by        uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_quotes_lead_idx ON sales_quotes (lead_id, created_at DESC);
CREATE INDEX sales_quotes_status_idx ON sales_quotes (status, created_at DESC);
CREATE TRIGGER trg_sales_quotes_updated_at BEFORE UPDATE ON sales_quotes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A quote sent / accepted / declined lands on the lead's timeline.
ALTER TABLE sales_activities DROP CONSTRAINT sales_activities_kind_check;
ALTER TABLE sales_activities ADD CONSTRAINT sales_activities_kind_check
  CHECK (kind IN ('note', 'call', 'email', 'meeting', 'stage', 'owner', 'created', 'converted', 'inbound', 'task', 'quote'));

-- Down Migration

DELETE FROM sales_activities WHERE kind = 'quote';
ALTER TABLE sales_activities DROP CONSTRAINT sales_activities_kind_check;
ALTER TABLE sales_activities ADD CONSTRAINT sales_activities_kind_check
  CHECK (kind IN ('note', 'call', 'email', 'meeting', 'stage', 'owner', 'created', 'converted', 'inbound', 'task'));
DROP TABLE IF EXISTS sales_quotes;
DROP SEQUENCE IF EXISTS sales_quote_number_seq;
DROP TABLE IF EXISTS sales_comp_plans;
DROP TABLE IF EXISTS sales_quotas;
