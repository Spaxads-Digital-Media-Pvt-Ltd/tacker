-- Up Migration

-- Manage Custom Metrics (Reporting › Custom Reporting Metrics): user-defined derived metrics built
-- from a whitelisted set of this app's real base report metrics (clicks, conversions, payout,
-- revenue, ...) combined with +-*/ and parenthesized constants — evaluated client-side by the
-- reporting UI, not persisted as computed values. `formula` is an ordered array of tokens
-- ({type:'metric',key} | {type:'op',value} | {type:'const',value}), validated server-side against
-- the same whitelist so a formula can never reference a metric this schema doesn't actually have.
CREATE TABLE custom_metrics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id  uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  ref         bigserial,
  name        text NOT NULL,
  formula     jsonb NOT NULL DEFAULT '[]',
  format      text NOT NULL DEFAULT 'number' CHECK (format IN ('number', 'percentage', 'currency')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX custom_metrics_network_idx ON custom_metrics (network_id);
CREATE UNIQUE INDEX custom_metrics_ref_idx ON custom_metrics (ref);
CREATE TRIGGER trg_custom_metrics_updated_at BEFORE UPDATE ON custom_metrics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS custom_metrics;
