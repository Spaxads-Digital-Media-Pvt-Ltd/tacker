/**
 * Sentry error tracking (spec §2 observability). Entirely optional: with no SENTRY_DSN set, every
 * function here is a no-op, so local/dev and self-hosters pay nothing. @sentry/node is imported
 * lazily inside initSentry so the dependency is only touched when actually enabled.
 *
 * Secrets rule (spec §3A): the DSN lives in backend env only. Nothing here is ever shipped to the
 * frontend.
 */
import { env, isProd } from '../../config/env.js';
import { surfaceLogger } from '../logger.js';

type SentryModule = typeof import('@sentry/node');

let sentry: SentryModule | null = null;

/** Call once at surface boot. Safe to call when SENTRY_DSN is unset (becomes a no-op). */
export async function initSentry(surface: string): Promise<void> {
  const log = surfaceLogger(surface);
  if (!env.SENTRY_DSN) {
    log.debug('sentry disabled (no SENTRY_DSN)');
    return;
  }
  try {
    const mod = await import('@sentry/node');
    mod.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
      // Don't send PII (IPs live in tenant data, not in error reports) — spec §11.
      sendDefaultPii: false,
      initialScope: { tags: { surface } },
    });
    sentry = mod;
    log.info({ surface }, 'sentry initialized');
  } catch (err) {
    // Never let observability wiring take down a surface.
    log.error({ err }, 'sentry init failed; continuing without error tracking');
  }
}

/** Report an unhandled error. No-op when Sentry is disabled. */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!sentry) return;
  sentry.captureException(err, context ? { extra: context } : undefined);
}

/** Flush buffered events on shutdown so nothing is lost. No-op when disabled. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!sentry) return;
  try {
    await sentry.flush(timeoutMs);
  } catch {
    // best-effort
  }
}

export function sentryEnabled(): boolean {
  return sentry !== null;
}

// Referenced only to keep the isProd import meaningful for callers that gate sampling; exported so
// surface boots can decide whether to raise the trace rate in production.
export const recommendedTraceRate = isProd ? env.SENTRY_TRACES_SAMPLE_RATE : 0;
