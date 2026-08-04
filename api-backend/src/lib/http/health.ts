/**
 * Shared health-check payload (spec §13 Phase 0 "health checks"). Every surface exposes
 * `GET /health`; workers expose it on a tiny probe server. Returns dependency liveness.
 */
import { pingDb } from '../db/pool.js';
import { pingRedis } from '../redis.js';
import { BRAND } from '../../config/branding.js';

export interface HealthReport {
  service: string;
  brand: string;
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  checks: { db: boolean; redis: boolean };
  timestamp: string;
}

export async function buildHealthReport(service: string): Promise<HealthReport> {
  const [db, redis] = await Promise.all([pingDb(), pingRedis()]);
  return {
    service,
    brand: BRAND.name,
    status: db && redis ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    checks: { db, redis },
    timestamp: new Date().toISOString(),
  };
}
