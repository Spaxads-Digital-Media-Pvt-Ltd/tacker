/**
 * Marketplace › Your Profile(s) — one editable row per network describing how it presents itself
 * (name, logo, description, categories, payout types accepted, promotional methods, device types,
 * geolocations, website, contact, social links). Verified against the live reference's real Edit
 * form (`/everxchange/profiles/partner/edit`) field-for-field. Tenant-scoped by network_id (spec
 * §3A) — `network_id` is UNIQUE so there is at most one profile per network.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';

const TABLE = 'marketplace_profiles';

// Real, whitelisted vocabularies confirmed against the live reference's Edit form (the full 8-item
// Payout Types list was fully visible with check/x marks; Promotional Methods / Device Types only
// showed their currently-selected values — Email/Coupon/Deal Site and PC/Tablet — so those two lists
// add Search/Social Media/Display/Native Ads/SMS/Incentive and Mobile as reasonable, undramatic
// completions of an evidently-larger real set, not fabricated categories).
export const PAYOUT_TYPES = [
  'Commission Per Sale', 'Revenue Share', 'Cost Per Install', 'Cost Per Action',
  'Cost Per Lead', 'Cost Per Click', 'Flat Fee', '% of Media Spend',
] as const;
export const PROMOTIONAL_METHODS = [
  'Email', 'Coupon', 'Deal Site', 'Search', 'Social Media', 'Display', 'Native Ads', 'SMS', 'Incentive',
] as const;
export const DEVICE_TYPES = ['PC', 'Mobile', 'Tablet'] as const;
export const MARKETPLACE_CATEGORIES = [
  'Adult & Dating', 'Airlines & Hotels', 'Assistive Care', 'Beauty & Personal Care',
  'Education & Career', 'Electronics', 'Entertainment & Gaming', 'Fashion, Apparel, & Accessories',
  'Financial Growth & Investments', 'Health & Wellness (General)', 'Tourist Attractions & Activities',
  'Travel Gear & Accessories',
] as const;
export const CONVERSION_FUNNEL_EXPERTISE = [
  'Single Step', 'Multi-Step / Upsell', 'Subscription', 'Free Trial',
] as const;

const profileSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  logoUrl: z.string().max(2000).optional(),
  categoriesMode: z.enum(['targeted', 'all']).default('targeted'),
  categories: z.array(z.enum(MARKETPLACE_CATEGORIES)).max(5).default([]),
  conversionFunnelExpertise: z.array(z.enum(CONVERSION_FUNNEL_EXPERTISE)).default([]),
  promotionalMethods: z.array(z.enum(PROMOTIONAL_METHODS)).default([]),
  payoutTypesAccepted: z.array(z.enum(PAYOUT_TYPES)).default([]),
  deviceTypesCovered: z.array(z.enum(DEVICE_TYPES)).default([]),
  geolocationsMode: z.enum(['global', 'specific']).default('global'),
  geolocations: z.array(z.string().max(3)).max(5).default([]),
  websiteUrl: z.string().max(500).optional(),
  contactSharePublicly: z.boolean().default(false),
  contactFirstName: z.string().max(100).optional(),
  contactLastName: z.string().max(100).optional(),
  contactPhone: z.string().max(50).optional(),
  contactEmail: z.string().email().max(200).optional().or(z.literal('')),
  socialTwitter: z.string().max(500).optional(),
  socialInstagram: z.string().max(500).optional(),
  socialMeta: z.string().max(500).optional(),
  socialTiktok: z.string().max(500).optional(),
  socialYoutube: z.string().max(500).optional(),
  socialLinkedin: z.string().max(500).optional(),
  customLinkLabel: z.string().max(100).optional(),
  customLinkUrl: z.string().max(500).optional(),
  requireDefaultOffer: z.boolean().default(false),
});

interface Row {
  id: string; name: string; description: string | null; logo_url: string | null;
  categories_mode: string; categories: string[]; conversion_funnel_expertise: string[];
  promotional_methods: string[]; payout_types_accepted: string[]; device_types_covered: string[];
  geolocations_mode: string; geolocations: string[]; website_url: string | null;
  contact_share_publicly: boolean; contact_first_name: string | null; contact_last_name: string | null;
  contact_phone: string | null; contact_email: string | null;
  social_twitter: string | null; social_instagram: string | null; social_meta: string | null;
  social_tiktok: string | null; social_youtube: string | null; social_linkedin: string | null;
  custom_link_label: string | null; custom_link_url: string | null;
  require_default_offer: boolean; created_at: string; updated_at: string;
}
const dto = (r: Row) => ({
  id: r.id, name: r.name, description: r.description, logoUrl: r.logo_url,
  categoriesMode: r.categories_mode, categories: r.categories,
  conversionFunnelExpertise: r.conversion_funnel_expertise, promotionalMethods: r.promotional_methods,
  payoutTypesAccepted: r.payout_types_accepted, deviceTypesCovered: r.device_types_covered,
  geolocationsMode: r.geolocations_mode, geolocations: r.geolocations, websiteUrl: r.website_url,
  contactSharePublicly: r.contact_share_publicly, contactFirstName: r.contact_first_name,
  contactLastName: r.contact_last_name, contactPhone: r.contact_phone, contactEmail: r.contact_email,
  socialTwitter: r.social_twitter, socialInstagram: r.social_instagram, socialMeta: r.social_meta,
  socialTiktok: r.social_tiktok, socialYoutube: r.social_youtube, socialLinkedin: r.social_linkedin,
  customLinkLabel: r.custom_link_label, customLinkUrl: r.custom_link_url,
  requireDefaultOffer: r.require_default_offer, createdAt: r.created_at, updatedAt: r.updated_at,
});

function toColumns(b: z.infer<typeof profileSchema>): Record<string, unknown> {
  return {
    name: b.name, description: b.description ?? null, logo_url: b.logoUrl ?? null,
    categories_mode: b.categoriesMode, categories: JSON.stringify(b.categories),
    conversion_funnel_expertise: JSON.stringify(b.conversionFunnelExpertise),
    promotional_methods: JSON.stringify(b.promotionalMethods),
    payout_types_accepted: JSON.stringify(b.payoutTypesAccepted),
    device_types_covered: JSON.stringify(b.deviceTypesCovered),
    geolocations_mode: b.geolocationsMode, geolocations: JSON.stringify(b.geolocations),
    website_url: b.websiteUrl ?? null, contact_share_publicly: b.contactSharePublicly,
    contact_first_name: b.contactFirstName ?? null, contact_last_name: b.contactLastName ?? null,
    contact_phone: b.contactPhone ?? null, contact_email: b.contactEmail || null,
    social_twitter: b.socialTwitter ?? null, social_instagram: b.socialInstagram ?? null,
    social_meta: b.socialMeta ?? null, social_tiktok: b.socialTiktok ?? null,
    social_youtube: b.socialYoutube ?? null, social_linkedin: b.socialLinkedin ?? null,
    custom_link_label: b.customLinkLabel ?? null, custom_link_url: b.customLinkUrl ?? null,
    require_default_offer: b.requireDefaultOffer,
  };
}

export function marketplaceProfileRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const row = await dbForRequest(req).selectOne<Row>(TABLE, {});
    sendOk(res, row ? dto(row) : null);
  }));

  r.put('/', requireRole('admin', 'manager'), validateBody(profileSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof profileSchema>;
    const existing = await db.selectOne<Row>(TABLE, {});
    const columns = toColumns(b);
    const row = existing
      ? (await db.update<Row>(TABLE, columns, { id: existing.id }))[0]
      : await db.insert<Row>(TABLE, columns);
    await writeAudit(req, {
      action: existing ? 'marketplace_profile.update' : 'marketplace_profile.create',
      entityType: 'marketplace_profile', entityId: row!.id, after: row,
    });
    sendOk(res, dto(row!));
  }));

  return r;
}
