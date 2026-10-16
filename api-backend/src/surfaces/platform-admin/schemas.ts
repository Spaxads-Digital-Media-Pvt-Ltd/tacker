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

const currencyCode = z.string().regex(/^[A-Za-z]{3}$/, 'must be a 3-letter currency code (e.g. USD)').transform((c) => c.toUpperCase());
/** Money as text — never a float: "99", "99.5" or "99.50". */
const amount = z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, 'must be an amount like 99 or 99.50');
/** Plan limits: clicks / conversions / events per period, offers / seats as counts (lib/usage/meter.ts). */
const planLimits = z.record(z.string(), z.union([z.number(), z.string(), z.boolean()]));

export const createPlanSchema = z.object({
  code: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/, 'use only lowercase letters, digits, - and _'),
  name: z.string().min(1).max(200),
  priceCents: z.number().int().min(0).max(1_000_000_000),
  currency: currencyCode.default('USD'),
  billingInterval: z.enum(['month', 'year']).default('month'),
  trialDays: z.number().int().min(0).max(365).default(0),
  description: z.string().max(1000).nullable().optional(),
  limits: planLimits.default({}),
}).strict();

/** Everything but the code (a plan's code is its stable identity). Price changes apply to the next invoices. */
export const updatePlanSchema = createPlanSchema.omit({ code: true }).partial().strict();

export const assignSubscriptionSchema = z.object({
  planId: z.string().uuid(),
  /** A free trial instead of the plan's own; 0 = start paying now. Ignored when changing a live plan. */
  trialDays: z.number().int().min(0).max(365).optional(),
}).strict();

export const cancelSubscriptionSchema = z.object({ atPeriodEnd: z.boolean().default(true) }).strict();
export const extendTrialSchema = z.object({ days: z.number().int().min(1).max(365) }).strict();

export const invoiceListSchema = paginationSchema.extend({
  status: z.enum(['open', 'overdue', 'paid', 'void', 'all']).default('all'),
  networkId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
}).strict();
export type InvoiceListQuery = z.infer<typeof invoiceListSchema>;

/** A one-off invoice (a setup fee, a custom charge). */
export const manualInvoiceSchema = z.object({
  description: z.string().trim().min(1).max(300),
  amount,
  currency: currencyCode.optional(),
  dueDays: z.number().int().min(0).max(180).optional(),
  notes: z.string().max(1000).nullable().optional(),
}).strict();

export const markPaidSchema = z.object({
  method: z.enum(['bank_transfer', 'upi', 'card', 'cash', 'cheque', 'other']),
  reference: z.string().trim().max(200).nullable().optional(),
  paidAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)')).optional(),
  amount: amount.optional(),
}).strict();

/** More time before the network is suspended: a number of days added, or a new date. */
export const extendInvoiceSchema = z.object({
  days: z.number().int().min(1).max(365).optional(),
  suspendAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)').optional(),
}).strict().refine((v) => (v.days === undefined) !== (v.suspendAt === undefined), { message: 'Give either days or suspendAt' });

export const voidInvoiceSchema = z.object({ reason: z.string().trim().min(1).max(300) }).strict();

export const billingSettingsSchema = z.object({
  invoicePrefix: z.string().trim().regex(/^[A-Z0-9-]{1,12}$/, 'use 1–12 capital letters, digits or -'),
  dueDays: z.number().int().min(0).max(180),
  graceDays: z.number().int().min(0).max(180),
  taxRate: z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, 'must be a percentage like 18 or 7.5').refine((v) => Number(v) <= 100, 'must be at most 100'),
  autoSuspend: z.boolean(),
  seller: z.object({
    name: z.string().trim().max(200), address: z.string().trim().max(1000),
    taxId: z.string().trim().max(100), email: z.union([z.literal(''), z.string().trim().email()]),
  }).strict(),
  paymentInstructions: z.string().trim().max(2000),
}).strict();

export type Login = z.infer<typeof loginSchema>;

export type CreateNetwork = z.infer<typeof createNetworkSchema>;
export type UpdateNetwork = z.infer<typeof updateNetworkSchema>;
export type CreatePlan = z.infer<typeof createPlanSchema>;
export type UpdatePlan = z.infer<typeof updatePlanSchema>;
export type AssignSubscription = z.infer<typeof assignSubscriptionSchema>;

/** POST /platform/networks/:id/purge (F-26): `confirm` must be the network's slug. */
export const purgeNetworkSchema = z.object({
  confirm: z.string().min(1).max(100),
  acknowledgeNoExport: z.boolean().default(false),
});
export type PurgeNetwork = z.infer<typeof purgeNetworkSchema>;
