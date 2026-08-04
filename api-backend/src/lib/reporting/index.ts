/**
 * Reporting provider selection (spec §9). One place to swap Postgres → ClickHouse (Phase 8) without
 * touching any caller.
 */
import type { ReportingProvider } from './types.js';
import { PostgresReportingProvider } from './postgres.js';

let provider: ReportingProvider = new PostgresReportingProvider();

export function getReportingProvider(): ReportingProvider {
  return provider;
}
export function setReportingProvider(next: ReportingProvider): void {
  provider = next;
}

export type { Dimension, Metric, ReportRequest, ReportResult, ReportRow, ReportFilters } from './types.js';
