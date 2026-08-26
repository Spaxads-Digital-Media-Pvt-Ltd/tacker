-- Offer Templates were storing only which fields to pre-fill (offer_fields: string[]), not what
-- to pre-fill them WITH — so "Add Offer from Template" (Everflow's Manage Offers > Table Actions)
-- had nothing to actually populate. field_values carries the snapshot of real offer field values
-- (advertiserId, category, currency, payoutModel, defaultPayout, defaultRevenue, visibility,
-- destinationUrl) the template was built from; offer_fields becomes derived (its keys).

-- Up Migration
ALTER TABLE offer_templates ADD COLUMN field_values jsonb NOT NULL DEFAULT '{}';

-- Down Migration
ALTER TABLE offer_templates DROP COLUMN IF EXISTS field_values;
