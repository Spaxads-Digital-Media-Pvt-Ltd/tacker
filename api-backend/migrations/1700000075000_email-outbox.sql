-- Email outbox (O11): every email the platform sends — invites, password resets, invoices, partner
-- notifications — is one row per recipient here, then a job on the `email` queue. The email worker
-- sends it through the network's SMTP and retries with backoff; the row records the outcome
-- (Communication Hub › Email log). Bodies of emails that carry a credential (a temporary password, a
-- reset link) are stored encrypted (enc:v1, lib/crypto/secret-box.ts) and wiped once sent.

-- Up Migration

CREATE TABLE email_outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id  uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  event       text NOT NULL,
  recipient   text NOT NULL,
  subject     text NOT NULL,
  html        text NOT NULL,
  sensitive   boolean NOT NULL DEFAULT false,
  attachments jsonb,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);

CREATE INDEX email_outbox_network_created_idx ON email_outbox (network_id, created_at DESC);
CREATE INDEX email_outbox_network_status_idx ON email_outbox (network_id, status, created_at DESC);

CREATE TRIGGER email_outbox_set_updated_at BEFORE UPDATE ON email_outbox
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE email_outbox;
