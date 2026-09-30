/**
 * Per-offer settings that live in `offers.metadata` (no dedicated columns): targeting rules,
 * attribution / revenue-event / email settings, and General-tab extras. One place defines the
 * request schemas, the body→metadata mapping used by create + PATCH, and the readers used by the
 * DTO and the tracking offer-config cache, so all three stay in lockstep.
 */
import { z } from 'zod';
import { isValidPostal, normalizePostal } from './postal.js';
import { isValidExactIp, isValidIpRange } from './ip-match.js';

export const TARGETING_KEYS = [
  'platform', 'browser', 'deviceBrand', 'osVersion', 'language',
  'country', 'region', 'city', 'dma', 'mobileCarrier', 'isp',
  'zip', 'ipExact', 'ipRange',
] as const;
export type TargetingKey = (typeof TARGETING_KEYS)[number];

export interface TargetingRule { mode: 'include' | 'exclude'; values: string[] }
export type OfferTargeting = Partial<Record<TargetingKey, TargetingRule>>;

const ruleSchema = z.object({
  mode: z.enum(['include', 'exclude']),
  values: z.array(z.string().trim().min(1).max(200)).max(1000),
});

export const targetingSchema = z
  .object(Object.fromEntries(TARGETING_KEYS.map((k) => [k, ruleSchema.optional()])) as Record<TargetingKey, z.ZodOptional<typeof ruleSchema>>)
  .strict()
  .superRefine((t, ctx) => {
    const rules = t as OfferTargeting;
    const bad = (key: TargetingKey, i: number, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key, 'values', i], message });
    rules.country?.values.forEach((v, i) => {
      if (!/^[A-Za-z]{2}$/.test(v)) bad('country', i, `"${v}" is not a 2-letter ISO country code`);
    });
    const zipCountries = rules.country?.mode === 'include' ? Array.from(new Set(rules.country.values.map((c) => c.toUpperCase()))) : [];
    rules.zip?.values.forEach((v, i) => {
      if (!isValidPostal(v, zipCountries)) {
        bad('zip', i, zipCountries.length
          ? `"${v}" is not a valid postal code for ${zipCountries.map((c) => c.toUpperCase()).join('/')}`
          : `"${v}" is not a valid postal code`);
      }
    });
    rules.ipExact?.values.forEach((v, i) => { if (!isValidExactIp(v)) bad('ipExact', i, `"${v}" is not a valid IP address`); });
    rules.ipRange?.values.forEach((v, i) => {
      if (!isValidIpRange(v)) bad('ipRange', i, `"${v}" is not a valid IPv4 CIDR (a.b.c.d/n) or range (a.b.c.d-e.f.g.h)`);
    });
    rules.dma?.values.forEach((v, i) => { if (!/^\d{3}$/.test(v)) bad('dma', i, `"${v}" is not a 3-digit DMA code`); });
  })
  .transform((t): OfferTargeting => {
    const out: OfferTargeting = {};
    for (const k of TARGETING_KEYS) {
      const r = (t as OfferTargeting)[k];
      if (!r || r.values.length === 0) continue;
      const values = k === 'country' ? r.values.map((v) => v.toUpperCase())
        : k === 'zip' ? r.values.map(normalizePostal)
        : r.values;
      out[k] = { mode: r.mode, values: Array.from(new Set(values)) };
    }
    return out;
  });

export interface AttributionSettings {
  tracker24: { enabled: boolean; trackerId: string | null };
  ipqs: { enabled: boolean };
  throttle: { enabled: boolean; ratePct: number };
  clickToConversion: { enabled: boolean; minSeconds: number; maxSeconds: number | null };
  emailOwnership: boolean;
  viewThrough: boolean;
  serverSideClick: boolean;
}

export const DEFAULT_ATTRIBUTION: AttributionSettings = {
  tracker24: { enabled: false, trackerId: null },
  ipqs: { enabled: false },
  throttle: { enabled: false, ratePct: 0 },
  clickToConversion: { enabled: false, minSeconds: 5, maxSeconds: 21600 },
  emailOwnership: false,
  viewThrough: false,
  serverSideClick: false,
};

export const attributionSettingsSchema = z.object({
  tracker24: z.object({ enabled: z.boolean(), trackerId: z.string().trim().max(200).nullable() }),
  ipqs: z.object({ enabled: z.boolean() }),
  throttle: z.object({ enabled: z.boolean(), ratePct: z.number().min(0).max(100) }),
  clickToConversion: z.object({
    enabled: z.boolean(),
    minSeconds: z.number().int().min(0).max(31_536_000),
    maxSeconds: z.number().int().min(1).max(31_536_000).nullable(),
  }).refine((c) => c.maxSeconds == null || c.maxSeconds > c.minSeconds, {
    message: 'Max click-to-conversion time must be greater than the minimum', path: ['maxSeconds'],
  }),
  emailOwnership: z.boolean(),
  viewThrough: z.boolean(),
  serverSideClick: z.boolean(),
});

export interface RevenueSettings {
  baseEventName: string | null;
  manualApproval: boolean;
  allowDuplicates: boolean;
  revenueAction: 'impression' | 'click' | 'conversion';
  revenueType: 'fixed' | 'percentage' | 'mixed';
  revenuePct: number | null;
  pricePerProduct: boolean;
}

export const DEFAULT_REVENUE: RevenueSettings = {
  baseEventName: null,
  manualApproval: false,
  allowDuplicates: true,
  revenueAction: 'conversion',
  revenueType: 'fixed',
  revenuePct: null,
  pricePerProduct: false,
};

export const revenueSettingsSchema = z.object({
  baseEventName: z.string().trim().max(100).nullable(),
  manualApproval: z.boolean(),
  allowDuplicates: z.boolean(),
  revenueAction: z.enum(['impression', 'click', 'conversion']),
  revenueType: z.enum(['fixed', 'percentage', 'mixed']),
  revenuePct: z.number().min(0).max(100).nullable(),
  pricePerProduct: z.boolean(),
}).refine((r) => r.revenueType === 'fixed' || r.revenuePct != null, {
  message: 'Revenue percentage is required for Percentage / Mixed revenue', path: ['revenuePct'],
});

export interface EmailSettings {
  suppression: { enabled: boolean; fileUrl: string | null };
  ezepo: { enabled: boolean };
  optizmo: { enabled: boolean; listId: string | null };
  instructions: { enabled: boolean; text: string | null };
  optOut: { enabled: boolean; url: string | null };
}

export const DEFAULT_EMAIL: EmailSettings = {
  suppression: { enabled: false, fileUrl: null },
  ezepo: { enabled: false },
  optizmo: { enabled: false, listId: null },
  instructions: { enabled: false, text: null },
  optOut: { enabled: false, url: null },
};

const optionalHttpUrl = z.string().trim().url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'Must be an http(s) URL').nullable();

export const emailSettingsSchema = z.object({
  suppression: z.object({ enabled: z.boolean(), fileUrl: optionalHttpUrl }),
  ezepo: z.object({ enabled: z.boolean() }),
  optizmo: z.object({ enabled: z.boolean(), listId: z.string().trim().max(200).nullable() }),
  instructions: z.object({ enabled: z.boolean(), text: z.string().max(20_000).nullable() }),
  optOut: z.object({ enabled: z.boolean(), url: optionalHttpUrl }),
});

/** Extra offer fields (all metadata-backed), shared by create + update request schemas. */
export const offerSettingsFields = {
  appIdentifier: z.string().trim().max(255).nullable().optional(),
  internalNotes: z.string().max(20_000).nullable().optional(),
  productId: z.string().trim().max(255).nullable().optional(),
  thumbnailUrl: z.string().trim().url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'Must be an http(s) URL').nullable().optional(),
  targeting: targetingSchema.nullable().optional(),
  attributionSettings: attributionSettingsSchema.nullable().optional(),
  revenueSettings: revenueSettingsSchema.nullable().optional(),
  emailSettings: emailSettingsSchema.nullable().optional(),
};

/** Request-body key → offers.metadata key. */
const METADATA_FIELDS: Record<string, string> = {
  notes: 'notes',
  description: 'description',
  kpi: 'kpi',
  linkingType: 'linking_type',
  deepLinkEnabled: 'deep_link_enabled',
  firePartnerPostback: 'fire_partner_postback',
  appIdentifier: 'app_identifier',
  internalNotes: 'internal_notes',
  productId: 'product_id',
  thumbnailUrl: 'thumbnail_url',
  targeting: 'targeting',
  attributionSettings: 'attribution_settings',
  revenueSettings: 'revenue_settings',
  emailSettings: 'email_settings',
  // Legacy flat aliases (pre-date emailSettings) — API back-compat only. toAdminDTO derives
  // suppressionFileEnabled/emailOptOutEnabled from emailSettings first, these as a fallback.
  suppressionFileEnabled: 'suppressionFileEnabled',
  emailOptOutEnabled: 'emailOptOutEnabled',
};

/** Merge any metadata-backed fields present in `body` over `before`. Returns null when none were sent. */
export function mergeOfferMetadata(before: Record<string, unknown> | null | undefined, body: Record<string, unknown>): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  for (const [bodyKey, metaKey] of Object.entries(METADATA_FIELDS)) {
    if (body[bodyKey] !== undefined) patch[metaKey] = body[bodyKey];
  }
  return Object.keys(patch).length ? { ...(before ?? {}), ...patch } : null;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export function readTargeting(meta: Record<string, unknown> | null | undefined): OfferTargeting {
  const t = obj(meta?.['targeting']);
  if (!t) return {};
  const out: OfferTargeting = {};
  for (const k of TARGETING_KEYS) {
    const r = obj(t[k]);
    if (r && (r['mode'] === 'include' || r['mode'] === 'exclude') && Array.isArray(r['values']) && r['values'].length) {
      out[k] = { mode: r['mode'], values: (r['values'] as unknown[]).map(String) };
    }
  }
  return out;
}

function deepDefaults<T>(defaults: T, stored: unknown): T {
  const s = obj(stored);
  if (!s) return structuredClone(defaults);
  const out = structuredClone(defaults) as Record<string, unknown>;
  for (const [k, dv] of Object.entries(defaults as Record<string, unknown>)) {
    const sv = s[k];
    if (sv === undefined) continue;
    out[k] = obj(dv) ? { ...(dv as object), ...(obj(sv) ?? {}) } : sv;
  }
  return out as T;
}

export const readAttribution = (meta: Record<string, unknown> | null | undefined): AttributionSettings =>
  deepDefaults(DEFAULT_ATTRIBUTION, meta?.['attribution_settings']);
export const readRevenue = (meta: Record<string, unknown> | null | undefined): RevenueSettings =>
  deepDefaults(DEFAULT_REVENUE, meta?.['revenue_settings']);
export const readEmail = (meta: Record<string, unknown> | null | undefined): EmailSettings =>
  deepDefaults(DEFAULT_EMAIL, meta?.['email_settings']);

export const readString = (meta: Record<string, unknown> | null | undefined, key: string): string | null =>
  typeof meta?.[key] === 'string' ? (meta[key] as string) : null;
