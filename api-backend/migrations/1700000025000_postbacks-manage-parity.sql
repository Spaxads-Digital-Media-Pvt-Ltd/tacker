-- Manage Postbacks parity: the reference's "Postback Level" (Global / Specific / Global (Offer))
-- requires EITHER publisher_id or offer_id to be set, not always both — this table required
-- publisher_id NOT NULL, so "applies to every partner on this one offer" (Global (Offer)) couldn't
-- be represented. Delivery Method (HTML/Postback/Meta/TikTok/Snapchat/Rumble) and HTML pixel code
-- are a different concept from the existing GET/POST http method, and Description/Delay had no
-- column at all.

-- Up Migration
ALTER TABLE publisher_postbacks ALTER COLUMN publisher_id DROP NOT NULL;
ALTER TABLE publisher_postbacks ADD COLUMN delivery_method text NOT NULL DEFAULT 'postback'
  CHECK (delivery_method IN ('postback', 'html', 'meta', 'tiktok', 'snapchat', 'rumble'));
ALTER TABLE publisher_postbacks ADD COLUMN html_code text;
ALTER TABLE publisher_postbacks ADD COLUMN description text;
ALTER TABLE publisher_postbacks ADD COLUMN delay text;
ALTER TABLE publisher_postbacks ADD CONSTRAINT publisher_postbacks_scope_chk CHECK (publisher_id IS NOT NULL OR offer_id IS NOT NULL);
-- url is only required for URL-fired delivery methods; HTML-delivery rows carry html_code instead.
ALTER TABLE publisher_postbacks ALTER COLUMN url DROP NOT NULL;

-- Down Migration
ALTER TABLE publisher_postbacks ALTER COLUMN url SET NOT NULL;
ALTER TABLE publisher_postbacks DROP CONSTRAINT IF EXISTS publisher_postbacks_scope_chk;
ALTER TABLE publisher_postbacks DROP COLUMN IF EXISTS delay;
ALTER TABLE publisher_postbacks DROP COLUMN IF EXISTS description;
ALTER TABLE publisher_postbacks DROP COLUMN IF EXISTS html_code;
ALTER TABLE publisher_postbacks DROP COLUMN IF EXISTS delivery_method;
ALTER TABLE publisher_postbacks ALTER COLUMN publisher_id SET NOT NULL;
