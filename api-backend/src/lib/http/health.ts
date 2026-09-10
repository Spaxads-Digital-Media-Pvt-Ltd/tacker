/**
 * Shared health-check payload (spec §13 Phase 0 "health checks").
 *
 * Returns dependency liveness + active reporting provider. Strict-clickhouse mode surfaces
 * fail readiness when CH is unhealthy; modes that can fall back to Postgres stay ready.
 */
import { pingDb } from '../db/pool.js';
import { pingRedis } from '../redis.js';
import { pingClickHouse, isClickHouseEnabled } from '../clickhouse/client.js';
import { BRAND } from '../../config/branding.js';
import { env } from '../../config/env.js';

export interface HealthReport {
 service: string;
 brand: string;
 status: 'ok' | 'degraded' | 'unready';
 uptimeSeconds: number;
 checks: { db: boolean; redis: boolean; clickhouse: boolean };
 clickhouse: { configured: boolean; healthy: boolean };
 reporting: {
 configured: string;
 active: 'postgres' | 'clickhouse' | 'clickhouse_with_fallback' | 'postgres(fallback)';
 };
 timestamp: string;
}

export async function buildHealthReport(service: string): Promise<HealthReport> {
 const [db, redis, chHealthy] = await Promise.all([
 pingDb(),
 pingRedis(),
 pingClickHouse(),
 ]);

 const chConfigured = isClickHouseEnabled();
 const reportingMode = env.REPORTING_PROVIDER;
 // Default: the active provider matches the configured mode unless CH is down + fallback is on.
 // We can't observe the provider state machine directly without coupling; report the configured mode.
 let active: 'postgres' | 'clickhouse' | 'clickhouse_with_fallback' | 'postgres(fallback)';
 if (reportingMode === 'clickhouse_with_fallback') {
 active = chHealthy ? 'clickhouse' : 'postgres(fallback)';
 } else {
 active = reportingMode;
 }

 // Readiness policy:
 // - app always alive if it can answer /health
 // - strict clickhouse mode → degraded when CH unhealthy (since user-facing reports will fail)
 // - postgres / fallback modes → degraded when PG/Redis down (CH optional)
 let status: 'ok' | 'degraded' | 'unready' = 'ok';
 if (!db || !redis) status = 'degraded';
 if (reportingMode === 'clickhouse' && !chHealthy) status = 'degraded';

 return {
 service,
 brand: BRAND.name,
 status,
 uptimeSeconds: Math.round(process.uptime()),
 checks: { db, redis, clickhouse: chHealthy },
 clickhouse: { configured: chConfigured, healthy: chHealthy },
 reporting: { configured: reportingMode, active },
 timestamp: new Date().toISOString(),
 };
}
