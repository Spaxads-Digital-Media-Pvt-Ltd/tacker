-- The Add/Edit Offer wizard has a required "Tracking Domain" field that was purely decorative
-- (a <select> with no options) — this gives it something real to bind to: the network's own
-- tracking_domains, already used elsewhere (link generation) but never referenced from the offer
-- record itself.

-- Up Migration
ALTER TABLE offers ADD COLUMN tracking_domain_id uuid REFERENCES tracking_domains(id) ON DELETE SET NULL;

-- Down Migration
ALTER TABLE offers DROP COLUMN IF EXISTS tracking_domain_id;
