import { z } from 'zod';

export const createNetworkSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(63).regex(/^[a-z0-9-]+$/, 'lowercase letters, digits, hyphens'),
  defaultCurrency: z.string().length(3).default('USD'),
  // Optional: provision the first admin admin login + a subdomain tracking host during onboarding.
  owner: z
    .object({
      email: z.string().email(),
      password: z.string().min(8).max(200),
      name: z.string().max(200).optional(),
    })
    .optional(),
  provisionSubdomain: z.boolean().default(true),
});

export const updateNetworkSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
});

export const createPlanSchema = z.object({
  code: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1).max(200),
  priceCents: z.number().int().min(0),
  currency: z.string().length(3).default('USD'),
  limits: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
});

export const assignSubscriptionSchema = z.object({
  planId: z.string().uuid(),
  status: z.enum(['trialing', 'active', 'past_due', 'canceled']).default('active'),
  currentPeriodStart: z.string().datetime().optional(),
  currentPeriodEnd: z.string().datetime().optional(),
  renewsAt: z.string().datetime().optional(),
});

export type CreateNetwork = z.infer<typeof createNetworkSchema>;
export type UpdateNetwork = z.infer<typeof updateNetworkSchema>;
export type CreatePlan = z.infer<typeof createPlanSchema>;
export type AssignSubscription = z.infer<typeof assignSubscriptionSchema>;
