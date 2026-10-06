import { z } from 'zod';
import { moneySchema } from '../../../lib/money.js';
import { redirectUrlWithMax } from '../../../lib/url-schemas.js';
import { offerSettingsFields } from '../../../lib/offer-settings/index.js';

export const createOfferSchema = z.object({
  advertiserId: z.string().uuid(),
  name: z.string().min(1).max(200),
  status: z.enum(['draft', 'active', 'paused', 'archived']).default('draft'),
  destinationUrl: redirectUrlWithMax(2000),
  payoutModel: z.enum(['CPA', 'CPL', 'CPC', 'CPI', 'RevShare']).default('CPA'),
  defaultPayout: moneySchema.default('0'),
  defaultRevenue: moneySchema.default('0'),
  currency: z.string().length(3).default('USD'),
  dailyConversionCap: z.number().int().min(0).nullable().optional(),
  totalConversionCap: z.number().int().min(0).nullable().optional(),
  dailyClickCap: z.number().int().min(0).nullable().optional(),
  attributionWindowS: z.number().int().min(0).max(31_536_000).optional(),
  dedupWindowS: z.number().int().min(0).max(31_536_000).optional(),
  allowedTrafficTypes: z.array(z.string().max(50)).max(50).optional(),
  fallbackUrl: redirectUrlWithMax(2000).nullable().optional(),
  objective: z.enum(['conversions', 'sale', 'app_installs', 'leads', 'impressions', 'clicks']).default('conversions'),
  visibility: z.enum(['public', 'private', 'ask']).default('public'),
  category: z.string().max(120).nullable().optional(),
  previewUrl: redirectUrlWithMax(2000).nullable().optional(),
  description: z.string().max(20_000).nullable().optional(),
  kpi: z.string().max(5000).nullable().optional(),
  // appIdentifier is defined once, more richly, in offerSettingsFields below.
  // suppressionFileEnabled/emailOptOutEnabled are legacy flat aliases for
  // emailSettings.suppression.enabled / emailSettings.optOut.enabled (also in offerSettingsFields) —
  // kept as accepted input for API back-compat with earlier clients.
  suppressionFileEnabled: z.boolean().optional(),
  emailOptOutEnabled: z.boolean().optional(),
  trackingDomainId: z.string().uuid().nullable().optional(),
  linkingType: z.enum(['redirect', 'redirect_direct']).nullable().optional(),
  deepLinkEnabled: z.boolean().nullable().optional(),
  firePartnerPostback: z.boolean().nullable().optional(),
  ...offerSettingsFields,
});

export const updateOfferSchema = createOfferSchema.partial().extend({
  notes: z.array(z.string().max(2000)).max(200).optional(),
});

export const createGeoRuleSchema = z.object({
  country: z.string().min(1).max(3),
  region: z.string().max(100).nullable().optional(),
  action: z.enum(['allow', 'deny']).default('allow'),
  payoutOverride: moneySchema.nullable().optional(),
  revenueOverride: moneySchema.nullable().optional(),
  destinationOverride: redirectUrlWithMax(2000).nullable().optional(),
});

export const updateGeoRuleSchema = createGeoRuleSchema.partial();

export const createAccessSchema = z.object({
  publisherId: z.string().uuid(),
  access: z.enum(['allow', 'deny']).default('allow'),
  approvalStatus: z.enum(['approved', 'pending', 'rejected']).default('approved'),
  payoutOverride: moneySchema.nullable().optional(),
});

export const updateAccessSchema = z.object({
  access: z.enum(['allow', 'deny']).optional(),
  approvalStatus: z.enum(['approved', 'pending', 'rejected']).optional(),
  payoutOverride: moneySchema.nullable().optional(),
});

/** Publisher self-service request/withdraw. publisherId comes from the authenticated identity — not from the body. */
export const requestAccessSchema = z.object({
 access: z.enum(['allow', 'deny']).default('allow'),
});

export type RequestAccess = z.infer<typeof requestAccessSchema>;

export type CreateOffer = z.infer<typeof createOfferSchema>;
export type UpdateOffer = z.infer<typeof updateOfferSchema>;
export type CreateGeoRule = z.infer<typeof createGeoRuleSchema>;
export type UpdateGeoRule = z.infer<typeof updateGeoRuleSchema>;
export type CreateAccess = z.infer<typeof createAccessSchema>;
