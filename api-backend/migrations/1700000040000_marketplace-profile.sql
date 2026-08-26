-- Up Migration

-- Marketplace › Your Profile(s): one editable "how this network presents itself" profile per
-- network — verified against the live reference (Marketplace flyout's real
-- `href="/everxchange/profiles"`; Edit form at `/everxchange/profiles/partner/edit`). Everflow's own
-- version is how ONE network presents itself to every OTHER network on its cross-tenant EverXchange
-- directory; this app is single-tenant, so there's no other network to be discovered by — but the
-- profile's own fields (name/logo/description/categories/payout types/promo methods/device types/
-- geolocations/website/contact/social links) are genuinely real, editable data, and (matching the
-- honest-substitution precedent already used for Discover Advertisers, which lists this network's own
-- real Advertisers rather than fabricated third-party companies) this network's own profile is what
-- would show if it had somewhere to be listed — one row per network, editable by any network admin.
CREATE TABLE marketplace_profiles (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id             uuid NOT NULL UNIQUE REFERENCES networks(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  description            text,
  logo_url               text,
  categories_mode        text NOT NULL DEFAULT 'targeted' CHECK (categories_mode IN ('targeted', 'all')),
  categories             jsonb NOT NULL DEFAULT '[]',
  conversion_funnel_expertise jsonb NOT NULL DEFAULT '[]',
  promotional_methods    jsonb NOT NULL DEFAULT '[]',
  payout_types_accepted  jsonb NOT NULL DEFAULT '[]',
  device_types_covered   jsonb NOT NULL DEFAULT '[]',
  geolocations_mode      text NOT NULL DEFAULT 'global' CHECK (geolocations_mode IN ('global', 'specific')),
  geolocations           jsonb NOT NULL DEFAULT '[]',
  website_url            text,
  contact_share_publicly boolean NOT NULL DEFAULT false,
  contact_first_name     text,
  contact_last_name      text,
  contact_phone          text,
  contact_email          text,
  social_twitter         text,
  social_instagram       text,
  social_meta            text,
  social_tiktok          text,
  social_youtube         text,
  social_linkedin        text,
  custom_link_label      text,
  custom_link_url        text,
  require_default_offer  boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_marketplace_profiles_updated_at BEFORE UPDATE ON marketplace_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS marketplace_profiles;
