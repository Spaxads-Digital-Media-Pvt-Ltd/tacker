import { z } from 'zod';
import { createGoalSchema, updateGoalSchema } from '../offers/asset-schemas.js';

export const createAdvertiserSchema = z.object({
  name: z.string().min(1).max(200),
  status: z.enum(['active', 'pending', 'inactive']).default('pending'),
  contactEmail: z.string().trim().email().nullable().optional(),
  billingTerms: z.string().max(500).nullable().optional(),
  defaultCurrency: z.string().length(3).default('USD'),
  accountManagerId: z.string().uuid().nullable().optional(),
  salesManagerId: z.string().uuid().nullable().optional(),
  billingFrequency: z.string().max(50).nullable().optional(),
  verificationToken: z.string().max(200).nullable().optional(),
  // Values for network-defined custom fields → merged into metadata.custom.
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export const updateAdvertiserSchema = createAdvertiserSchema.partial();

export type CreateAdvertiser = z.infer<typeof createAdvertiserSchema>;
export type UpdateAdvertiser = z.infer<typeof updateAdvertiserSchema>;

/**
 * Advertiser Details → Events. An event is an offer goal on one of this advertiser's offers
 * ("Associated to" = that offer), so the body is the goal schema plus the offer. Currency is optional
 * here and defaults to the associated offer's currency instead of a hard-coded USD.
 */
export const createAdvertiserEventSchema = createGoalSchema.extend({
  offerId: z.string().uuid(),
  currency: z.string().length(3).optional(),
});
/** The associated offer can't change after creation (goal rows belong to their offer); `offerId`
 * is accepted only so an edit form can send it back unchanged. */
export const updateAdvertiserEventSchema = updateGoalSchema.extend({ offerId: z.string().uuid().optional() });
export type CreateAdvertiserEvent = z.infer<typeof createAdvertiserEventSchema>;
export type UpdateAdvertiserEvent = z.infer<typeof updateAdvertiserEventSchema>;

export const debugPostbackSchema = z.object({
  url: z.string().url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'Must be an http(s) URL'),
  method: z.enum(['GET', 'POST']).default('GET'),
  country: z.string().max(3).optional(),
  device: z.string().max(40).optional(),
});
export type DebugPostback = z.infer<typeof debugPostbackSchema>;
