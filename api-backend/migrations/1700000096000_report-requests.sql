-- Reporting › Saved & Scheduled › Requested Reports: report files built in the background — an export a
-- user asks for (a saved report over a chosen range), or the whole file of a scheduled report too big to
-- email (the email carries the first rows). The CSV is stored gzipped here, never in a public bucket: it
-- holds the network's business data and is downloaded through the authenticated API only. Pruned after
-- 30 days by the retention job.

-- Up Migration

CREATE TABLE report_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref             bigint GENERATED ALWAYS AS IDENTITY,
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  -- The dashboard login that asked for it (saved_reports.owner_user_id for a scheduled one).
  requested_by    text NOT NULL,
  saved_report_id uuid REFERENCES saved_reports(id) ON DELETE SET NULL,
  name            text NOT NULL,
  page            text NOT NULL,
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  range_from      text NOT NULL,
  range_to        text,
  range_label     text NOT NULL,
  source          text NOT NULL CHECK (source IN ('manual', 'scheduled')),
  format          text NOT NULL DEFAULT 'csv' CHECK (format IN ('csv')),
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'done', 'failed')),
  row_count       integer,
  -- Groups the report had before metric filters; truncated = more than the file holds.
  total_rows      integer,
  truncated       boolean NOT NULL DEFAULT false,
  file            bytea,
  file_bytes      integer,
  error           text,
  started_at      timestamptz,
  processed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX report_requests_ref_idx ON report_requests (ref);
CREATE INDEX report_requests_owner_idx ON report_requests (network_id, requested_by, created_at DESC);
CREATE INDEX report_requests_status_idx ON report_requests (status, created_at) WHERE status IN ('queued', 'processing');

-- Down Migration

DROP TABLE IF EXISTS report_requests;
