-- Offer objective + visibility (Everflow/Spaxads "Create Offer": objective picker + public/private).
-- Objective is a soft filter label; visibility gates who can see/request the offer.

-- Up Migration
ALTER TABLE offers ADD COLUMN objective text NOT NULL DEFAULT 'conversions'
  CHECK (objective IN ('conversions', 'sale', 'app_installs', 'leads', 'impressions', 'clicks'));
ALTER TABLE offers ADD COLUMN visibility text NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'private', 'ask'));
ALTER TABLE offers ADD COLUMN category text;
ALTER TABLE offers ADD COLUMN preview_url text;

-- Down Migration
ALTER TABLE offers DROP COLUMN IF EXISTS preview_url;
ALTER TABLE offers DROP COLUMN IF EXISTS category;
ALTER TABLE offers DROP COLUMN IF EXISTS visibility;
ALTER TABLE offers DROP COLUMN IF EXISTS objective;
