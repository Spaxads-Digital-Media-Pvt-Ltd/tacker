/**
 * Offer audience DTOs (spec §3A #13, §8A). CRITICAL field-level segregation:
 *   - admin:   sees everything (payout AND revenue → margin).
 *   - advertiser: sees revenue (their cost), NOT publisher payout.
 *   - publisher:  sees payout (their earning), NEVER revenue/margin.
 * The serializer decides — the caller never picks fields.
 */
import type { OfferRow, OfferGeoRuleRow, OfferPublisherAccessRow } from '../../../domain/entities.js';
import {
  readTargeting, readAttribution, readRevenue, readEmail, readString,
  type OfferTargeting, type AttributionSettings, type RevenueSettings, type EmailSettings,
} from '../../../lib/offer-settings/index.js';

export interface OfferAdminDTO {
  id: string;
  ref: number;
  advertiserId: string;
  name: string;
  status: OfferRow['status'];
  destinationUrl: string;
  payoutModel: OfferRow['payout_model'];
  defaultPayout: string;
  defaultRevenue: string;
  currency: string;
  dailyConversionCap: number | null;
  totalConversionCap: number | null;
  dailyClickCap: number | null;
  attributionWindowS: number;
  dedupWindowS: number;
  allowedTrafficTypes: string[];
  fallbackUrl: string | null;
  objective: OfferRow['objective'];
  visibility: OfferRow['visibility'];
  category: string | null;
  previewUrl: string | null;
  description: string | null;
  notes: string[];
  securityCode: string | null;
  trackingDomainId: string | null;
  linkingType: string | null;
  deepLinkEnabled: boolean | null;
  firePartnerPostback: boolean | null;
  appIdentifier: string | null;
  /** @deprecated derived from emailSettings.suppression.enabled — kept for API back-compat. */
  suppressionFileEnabled: boolean;
  /** @deprecated derived from emailSettings.optOut.enabled — kept for API back-compat. */
  emailOptOutEnabled: boolean;
  internalNotes: string | null;
  productId: string | null;
  thumbnailUrl: string | null;
  targeting: OfferTargeting;
  attributionSettings: AttributionSettings;
  revenueSettings: RevenueSettings;
  emailSettings: EmailSettings;
  createdAt: string;
  updatedAt: string;
}

export function toAdminDTO(row: OfferRow): OfferAdminDTO {
  const meta = row.metadata ?? {};
  return {
    id: row.id,
    ref: Number(row.ref),
    advertiserId: row.advertiser_id,
    name: row.name,
    status: row.status,
    destinationUrl: row.destination_url,
    payoutModel: row.payout_model,
    defaultPayout: row.default_payout,
    defaultRevenue: row.default_revenue,
    currency: row.currency,
    dailyConversionCap: row.daily_conversion_cap,
    totalConversionCap: row.total_conversion_cap,
    dailyClickCap: row.daily_click_cap,
    attributionWindowS: row.attribution_window_s,
    dedupWindowS: row.dedup_window_s,
    allowedTrafficTypes: row.allowed_traffic_types,
    fallbackUrl: row.fallback_url,
    objective: row.objective,
    visibility: row.visibility,
    category: row.category,
    previewUrl: row.preview_url,
    description: (meta['description'] as string | undefined) ?? null,
    notes: Array.isArray(meta['notes']) ? (meta['notes'] as string[]) : [],
    securityCode: row.security_code ?? null,
    trackingDomainId: row.tracking_domain_id,
    linkingType: typeof meta['linking_type'] === 'string' ? (meta['linking_type'] as string)
      : (meta['linkingType'] as string | undefined) ?? null, // legacy camelCase key, pre-dates the snake_case convention
    deepLinkEnabled: typeof meta['deep_link_enabled'] === 'boolean' ? (meta['deep_link_enabled'] as boolean) : null,
    firePartnerPostback: typeof meta['fire_partner_postback'] === 'boolean' ? (meta['fire_partner_postback'] as boolean) : null,
    appIdentifier: readString(meta, 'app_identifier') ?? (meta['appIdentifier'] as string | undefined) ?? null, // legacy camelCase key
    // Derived from the richer emailSettings object; legacy flat keys read as a fallback for any
    // pre-existing data saved before emailSettings existed.
    suppressionFileEnabled: readEmail(meta).suppression.enabled || Boolean(meta['suppressionFileEnabled']),
    emailOptOutEnabled: readEmail(meta).optOut.enabled || Boolean(meta['emailOptOutEnabled']),
    internalNotes: readString(meta, 'internal_notes'),
    productId: readString(meta, 'product_id'),
    thumbnailUrl: readString(meta, 'thumbnail_url'),
    targeting: readTargeting(meta),
    attributionSettings: readAttribution(meta),
    revenueSettings: readRevenue(meta),
    emailSettings: readEmail(meta),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Advertiser portal: their own offer. Revenue (their cost) shown; publisher payout hidden. */
export interface OfferAdvertiserDTO {
  id: string;
  name: string;
  status: OfferRow['status'];
  destinationUrl: string;
  payoutModel: OfferRow['payout_model'];
  revenue: string;
  currency: string;
  createdAt: string;
}

export function toAdvertiserDTO(row: OfferRow): OfferAdvertiserDTO {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    destinationUrl: row.destination_url,
    payoutModel: row.payout_model,
    revenue: row.default_revenue,
    currency: row.currency,
    createdAt: row.created_at,
  };
}

/** Publisher portal: an offer available to run. Payout shown; revenue/margin NEVER present. */
export interface OfferPublisherDTO {
  id: string;
  name: string;
  status: OfferRow['status'];
  payoutModel: OfferRow['payout_model'];
  /** Effective payout for THIS publisher (per-publisher override applied if present). */
  payout: string;
  currency: string;
}

export function toPublisherDTO(row: OfferRow, effectivePayout: string): OfferPublisherDTO {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    payoutModel: row.payout_model,
    payout: effectivePayout,
    currency: row.currency,
  };
}

/** Publisher portal detail: list fields + extended fields + access status + tracking link. */
export interface PublisherOfferDetailDTO extends OfferPublisherDTO {
 destinationUrl: string;
 description: string | null;
 previewUrl: string | null;
 objective: OfferRow['objective'];
 visibility: OfferRow['visibility'];
 category: string | null;
 allowedTrafficTypes: string[];
 fallbackUrl: string | null;
 attributionWindowS: number;
 dedupWindowS: number;
 dailyClickCap: number | null;
 dailyConversionCap: number | null;
 totalConversionCap: number | null;
 trackingDomainId: string | null;
 access: 'allow' | 'deny' | null;
 approvalStatus: 'approved' | 'pending' | 'rejected' | null;
 trackingUrl: string | null;
 createdAt: string;
}

export function toPublisherDetailDTO(
 row: OfferRow,
 effectivePayout: string,
 access: 'allow' | 'deny' | null,
 approvalStatus: 'approved' | 'pending' | 'rejected' | null,
 trackingUrl: string | null,
): PublisherOfferDetailDTO {
 const meta = row.metadata ?? {};
 return {
 id: row.id,
 name: row.name,
 status: row.status,
 payoutModel: row.payout_model,
 payout: effectivePayout,
 currency: row.currency,
 destinationUrl: row.destination_url,
 description: (meta['description'] as string | undefined) ?? null,
 previewUrl: row.preview_url,
 objective: row.objective,
 visibility: row.visibility,
 category: row.category,
 allowedTrafficTypes: row.allowed_traffic_types,
 fallbackUrl: row.fallback_url,
 attributionWindowS: row.attribution_window_s,
 dedupWindowS: row.dedup_window_s,
 dailyClickCap: row.daily_click_cap,
 dailyConversionCap: row.daily_conversion_cap,
 totalConversionCap: row.total_conversion_cap,
 trackingDomainId: row.tracking_domain_id,
 access,
 approvalStatus,
 trackingUrl,
 createdAt: row.created_at,
 };
}

/** Advertiser portal detail: list fields + extended fields (revenue shown; publisher payout never exposed). */
export interface AdvertiserOfferDetailDTO {
 id: string;
 ref: number;
 name: string;
 status: OfferRow['status'];
 destinationUrl: string;
 payoutModel: OfferRow['payout_model'];
 revenue: string;
 currency: string;
 description: string | null;
 previewUrl: string | null;
 objective: OfferRow['objective'];
 visibility: OfferRow['visibility'];
 category: string | null;
 allowedTrafficTypes: string[];
 fallbackUrl: string | null;
 attributionWindowS: number;
 dedupWindowS: number;
 dailyClickCap: number | null;
 dailyConversionCap: number | null;
 totalConversionCap: number | null;
 trackingDomainId: string | null;
 trackingUrl: string | null;
 createdAt: string;
 updatedAt: string;
}

export function toAdvertiserDetailDTO(row: OfferRow, trackingUrl: string | null = null): AdvertiserOfferDetailDTO {
 const meta = row.metadata ?? {};
 return {
 id: row.id,
 ref: Number(row.ref),
 name: row.name,
 status: row.status,
 destinationUrl: row.destination_url,
 payoutModel: row.payout_model,
 revenue: row.default_revenue,
 currency: row.currency,
 description: (meta['description'] as string | undefined) ?? null,
 previewUrl: row.preview_url,
 objective: row.objective,
 visibility: row.visibility,
 category: row.category,
 allowedTrafficTypes: row.allowed_traffic_types,
 fallbackUrl: row.fallback_url,
 attributionWindowS: row.attribution_window_s,
 dedupWindowS: row.dedup_window_s,
 dailyClickCap: row.daily_click_cap,
 dailyConversionCap: row.daily_conversion_cap,
 totalConversionCap: row.total_conversion_cap,
 trackingDomainId: row.tracking_domain_id,
 trackingUrl,
 createdAt: row.created_at,
 updatedAt: row.updated_at,
 };
}

export interface GeoRuleDTO {
  id: string;
  country: string;
  region: string | null;
  action: OfferGeoRuleRow['action'];
  payoutOverride: string | null;
  revenueOverride: string | null;
  destinationOverride: string | null;
}

export function toGeoRuleDTO(row: OfferGeoRuleRow): GeoRuleDTO {
  return {
    id: row.id,
    country: row.country,
    region: row.region,
    action: row.action,
    payoutOverride: row.payout_override,
    revenueOverride: row.revenue_override,
    destinationOverride: row.destination_override,
  };
}

/**
 * Per-offer "effective allowed countries", collapsed from that offer's geo rules the same way
 * tracking/geo-rules.ts evaluates them at click time (this is a read-only mirror — it never
 * touches enforcement):
 *   - a `*` deny, or explicit allow rules with no `*` allow → allow-list  ("only these")
 *   - a `*` allow, or only deny rules                       → deny-list   ("all except these")
 * Offers with NO geo rules are simply absent from the bulk response (caller treats "missing" as
 * "allows every country").
 */
export interface OfferCountryDTO {
  offerId: string;
  mode: 'allow' | 'deny';
  countries: string[]; // uppercase ISO-2; the allow-list (mode 'allow') or the deny-list (mode 'deny')
}

interface AggGeoRow {
  offer_id: string;
  allow_countries: string[];
  deny_countries: string[];
  wildcard_allow: boolean;
  wildcard_deny: boolean;
}

export function toOfferCountryDTO(row: AggGeoRow): OfferCountryDTO {
  const allow = [...new Set(row.allow_countries.map((c) => c.toUpperCase()))].sort();
  const deny = [...new Set(row.deny_countries.map((c) => c.toUpperCase()))].sort();
  // '*' deny, or an allow-list with no catch-all allow → the offer only permits the allow set.
  if (row.wildcard_deny || (allow.length > 0 && !row.wildcard_allow)) {
    return { offerId: row.offer_id, mode: 'allow', countries: allow };
  }
  // Otherwise ('*' allow, or deny-only rules) → everything is permitted except the deny set.
  return { offerId: row.offer_id, mode: 'deny', countries: deny };
}

export interface PublisherAccessDTO {
  id: string;
  publisherId: string;
  access: OfferPublisherAccessRow['access'];
  approvalStatus: OfferPublisherAccessRow['approval_status'];
  payoutOverride: string | null;
}

export function toAccessDTO(row: OfferPublisherAccessRow): PublisherAccessDTO {
  return {
    id: row.id,
    publisherId: row.publisher_id,
    access: row.access,
    approvalStatus: row.approval_status,
    payoutOverride: row.payout_override,
  };
}
