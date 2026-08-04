/**
 * Shared Redis connection (spec §2 hot layer). Used for config cache, atomic cap counters,
 * dedup/idempotency, and as the BullMQ backend.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on its connection; we expose a factory for
 * that case and a shared client for general cache/counter use.
 */
import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

let shared: Redis | null = null;

export function getRedis(): Redis {
  if (!shared) {
    shared = new Redis(env.REDIS_URL, { lazyConnect: false });
    shared.on('error', (err) => logger.error({ err }, 'redis error'));
  }
  return shared;
}

/** BullMQ needs its own connection with retry semantics disabled. */
export function makeQueueConnection(overrides: RedisOptions = {}): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    ...overrides,
  });
  client.on('error', (err) => logger.error({ err }, 'redis (queue) error'));
  return client;
}

export async function pingRedis(): Promise<boolean> {
  try {
    const res = await getRedis().ping();
    return res === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (shared) {
    await shared.quit();
    shared = null;
  }
}
