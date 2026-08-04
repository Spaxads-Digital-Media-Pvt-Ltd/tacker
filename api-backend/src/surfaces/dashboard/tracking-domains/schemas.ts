import { z } from 'zod';

const hostname = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i, 'Must be a valid FQDN');

/**
 * Two link-generation modes (spec §3D):
 *  - subdomain: provide `subdomain` label; host becomes `<label>.<TRACKING_BASE_DOMAIN>`.
 *  - custom:    provide the full `host` (their CNAME target). Requires verification before use.
 */
export const createTrackingDomainSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('subdomain'),
    subdomain: z.string().min(1).max(63).regex(/^[a-z0-9-]+$/i, 'Invalid subdomain label'),
    isPrimary: z.boolean().default(false),
  }),
  z.object({
    mode: z.literal('custom'),
    host: hostname,
    isPrimary: z.boolean().default(false),
  }),
]);

export type CreateTrackingDomain = z.infer<typeof createTrackingDomainSchema>;
