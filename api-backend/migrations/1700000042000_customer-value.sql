-- Customer Value (Customer Value › Custom Data Points / Payout & Revenue Rules / Conversion
-- Events Report) — tracks a customer's lifetime value across conversions via a `user_id` +
-- custom parameters passed on the postback (already captured verbatim in conversions.raw_params,
-- exactly like Everflow's own real developer integration: ?user_id=X&geo=Y&deposit=150).
-- Real enforcement, not just CRUD — see lib/customer-value/evaluate.ts, applied in
-- recordConversion() alongside the existing Postback Controls / Tiered Commissions rule engines.

-- Up Migration

CREATE TABLE customer_data_points (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id    uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name          text NOT NULL,
  data_type     text NOT NULL CHECK (data_type IN ('text', 'number')),
  parameter_key text NOT NULL,   -- the raw_params key this data point reads (e.g. "geo", "deposit")
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_data_points_network_idx ON customer_data_points (network_id);
CREATE UNIQUE INDEX customer_data_points_network_param_key ON customer_data_points (network_id, parameter_key);
CREATE TRIGGER trg_customer_data_points_updated_at BEFORE UPDATE ON customer_data_points
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE customer_value_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id            uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  ref                   bigserial,
  name                  text NOT NULL,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  conversion_event_grouping text NOT NULL DEFAULT 'all_together'
                        CHECK (conversion_event_grouping IN ('all_together', 'separately_by')),
  apply_offers_mode     text NOT NULL DEFAULT 'all' CHECK (apply_offers_mode IN ('all', 'specific')),
  apply_offer_ids       uuid[] NOT NULL DEFAULT '{}',
  apply_partners_mode   text NOT NULL DEFAULT 'all' CHECK (apply_partners_mode IN ('all', 'specific')),
  apply_partner_ids     uuid[] NOT NULL DEFAULT '{}',
  start_date            date,
  end_date              date,
  goal_cycle            text NOT NULL DEFAULT 'continuous' CHECK (goal_cycle IN ('recurring', 'continuous')),
  recurring_duration    text CHECK (recurring_duration IN ('daily', 'weekly', 'monthly', 'quarterly')),
  continuous_mode       text CHECK (continuous_mode IN ('from_first_conversion', 'for_rule_duration')),
  continuous_days       integer,
  set_goal_conditions   boolean NOT NULL DEFAULT false,
  conditions            jsonb NOT NULL DEFAULT '[]',  -- [{dataPointId, conditionLogic, operator, value}]
  outcome_frequency     text NOT NULL DEFAULT 'once_per_customer'
                        CHECK (outcome_frequency IN ('once_per_customer', 'every_cycle')),
  payout_type           text NOT NULL DEFAULT 'fixed' CHECK (payout_type IN ('fixed', 'revenue_share')),
  payout_value          numeric(14,4) NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_value_rules_network_idx ON customer_value_rules (network_id);
CREATE INDEX customer_value_rules_active_idx ON customer_value_rules (network_id, status, ref);
CREATE TRIGGER trg_customer_value_rules_updated_at BEFORE UPDATE ON customer_value_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per (rule, user_id) conversion that actually fired the rule's outcome — the real
-- dedup ledger for "Once per Customer" / "Every cycle" outcome frequency, and what the
-- Conversion Events Report joins against to show "which rules were applied".
CREATE TABLE customer_value_rule_firings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id    uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  rule_id       uuid NOT NULL REFERENCES customer_value_rules(id) ON DELETE CASCADE,
  user_id       text NOT NULL,
  conversion_id text NOT NULL,   -- conversions.conversion_id (public id)
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_value_rule_firings_network_idx ON customer_value_rule_firings (network_id);
CREATE INDEX customer_value_rule_firings_rule_user_idx ON customer_value_rule_firings (rule_id, user_id, created_at DESC);
CREATE INDEX customer_value_rule_firings_conversion_idx ON customer_value_rule_firings (network_id, conversion_id);

-- Down Migration

DROP TABLE IF EXISTS customer_value_rule_firings;
DROP TABLE IF EXISTS customer_value_rules;
DROP TABLE IF EXISTS customer_data_points;
