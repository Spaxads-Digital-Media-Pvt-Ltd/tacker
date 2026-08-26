/**
 * Zod schemas for offer sub-entities (goals, creatives, coupons, deals). Money is a numeric STRING
 * (moneySchema) — never a float (spec §8).
 */
import { z } from 'zod';
import { moneySchema } from '../../../lib/money.js';

export const createGoalSchema = z.object({
  name: z.string().min(1).max(200),
  eventName: z.string().min(1).max(100).nullable().optional(),
  payoutModel: z.enum(['CPA', 'CPL', 'CPC', 'CPI', 'RevShare']).default('CPA'),
  payout: moneySchema.default('0'),
  revenue: moneySchema.default('0'),
  currency: z.string().length(3).default('USD'),
  dailyConversionCap: z.number().int().min(0).nullable().optional(),
  totalConversionCap: z.number().int().min(0).nullable().optional(),
  isDefault: z.boolean().default(false),
  status: z.enum(['active', 'paused']).default('active'),
  sortOrder: z.number().int().min(0).default(0),
});
export const updateGoalSchema = createGoalSchema.partial();

export const createCreativeSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['image', 'html', 'link', 'email', 'video', 'archive', 'thumbnail', 'text']).default('image'),
  // Real uploaded files are stored as data: URIs client-side (no asset host in this app) — plain
  // .url() rejects nothing a data: URI needs, but the length cap must fit a real small file's
  // base64 payload, not just a link.
  url: z.string().max(6_000_000).nullable().optional(),
  html: z.string().max(100_000).nullable().optional(),
  width: z.number().int().min(0).nullable().optional(),
  height: z.number().int().min(0).nullable().optional(),
  language: z.string().max(20).nullable().optional(),
  status: z.enum(['active', 'paused', 'deleted']).default('active'),
  visibleToPartners: z.boolean().default(true),
  emailFrom: z.string().max(2000).nullable().optional(),
  emailSubject: z.string().max(2000).nullable().optional(),
});
export const updateCreativeSchema = createCreativeSchema.partial();

export const createCouponSchema = z.object({
  code: z.string().min(1).max(100),
  publisherId: z.string().uuid().nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  discount: z.string().max(100).nullable().optional(),
  status: z.enum(['active', 'expired', 'disabled']).default('active'),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});
export const updateCouponSchema = createCouponSchema.partial();

export const createDealSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  dealType: z.enum(['payout_boost', 'flat_bonus', 'custom']).default('payout_boost'),
  value: moneySchema.nullable().optional(),
  status: z.enum(['active', 'scheduled', 'ended']).default('active'),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});
export const updateDealSchema = createDealSchema.partial();

export const createForwardingRuleSchema = z.object({
  name: z.string().min(1).max(200),
  partnerIds: z.array(z.string().uuid()).default([]),
  offerUrls: z.array(z.string()).default([]),
  destination: z.string().url().max(2000).nullable().optional(),
  countries: z.array(z.string()).default([]),
  status: z.enum(['active', 'paused']).default('active'),
});
export const updateForwardingRuleSchema = createForwardingRuleSchema.partial();

export const createScheduledActionSchema = z.object({
  actionType: z.enum(['activate', 'pause', 'archive', 'cap_change']).default('pause'),
  partnerIds: z.array(z.string().uuid()).default([]),
  event: z.string().max(200).nullable().optional(),
  scheduledTime: z.string().datetime().nullable().optional(),
  internalNotes: z.string().max(2000).nullable().optional(),
  status: z.enum(['pending', 'executed', 'cancelled']).default('pending'),
});
export const updateScheduledActionSchema = createScheduledActionSchema.partial();
export type CreateScheduledAction = z.infer<typeof createScheduledActionSchema>;

export const createOfferPostbackSchema = z.object({
  publisherId: z.string().uuid(),
  url: z.string().url().max(2000),
  method: z.enum(['GET', 'POST']).default('GET'),
  event: z.string().max(100).nullable().optional(),
  level: z.enum(['conversion', 'event', 'cpc']).default('conversion'),
});
export const updateOfferPostbackSchema = createOfferPostbackSchema.partial().extend({
  status: z.enum(['active', 'disabled']).optional(),
});
