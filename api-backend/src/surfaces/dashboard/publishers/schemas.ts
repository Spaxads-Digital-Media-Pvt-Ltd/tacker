import { z } from 'zod';

export const createPublisherSchema = z.object({
  name: z.string().min(1).max(200),
  status: z.enum(['active', 'pending', 'inactive']).default('pending'),
  contactEmail: z.string().email().optional(),
  trafficSource: z.string().max(200).optional(),
  payoutTerms: z.string().max(500).optional(),
  defaultAttributionWindowS: z.number().int().min(0).max(31_536_000).optional(),
  defaultDedupWindowS: z.number().int().min(0).max(31_536_000).optional(),
  country: z.string().max(100).nullable().optional(),
  paymentMethod: z.string().max(60).nullable().optional(),
  billingFrequency: z.string().max(60).nullable().optional(),
  tier: z.string().max(60).nullable().optional(),
  partnerManagerId: z.string().uuid().nullable().optional(),
  accountExecutiveId: z.string().uuid().nullable().optional(),
  referredById: z.string().uuid().nullable().optional(),
  contactName: z.string().max(200).nullable().optional(),
  taxId: z.string().max(100).nullable().optional(),
  website: z.string().max(300).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  // Values for network-defined custom fields → merged into metadata.custom.
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export const updatePublisherSchema = createPublisherSchema.partial();

export type CreatePublisher = z.infer<typeof createPublisherSchema>;
export type UpdatePublisher = z.infer<typeof updatePublisherSchema>;

export const createPostbackSchema = z.object({
  url: z.string().url().max(2000),
  method: z.enum(['GET', 'POST']).default('GET'),
  offerId: z.string().uuid().nullable().optional(),
  event: z.string().max(100).nullable().optional(),
  level: z.enum(['conversion', 'event', 'cpc']).default('conversion'),
});
export type CreatePostback = z.infer<typeof createPostbackSchema>;

export const updatePostbackSchema = createPostbackSchema.partial().extend({
  status: z.enum(['active', 'disabled']).optional(),
});
export type UpdatePostback = z.infer<typeof updatePostbackSchema>;

export const postbackTestSchema = z.object({
  url: z.string().url().max(2000),
  method: z.enum(['GET', 'POST']).default('GET'),
  country: z.string().max(3).optional(),
  device: z.string().max(40).optional(),
});
export type PostbackTest = z.infer<typeof postbackTestSchema>;
