/**
 * Structured JSON logging (spec §2 observability). One base logger; each surface derives a
 * child with its `surface` field so logs are filterable per service.
 *
 * NEVER log secrets/PII/tokens (spec §3A). `redact` scrubs common sensitive paths; keep it
 * updated as fields are added.
 */
import { pino } from 'pino';
import { env, isProd } from '../config/env.js';
import { BRAND } from '../config/branding.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { app: BRAND.slug },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      '*.password',
      '*.token',
      '*.apiKey',
      '*.key_hash',
      '*.service_role',
    ],
    censor: '[redacted]',
  },
  // Pretty transport only outside prod would require pino-pretty; keep JSON everywhere for
  // consistency and to avoid an extra dep. Flip here if desired later.
  transport: undefined,
});

export function surfaceLogger(surface: string) {
  return logger.child({ surface });
}

void isProd; // reserved: prod-specific logger tweaks later.
