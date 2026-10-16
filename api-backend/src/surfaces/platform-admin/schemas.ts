import { z } from 'zod';
import { passwordSchema } from '../../lib/auth/password-policy.js';
import { paginationSchema } from '../../lib/http/pagination.js';

export const loginSchema = z.object({
 email: z.string().email(),
 password: passwordSchema,
});

export const createNetworkSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(63).regex(/^[a-z0-9-]+$/, 'use only lowercase letters, digits and hyphens (e.g. "acme-media")'),
  defaultCurrency: z.string().length(3).default('USD'),
  // Optional: provision the first admin admin login + a subdomain tracking host during onboarding.
  owner: z
    .object({
      email: z.string().email(),
      password: passwordSchema,
      name: z.string().max(200).optional(),
    })
    .optional(),
  provisionSubdomain: z.boolean().default(true),
});

/** GET /platform/networks — paged; `q` searches name, slug and team emails; `plan` is a plan code or 'none'. */
export const networkListSchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
  plan: z.string().trim().max(50).optional(),
}).strict();
export type NetworkListQuery = z.infer<typeof networkListSchema>;

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

export type Login = z.infer<typeof loginSchema>;

export type CreateNetwork = z.infer<typeof createNetworkSchema>;
export type UpdateNetwork = z.infer<typeof updateNetworkSchema>;
export type CreatePlan = z.infer<typeof createPlanSchema>;
export type AssignSubscription = z.infer<typeof assignSubscriptionSchema>;

/** POST /platform/networks/:id/purge (F-26): `confirm` must be the network's slug. */
export const purgeNetworkSchema = z.object({
  confirm: z.string().min(1).max(100),
  acknowledgeNoExport: z.boolean().default(false),
});
export type PurgeNetwork = z.infer<typeof purgeNetworkSchema>;
