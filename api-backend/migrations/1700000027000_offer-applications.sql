-- Up Migration

-- Manage Applications (Partners › Offer Applications): approval workflow on top of the existing
-- offer_publisher_access grants (a Partner applying to a gated Offer), plus a reusable
-- Questionnaire builder an Offer can require applicants to fill out.
CREATE TABLE questionnaires (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id  uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX questionnaires_network_idx ON questionnaires (network_id);
CREATE TRIGGER trg_questionnaires_updated_at BEFORE UPDATE ON questionnaires
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE questionnaire_fields (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id       uuid NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  questionnaire_id uuid NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
  position         int NOT NULL DEFAULT 0,
  label            text NOT NULL,
  required         boolean NOT NULL DEFAULT false,
  tooltip          text,
  data_field       text NOT NULL CHECK (data_field IN ('checkbox', 'date_input', 'input', 'numeric_input', 'select', 'textarea')),
  options          text[],
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX questionnaire_fields_q_idx ON questionnaire_fields (questionnaire_id, position);

-- An Offer optionally requires one Questionnaire to be filled out when a Partner applies.
ALTER TABLE offers ADD COLUMN questionnaire_id uuid REFERENCES questionnaires(id);

-- Submitted answers for an application (keyed by questionnaire_fields.id).
ALTER TABLE offer_publisher_access ADD COLUMN answers jsonb;

-- Down Migration

ALTER TABLE offer_publisher_access DROP COLUMN IF EXISTS answers;
ALTER TABLE offers DROP COLUMN IF EXISTS questionnaire_id;
DROP TABLE IF EXISTS questionnaire_fields;
DROP TABLE IF EXISTS questionnaires;
