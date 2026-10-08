/**
 * One explicit ceiling for whole-list endpoints. The SPA filters these lists client-side over
 * the full response, so a small LIMIT silently hides rows. LIST_CAP is a constant (never user
 * input) and every capped list calls warnIfCapped so truncation is visible in the logs.
 */
import { logger } from '../logger.js';

export const LIST_CAP = 10_000;

/** Logs a warning when a list query came back at (or above) its cap. */
export function warnIfCapped<T>(rows: readonly T[], cap: number, context: string): void {
  if (rows.length >= cap) {
    logger.warn({ context, cap }, 'list hit LIST_CAP — results truncated');
  }
}
