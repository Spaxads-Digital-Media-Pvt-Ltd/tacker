-- Super Admin › a network's plan overrides — a deal that differs from its plan:
--
-- * price_cents — a custom price (in the plan's currency, per the plan's interval) instead of the plan's;
--   null = the plan's price. Used for every invoice the billing engine issues and for MRR.
-- * billing_exempt — never invoiced (a partner, an internal or a comped network); MRR 0.
-- * limits — per-limit overrides merged over the plan's (clicks / conversions / events per period, offers,
--   seats): a number replaces the plan's limit, null removes it (unlimited); a key left out keeps the plan's.
--
-- Platform-internal: not part of a network's data export (lib/networks/lifecycle.ts PLATFORM_ONLY_TABLES).

-- Up Migration

CREATE TABLE network_plan_overrides (
  network_id      uuid PRIMARY KEY REFERENCES networks(id) ON DELETE CASCADE,
  price_cents     integer CHECK (price_cents IS NULL OR price_cents >= 0),
  billing_exempt  boolean NOT NULL DEFAULT false,
  limits          jsonb NOT NULL DEFAULT '{}'::jsonb,
  note            text,
  updated_by      uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE IF EXISTS network_plan_overrides;
