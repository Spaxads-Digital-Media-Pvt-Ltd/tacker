/**
 * ClickHouse reporting provider with automatic Postgres fallback (Task 8.7).
 *
 * Tries ClickHouse first; on infrastructure failure falls back to Postgres.
 * Falls back ONLY for genuine infrastructure errors (connection refused, network timeout,
 * connection reset). Does NOT fall back for: invalid input, tenant/auth errors, programmer
 * errors, or configuration errors — those must fail fast so operators can fix the root cause.
 *
 * Once an infrastructure error is observed, all subsequent calls go directly to Postgres for
 * the lifetime of this instance (avoids repeated failing CH attempts during an outage).
 *
 * Structured logs include: network_id, dimensions, date range, duration, provider used,
 * and whether fallback was triggered. No secrets, JWT tokens, passwords, or raw headers are
 * ever logged.
 *
 * Unexpected CH failures (not due to known infra errors) are forwarded to Sentry via
 * captureError so ops can investigate.
 */
import { logger } from '../logger.js';
import { captureError, sentryEnabled } from '../observability/sentry.js';
import { getClickHouse } from '../clickhouse/client.js';
import { ClickHouseReportingProvider } from './clickhouse-provider.js';
import { PostgresReportingProvider } from './postgres.js';
import type { ReportRequest, ReportResult, ReportingProvider } from './types.js';

/** Error codes that indicate a genuine ClickHouse infrastructure failure. */
function isInfrastructureError(err: unknown): boolean {
 if (!err || typeof err !== 'object') return false;
 const code = (err as { code?: string }).code;
 if (typeof code === 'string') {
 return (
 code === 'ECONNREFUSED' ||
 code === 'ECONNRESET' ||
 code === 'ETIMEDOUT' ||
 code === 'ENOTFOUND' ||
 code === 'EAI_AGAIN' ||
 code === 'ECONNABORTED' ||
 code === 'UND_ERR_CONNECT_TIMEOUT' ||
 code === 'UND_ERR_CONNECT_RESET'
 );
 }
 const name = (err as { name?: string }).name;
 if (name === 'AbortError') return true;
 return false;
}

export class ClickHouseWithFallbackReportingProvider implements ReportingProvider {
 private readonly chProvider: ClickHouseReportingProvider;
 private readonly pgProvider: PostgresReportingProvider;
 private chUnreachable = false;

 constructor(chProvider?: ClickHouseReportingProvider, pgProvider?: PostgresReportingProvider) {
 this.chProvider = chProvider ?? new ClickHouseReportingProvider(getClickHouse());
 this.pgProvider = pgProvider ?? new PostgresReportingProvider();
 }

 async runReport(req: ReportRequest): Promise<ReportResult> {
 const dimensions = req.groupBy.join(',') || '(none)';
 const dateRange = req.filters.from && req.filters.to
 ? `${req.filters.from} → ${req.filters.to}`
 : '(no range)';

 // If CH has been marked unreachable for this instance lifetime, skip straight to PG.
 if (this.chUnreachable) {
 const t0 = Date.now();
 try {
 const result = await this.pgProvider.runReport(req);
 const durationMs = Date.now() - t0;
 logger.info(
 { networkId: req.networkId, dimensions, dateRange, durationMs, provider: 'postgres', fallback: true, cached: true },
 'report: pg-fallback-cached',
 );
 return result;
 } catch (err) {
 const durationMs = Date.now() - t0;
 logger.error(
 { networkId: req.networkId, dimensions, dateRange, durationMs, provider: 'postgres', fallback: true, err },
 'report: pg-fallback-cached-error',
 );
 throw err;
 }
 }

 // Try ClickHouse first.
 const t0 = Date.now();
 try {
 const result = await this.chProvider.runReport(req);
 const durationMs = Date.now() - t0;
 logger.info(
 { networkId: req.networkId, dimensions, dateRange, durationMs, provider: 'clickhouse', fallback: false },
 'report: clickhouse-ok',
 );
 return result;
 } catch (err) {
 const durationMs = Date.now() - t0;
 const infra = isInfrastructureError(err);

 if (!infra) {
 // Non-infrastructure error: fail fast. Do NOT fall back.
 const errName = (err as { name?: string })?.name ?? 'unknown';
 const errMsg = (err as { message?: string })?.message ?? String(err);
 logger.error(
 { networkId: req.networkId, dimensions, dateRange, durationMs, provider: 'clickhouse', fallback: false, err: { name: errName, message: errMsg } },
 'report: clickhouse-error-nofallback',
 );
 if (sentryEnabled()) {
 captureError(err, {
 phase: 'reporting',
 networkId: req.networkId,
 dimensions,
 dateRange,
 provider: 'clickhouse',
 fallback: false,
 errorType: errName,
 });
 }
 throw err;
 }

 // Infrastructure failure — fall back to Postgres. Mark CH unreachable for this instance.
 this.chUnreachable = true;
 const chCode = (err as { code?: string })?.code;
 const chMsg = (err as { message?: string })?.message ?? String(err);
 logger.warn(
 { networkId: req.networkId, dimensions, dateRange, durationMs, provider: 'postgres', fallback: true, chError: { code: chCode, message: chMsg } },
 'report: fallback-triggered',
 );
 if (sentryEnabled()) {
 captureError(err, {
 phase: 'reporting-fallback',
 networkId: req.networkId,
 dimensions,
 dateRange,
 provider: 'clickhouse',
 fallback: true,
 infra: true,
 chErrorCode: (err as { code?: string }).code,
 });
 }

 const pgT0 = Date.now();
 try {
 const result = await this.pgProvider.runReport(req);
 const pgDurationMs = Date.now() - pgT0;
 logger.info(
 { networkId: req.networkId, dimensions, dateRange, durationMs: pgDurationMs, provider: 'postgres', fallback: true },
 'report: pg-fallback-ok',
 );
 return result;
 } catch (pgErr) {
 const pgDurationMs = Date.now() - pgT0;
 logger.error(
 { networkId: req.networkId, dimensions, dateRange, durationMs: pgDurationMs, provider: 'postgres', fallback: true, err: pgErr },
 'report: pg-fallback-error',
 );
 throw pgErr;
 }
 }
 }
}
