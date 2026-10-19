-- Cap time zone (round 3): when a "day" starts for daily caps. Settings › General sets the network's
-- ("Daily caps reset at midnight in [zone]", networks.settings.general.capTimezone, default UTC);
-- an offer can override it — the advertiser who says "500 a day" counts that day in their own zone.
-- NULL = the network's. Weekly / monthly cap windows (Custom Settings) follow the same zone.

-- Up Migration

ALTER TABLE offers ADD COLUMN cap_timezone text;

-- Down Migration

ALTER TABLE offers DROP COLUMN IF EXISTS cap_timezone;
