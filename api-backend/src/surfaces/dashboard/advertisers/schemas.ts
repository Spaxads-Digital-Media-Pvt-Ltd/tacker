import { z } from 'zod';

export const createAdvertiserSchema = z.object({
  name: z.string().min(1).max(200),
  status: z.enum(['active', 'pending', 'inactive']).default('pending'),
  contactEmail: z.string().email().optional(),
  billingTerms: z.string().max(500).optional(),
  defaultCurrency: z.string().length(3).default('USD'),
  // Values for network-defined custom fields → merged into metadata.custom.
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export const updateAdvertiserSchema = createAdvertiserSchema.partial();

export type CreateAdvertiser = z.infer<typeof createAdvertiserSchema>;
export type UpdateAdvertiser = z.infer<typeof updateAdvertiserSchema>;

export const debugPostbackSchema = z.object({
  url: z.string().url().max(2000),
  method: z.enum(['GET', 'POST']).default('GET'),
  country: z.string().max(3).optional(),
  device: z.string().max(40).optional(),
});
export type DebugPostback = z.infer<typeof debugPostbackSchema>;
