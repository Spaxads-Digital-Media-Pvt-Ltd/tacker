/**
 * A fixed-window counter in Redis for low-volume actions (password-reset requests and redemptions,
 * saved-report sends): the first hit opens a window of `windowSeconds`; true = this hit is over
 * `limit`, refuse it. Fails open — a Redis outage must not stop the action — and says so in the log.
 */
import { getRedis } from './redis.js';
import { logger } from './logger.js';

export async function overFixedWindow(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const redis = getRedis();
    await redis.set(key, '0', 'EX', windowSeconds, 'NX');
    return (await redis.incr(key)) > limit;
  } catch (err) {
    logger.warn({ err, limiter: key.split(':')[0] }, 'rate limiter: Redis unavailable — failing open');
    return false;
  }
}
