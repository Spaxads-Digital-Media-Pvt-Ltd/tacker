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
  type: z.enum(['image', 'html', 'link', 'email', 'video']).default('image'),
  url: z.string().url().max(2000).nullable().optional(),
  html: z.string().max(100_000).nullable().optional(),
  width: z.number().int().min(0).nullable().optional(),
  height: z.number().int().min(0).nullable().optional(),
  language: z.string().max(20).nullable().optional(),
  status: z.enum(['active', 'archived']).default('active'),
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
