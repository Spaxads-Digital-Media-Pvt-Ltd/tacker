-- Investigator — saved click/conversion lookups by sub ID, transaction ID, click ID, or partner.
-- Results are computed on read from real clicks/conversions tables (no separate results store).

-- Up Migration

CREATE TABLE investigations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  ref             bigserial,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  target_type     text NOT NULL CHECK (target_type IN ('sub_id', 'transaction_id', 'click_id', 'partner')),
  target_value    text,
  sub_field       text CHECK (sub_field IN ('sub1', 'sub2', 'sub3', 'sub4', 'sub5')),
  publisher_id    uuid,
  entry_count     integer NOT NULL DEFAULT 0,
  suspect_count   integer NOT NULL DEFAULT 0,
  offer_count     integer NOT NULL DEFAULT 0,
  partner_count   integer NOT NULL DEFAULT 0,
  file_name       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investigations_sub_target CHECK (
    target_type <> 'sub_id' OR (sub_field IS NOT NULL AND target_value IS NOT NULL AND target_value <> '')
  ),
  CONSTRAINT investigations_value_target CHECK (
    target_type IN ('sub_id', 'partner') OR (target_value IS NOT NULL AND target_value <> '')
  ),
  CONSTRAINT investigations_partner_target CHECK (
    target_type <> 'partner' OR publisher_id IS NOT NULL
  )
);
CREATE INDEX investigations_network_idx ON investigations (network_id, created_at DESC);
CREATE INDEX investigations_ref_idx ON investigations (network_id, ref);
CREATE TRIGGER trg_investigations_updated_at BEFORE UPDATE ON investigations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS investigations;
