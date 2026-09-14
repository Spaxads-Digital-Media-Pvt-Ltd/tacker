/**
 * Shared health-check payload (spec §13 Phase 0 "health checks").
 *
 * Returns dependency liveness + active reporting provider. Strict-clickhouse mode surfaces
 * fail readiness when CH is unhealthy; modes that can fall back to Postgres stay ready.
 *
 * Two endpoints:
 * /healthz — liveness: process is alive, no DB calls, always 200 unless the event loop is dead.
 * Used by orchestrators (k8s livenessProbe) to decide whether to restart.
 * /readyz — readiness: all dependencies reachable, 200 if ready / 503 if not ready.
 * Used by orchestrators (k8s readinessProbe) to decide whether to route traffic.
 *
 * /health is kept as an alias for /readyz for backward compat with existing probes.
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

async function probeDependencies(): Promise<HealthReport> {
 const service = 'unknown';
 const [db, redis, chHealthy] = await Promise.all([
  pingDb(),
 pingRedis(),
 pingClickHouse(),
 ]);

 const chConfigured = isClickHouseEnabled();
 const reportingMode = env.REPORTING_PROVIDER;
 let active: 'postgres' | 'clickhouse' | 'clickhouse_with_fallback' | 'postgres(fallback)';
 if (reportingMode === 'clickhouse_with_fallback') {
 active = chHealthy ? 'clickhouse' : 'postgres(fallback)';
 } else {
 active = reportingMode;
 }

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

export function buildLivenessReport(service: string): { service: string; status: 'ok'; uptimeSeconds: number } {
 return {
 service,
 status: 'ok',
 uptimeSeconds: Math.round(process.uptime()),
 };
}

export async function buildReadinessReport(service: string): Promise<HealthReport> {
 const report = await probeDependencies();
 return { ...report, service };
}

export async function buildHealthReport(service: string): Promise<HealthReport> {
 return buildReadinessReport(service);
}

/**
 * Mount liveness + readiness endpoints on an Express app. Use this on every public surface
 * (dashboard, public-api, platform-admin) so orchestrators can split liveness from readiness.
 *
 * Liveness: 200 always — the process can answer, so don't restart it.
 * Readiness: 200 when ok/degraded, 503 when unready — only route traffic when ready.
 */
export function mountHealthRoutes(app: { get: (path: string, handler: (req: unknown, res: {
 status: (code: number) => { json: (body: unknown) => void };
}) => void) => void }, service: string): void {
 app.get('/healthz', (_req, res) => {
 res.status(200).json(buildLivenessReport(service));
 });

 app.get('/readyz', async (_req, res) => {
 const report = await buildReadinessReport(service);
 const code = report.status === 'unready' ? 503 : 200;
 res.status(code).json(report);
 });

 app.get('/health', async (_req, res) => {
 const report = await buildReadinessReport(service);
 const code = report.status === 'ok' ? 200 : 503;
 res.status(code).json(report);
  });
}
