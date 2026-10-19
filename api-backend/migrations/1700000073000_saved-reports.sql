-- Saved reports on the server (audit F-24): a report page's saved configuration, owned by the dashboard
-- user who saved it (the browser's localStorage stays a cache), optionally scheduled — a 5-field cron
-- in the network's time zone — and emailed to recipients by the scheduled-reports worker.

-- Up Migration

CREATE TABLE saved_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id       uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  owner_user_id    text NOT NULL,
  page             text NOT NULL,
  name             text NOT NULL,
  config           jsonb NOT NULL DEFAULT '{}'::jsonb,
  schedule         text,
  range_preset     text NOT NULL DEFAULT 'yesterday'
                   CHECK (range_preset IN ('yesterday', 'last_7_days', 'last_30_days', 'month_to_date', 'last_month')),
  recipients       text[] NOT NULL DEFAULT '{}',
  next_run_at      timestamptz,
  last_run_at      timestamptz,
  last_run_status  text CHECK (last_run_status IN ('sent', 'skipped', 'failed')),
  last_run_detail  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (network_id, owner_user_id, page, name)
);
CREATE INDEX saved_reports_owner_idx ON saved_reports (network_id, owner_user_id, page);
CREATE INDEX saved_reports_due_idx ON saved_reports (next_run_at) WHERE schedule IS NOT NULL;
CREATE TRIGGER trg_saved_reports_updated_at BEFORE UPDATE ON saved_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS saved_reports;
