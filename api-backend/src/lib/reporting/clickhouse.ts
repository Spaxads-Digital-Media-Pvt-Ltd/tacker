/**
 * Reporting-provider installer (Task 8.7).
 *
 * Picks the concrete ReportingProvider based on `REPORTING_PROVIDER` env var:
 * postgres (default, safe) | clickhouse (strict, fail-fast) | clickhouse_with_fallback (CH first, PG on infra failure).
 *
 * When `REPORTING_PROVIDER` requests a ClickHouse mode but `CLICKHOUSE_URL` is not set,
 * we log a warning and install Postgres so the app never crashes at boot.
 */
import { env } from '../../config/env.js';
import { logger } from '../logger.js';
import { setReportingProvider } from './index.js';
import { isClickHouseEnabled } from '../clickhouse/client.js';
import { ClickHouseReportingProvider } from './clickhouse-provider.js';
import { PostgresReportingProvider } from './postgres.js';
import { ClickHouseWithFallbackReportingProvider } from './clickhouse-fallback.js';

export { ClickHouseReportingProvider } from './clickhouse-provider.js';
export { PostgresReportingProvider } from './postgres.js';
export { ClickHouseWithFallbackReportingProvider } from './clickhouse-fallback.js';

/**
 * Install the configured reporting provider.
 * Returns the name of the active provider: 'postgres' | 'clickhouse' | 'clickhouse_with_fallback'.
 */
export function installReportingProvider(): string {
 const mode = env.REPORTING_PROVIDER;

 if (mode === 'postgres') {
 setReportingProvider(new PostgresReportingProvider());
 logger.info('reporting provider: postgres');
 return 'postgres';
 }

 if (!isClickHouseEnabled()) {
 logger.warn(
 'REPORTING_PROVIDER=clickhouse* requested but CLICKHOUSE_URL not set — falling back to Postgres',
 );
 setReportingProvider(new PostgresReportingProvider());
 return 'postgres';
 }

 if (mode === 'clickhouse') {
 setReportingProvider(new ClickHouseReportingProvider());
 logger.info('reporting provider: clickhouse (strict)');
 return 'clickhouse';
 }

 if (mode === 'clickhouse_with_fallback') {
 setReportingProvider(new ClickHouseWithFallbackReportingProvider());
 logger.info('reporting provider: clickhouse_with_fallback');
 return 'clickhouse_with_fallback';
 }

 // Should be unreachable — zod validates REPORTING_PROVIDER at boot — but defensive.
 logger.error('unknown REPORTING_PROVIDER — using Postgres');
 setReportingProvider(new PostgresReportingProvider());
 return 'postgres';
}
