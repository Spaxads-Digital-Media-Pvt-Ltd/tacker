/**
 * Reporting provider selection (spec §9, Task 8.7).
 *
 * The single source of truth — every surface calls `getReportingProvider()` and never imports
 * a concrete store. `installReportingProvider()` (./clickhouse.ts) wires the configured
 * provider at boot based on REPORTING_PROVIDER.
 */
import type { ReportingProvider } from './types.js';
import { PostgresReportingProvider } from './postgres.js';

export { ClickHouseReportingProvider } from './clickhouse-provider.js';
export { ClickHouseWithFallbackReportingProvider } from './clickhouse-fallback.js';
export { PostgresReportingProvider } from './postgres.js';

let provider: ReportingProvider = new PostgresReportingProvider();

export function getReportingProvider(): ReportingProvider {
 return provider;
}

export function setReportingProvider(next: ReportingProvider): void {
 provider = next;
}

export type { Dimension, Metric, ReportRequest, ReportResult, ReportRow, ReportFilters } from './types.js';
