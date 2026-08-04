/**
 * Centralized, validated environment loading (spec §3B "env handling", §12 input validation).
 *
 * Every secret enters the process HERE and nowhere else. Surfaces import `env`, never
 * `process.env` directly, so we get one typed, fail-fast source of truth.
 *
 * Fail-fast: if a required var is missing/malformed at boot, we throw with a clear message
 * rather than limping along and failing deep in a request.
 */
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  DATABASE_URL: z.string().url(),

  // Supabase — backend-only secrets. Optional at Phase 0 boot so the scaffold runs
  // before a real project is wired; surfaces that need them assert at use-time.
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),

  PLATFORM_ADMIN_JWT_SECRET: z.string().min(1).optional(),

  REDIS_URL: z.string().url(),

  TRACKING_BASE_DOMAIN: z.string().min(1).default('ourtracking.com'),

  PORT_DASHBOARD: z.coerce.number().int().positive().default(4001),
  PORT_TRACKING: z.coerce.number().int().positive().default(4002),
  PORT_PUBLIC_API: z.coerce.number().int().positive().default(4003),
  PORT_PLATFORM_ADMIN: z.coerce.number().int().positive().default(4004),
  PORT_WORKERS_HEALTH: z.coerce.number().int().positive().default(4005),

  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  MAXMIND_LICENSE_KEY: z.string().min(1).optional(),

  // Error tracking (spec §2 observability). Optional: without a DSN the Sentry hook is a no-op.
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

  // Retention (spec §7/§11 data lifecycle). Days to keep raw clicks/conversions before the
  // retention job prunes them; 0 disables pruning.
  CLICK_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),
  CONVERSION_RETENTION_DAYS: z.coerce.number().int().min(0).default(400),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
