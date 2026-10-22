/**
 * Requested Reports (Reporting › Saved & Scheduled) — report files built in the background. A user asks
 * for a saved report over a range ("Request export"): the row is queued, the report-exports worker
 * builds the file (lib/reporting/saved-reports.ts buildReportFile — the page's filters, metric filters,
 * sort and hidden columns, up to EXPORT_MAX_ROWS rows) and stores it gzipped. A scheduled report too big
 * to email leaves its whole file here too (storeFinishedReport). Files are downloaded through the
 * authenticated API only (never a public URL) and pruned after REPORT_REQUEST_RETENTION_DAYS.
 *
 * Who sees what follows saved reports: everyone their own requests; admins and managers the network's.
 */
import { gzipSync, gunzipSync } from 'node:zlib';
import { query } from '../db/pool.js';
import { logger } from '../logger.js';
import { getQueue, QUEUE } from '../queues.js';
import {
  buildReportFile, datesRange, presetRange, reportCsv, reportFileName, networkTimeZone,
  type RangePreset, type ReportFile, type ReportRange, type SavedReportPage,
} from './saved-reports.js';

export { REPORT_REQUEST_RETENTION_DAYS } from '../retention/retention.js';
/** A request still "processing" after this long was interrupted (worker restart) — it is marked failed. */
const STALE_PROCESSING_MS = 30 * 60_000;

export interface ReportRequestRow {
  id: string; ref: string; network_id: string; requested_by: string; saved_report_id: string | null;
  name: string; page: SavedReportPage; config: Record<string, unknown>;
  range_from: string; range_to: string | null; range_label: string; source: 'manual' | 'scheduled'; format: 'csv';
  status: 'queued' | 'processing' | 'done' | 'failed'; row_count: number | null; total_rows: number | null; truncated: boolean;
  file_bytes: number | null; error: string | null; started_at: Date | null; processed_at: Date | null; created_at: Date;
}

/** Every column but the file itself (lists never carry it). */
export const REQUEST_COLUMNS = `id, ref, network_id, requested_by, saved_report_id, name, page, config, range_from, range_to, range_label,
  source, format, status, row_count, total_rows, truncated, file_bytes, error, started_at, processed_at, created_at`;

export const reportRequestDto = (r: ReportRequestRow, requestedByName?: string | null) => ({
  id: r.id, ref: Number(r.ref), name: r.name, page: r.page, format: r.format, source: r.source,
  savedReportId: r.saved_report_id, range: { from: r.range_from, to: r.range_to, label: r.range_label },
  status: r.status, rows: r.row_count, totalRows: r.total_rows, truncated: r.truncated, fileBytes: r.file_bytes,
  error: r.error, requestedBy: r.requested_by, requestedByName: requestedByName ?? null,
  processedAt: r.processed_at, createdAt: r.created_at,
});

/** The range a request covers: a preset (rolling, as of now) or whole days of the network's zone. */
export async function requestRange(networkId: string, spec: { rangePreset?: RangePreset; from?: string; to?: string }, now = new Date()): Promise<ReportRange> {
  const tz = await networkTimeZone(networkId);
  if (spec.from && spec.to) return datesRange(spec.from, spec.to, tz);
  return presetRange(spec.rangePreset ?? 'yesterday', now, tz);
}

/** Queue an export; the report-exports worker builds it. */
export async function createReportRequest(networkId: string, r: {
  requestedBy: string; savedReportId: string | null; name: string; page: SavedReportPage; config: Record<string, unknown>; range: ReportRange;
}): Promise<ReportRequestRow> {
  const { rows } = await query<ReportRequestRow>(
    `INSERT INTO report_requests (network_id, requested_by, saved_report_id, name, page, config, range_from, range_to, range_label, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual') RETURNING ${REQUEST_COLUMNS}`,
    [networkId, r.requestedBy, r.savedReportId, r.name, r.page, JSON.stringify(r.config), r.range.from, r.range.to ?? null, r.range.label]);
  const row = rows[0]!;
  await enqueueReportExport(row.id);
  return row;
}

export async function enqueueReportExport(id: string): Promise<void> {
  try {
    // jobId dedups a re-queue of the same request (the sweep below); BullMQ ids can't hold ':'.
    await getQueue(QUEUE.reportExports).add('export', { id }, { jobId: `rr-${id}`, removeOnComplete: 100, removeOnFail: 100 });
  } catch (err) {
    // Redis trouble: the row stays queued and the sweep picks it up.
    logger.warn({ err, reportRequestId: id }, 'report export not enqueued — the sweep will retry');
  }
}

function packFile(file: ReportFile): { bytes: Buffer; rows: number } {
  const csv = reportCsv(file.result, file.metrics);
  return { bytes: gzipSync(Buffer.from(csv, 'utf8')), rows: file.result.rows.length };
}

/** Store a file built elsewhere (a scheduled report too big to email) as a finished request; returns its ref. */
export async function storeFinishedReport(networkId: string, r: {
  requestedBy: string; savedReportId: string | null; name: string; page: SavedReportPage; config: Record<string, unknown>;
  file: ReportFile; source: 'manual' | 'scheduled';
}): Promise<string> {
  const { bytes, rows } = packFile(r.file);
  const { rows: out } = await query<{ ref: string }>(
    `INSERT INTO report_requests (network_id, requested_by, saved_report_id, name, page, config, range_from, range_to, range_label, source,
                                  status, row_count, total_rows, truncated, file, file_bytes, started_at, processed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'done', $11, $12, $13, $14, $15, now(), now()) RETURNING ref`,
    [networkId, r.requestedBy, r.savedReportId, r.name, r.page, JSON.stringify(r.config), r.file.range.from, r.file.range.to ?? null,
      r.file.range.label, r.source, rows, r.file.groups, r.file.truncated, bytes, bytes.length]);
  return String(out[0]!.ref);
}

/**
 * Build one queued request (the worker's job). Claimed with a status change, so two workers never build
 * the same file; a failure is recorded on the request (never thrown into a retry loop).
 */
export async function processReportRequest(id: string, now = new Date()): Promise<'done' | 'failed' | 'skipped'> {
  const { rows } = await query<ReportRequestRow>(
    `UPDATE report_requests SET status = 'processing', started_at = now()
      WHERE id = $1 AND status = 'queued' RETURNING ${REQUEST_COLUMNS}`, [id]);
  const r = rows[0];
  if (!r) return 'skipped';
  try {
    const range: ReportRange = { from: r.range_from, ...(r.range_to ? { to: r.range_to } : {}), label: r.range_label };
    const file = await buildReportFile(r.network_id, r.page, r.config ?? {}, range, now);
    const { bytes, rows: n } = packFile(file);
    await query(
      `UPDATE report_requests SET status = 'done', row_count = $3, total_rows = $4, truncated = $5, file = $6, file_bytes = $7,
              error = $8, processed_at = now()
        WHERE id = $1 AND network_id = $2`,
      [r.id, r.network_id, n, file.groups, file.truncated, bytes, bytes.length,
        file.moneyFilterSkipped ? 'A payout / revenue filter was not applied — the rows are in more than one currency.' : null]);
    return 'done';
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Export failed';
    logger.warn({ err, reportRequestId: r.id }, 'report export failed');
    await query(`UPDATE report_requests SET status = 'failed', error = $3, processed_at = now() WHERE id = $1 AND network_id = $2`,
      [r.id, r.network_id, msg.slice(0, 500)]);
    return 'failed';
  }
}

/**
 * The sweep (every few minutes): a queued request whose job never ran (Redis was down) is queued again;
 * one stuck in processing (the worker restarted mid-build) is marked failed so it can be requested again.
 */
export async function sweepReportRequests(now = new Date()): Promise<{ requeued: number; failed: number }> {
  const stale = new Date(now.getTime() - STALE_PROCESSING_MS);
  const failed = (await query(
    `UPDATE report_requests SET status = 'failed', error = 'Interrupted — request it again.', processed_at = now()
      WHERE status = 'processing' AND started_at < $1`, [stale])).rowCount ?? 0;
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM report_requests WHERE status = 'queued' AND created_at < $1 ORDER BY created_at LIMIT 100`,
    [new Date(now.getTime() - 2 * 60_000)]);
  for (const r of rows) await enqueueReportExport(r.id);
  return { requeued: rows.length, failed };
}

/** The finished file as CSV text (stored gzipped), or null when there is none. */
export async function reportRequestFile(networkId: string, id: string): Promise<{ csv: string; filename: string } | null> {
  const { rows } = await query<{ name: string; range_from: string; range_to: string | null; range_label: string; file: Buffer | null }>(
    `SELECT name, range_from, range_to, range_label, file FROM report_requests WHERE network_id = $1 AND id = $2 AND status = 'done'`,
    [networkId, id]);
  const r = rows[0];
  if (!r?.file) return null;
  return {
    csv: gunzipSync(r.file).toString('utf8'),
    filename: reportFileName(r.name, { from: r.range_from, ...(r.range_to ? { to: r.range_to } : {}), label: r.range_label }),
  };
}
