/**
 * Saved reports on the server (audit F-24) — what a report page saved (its filters, sort, …) as a
 * row of saved_reports, owned by the user who saved it; the SPA keeps localStorage only as a cache.
 * A saved report can be scheduled (5-field cron in the network's time zone) and emailed to recipients:
 * the scheduled-reports worker re-runs it for a rolling range (yesterday, last 7 days, …) through the
 * reporting provider and sends a summary + the rows as CSV (lib/email/transactional.ts).
 */
import { pool, query } from '../db/pool.js';
import { getReportingProvider } from './index.js';
import { attachLabels } from './labels.js';
import { isValidTimeZone, isUtcZone, localDate, zonedDayStart, addDays, inclusiveBefore } from './time-zone.js';
import { nextCronTime } from '../scheduling/cron.js';
import { sendTransactionalNow, escapeHtml, networkName, type TransactionalResult } from '../email/transactional.js';
import { logger } from '../logger.js';
import type { Dimension, Metric, ReportFilters, ReportRequest, ReportResult } from './types.js';

/** The report pages that save configurations (the SPA's `tracker.savedReports.<page>` keys). */
export const SAVED_REPORT_PAGES = [
  'offer-report', 'partner-report', 'advertiser-report', 'smartlink-report', 'daily-report', 'hourly-report', 'flex-report', 'nested-report',
] as const;
export type SavedReportPage = (typeof SAVED_REPORT_PAGES)[number];

export const RANGE_PRESETS = ['yesterday', 'last_7_days', 'last_30_days', 'month_to_date', 'last_month'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

const PAGE_GROUP: Record<Exclude<SavedReportPage, 'flex-report' | 'nested-report'>, Dimension[]> = {
  'offer-report': ['offer'], 'partner-report': ['publisher'], 'advertiser-report': ['advertiser'],
  'smartlink-report': ['smartLink'], 'daily-report': ['day'], 'hourly-report': ['hour'],
};
const DIMS = new Set<Dimension>(['offer', 'publisher', 'advertiser', 'smartLink', 'country', 'device', 'city', 'region', 'isp', 'browser', 'os', 'day', 'hour', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5']);
const METRICS: Metric[] = ['clicks', 'unique_clicks', 'conversions', 'cr', 'payout', 'revenue', 'margin', 'epc', 'invalid_clicks', 'total_conversions', 'currencies'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROW_CAP = 1000;

export interface SavedReportRow {
  id: string; network_id: string; owner_user_id: string; page: SavedReportPage; name: string;
  config: Record<string, unknown>; schedule: string | null; range_preset: RangePreset; recipients: string[];
  next_run_at: Date | null; last_run_at: Date | null; last_run_status: string | null; last_run_detail: string | null;
  created_at: Date; updated_at: Date;
}

export const savedReportDto = (r: SavedReportRow) => ({
  id: r.id, page: r.page, name: r.name, config: r.config, ownerUserId: r.owner_user_id,
  schedule: r.schedule, rangePreset: r.range_preset, recipients: r.recipients,
  nextRunAt: r.next_run_at, lastRunAt: r.last_run_at, lastRunStatus: r.last_run_status, lastRunDetail: r.last_run_detail,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

/** The network's report time zone (Settings › General), UTC when unset. */
export async function networkTimeZone(networkId: string): Promise<string> {
  const { rows } = await query<{ tz: string | null }>(`SELECT settings->'general'->>'timezone' AS tz FROM networks WHERE id = $1`, [networkId]);
  const tz = rows[0]?.tz;
  return isValidTimeZone(tz) ? tz : 'UTC';
}

/** The rolling range a scheduled run covers, as of `now` in `tz` (whole local days). */
export function presetRange(preset: RangePreset, now: Date, tz: string): { from: string; to?: string; label: string } {
  const today = localDate(now, tz);
  const start = (d: string) => zonedDayStart(d, tz);
  const monthFirst = `${today.slice(0, 7)}-01`;
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const prevMonthFirst = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
  switch (preset) {
    case 'yesterday': return { from: start(addDays(today, -1)).toISOString(), to: inclusiveBefore(start(today)), label: addDays(today, -1) };
    case 'last_7_days': return { from: start(addDays(today, -7)).toISOString(), to: inclusiveBefore(start(today)), label: `${addDays(today, -7)} – ${addDays(today, -1)}` };
    case 'last_30_days': return { from: start(addDays(today, -30)).toISOString(), to: inclusiveBefore(start(today)), label: `${addDays(today, -30)} – ${addDays(today, -1)}` };
    case 'month_to_date': return { from: start(monthFirst).toISOString(), label: `${monthFirst} – ${today}` };
    case 'last_month': return { from: start(prevMonthFirst).toISOString(), to: inclusiveBefore(start(monthFirst)), label: prevMonthFirst.slice(0, 7) };
  }
}

const list = (v: unknown, ids = false): string[] =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && x !== '' && (!ids || UUID_RE.test(x)));

/** A saved page config → the report request the page itself would make (rolling range, network zone). */
export function savedReportRequest(networkId: string, page: SavedReportPage, config: Record<string, unknown>, preset: RangePreset, now: Date, tz: string): ReportRequest {
  let groupBy: Dimension[];
  if (page === 'flex-report') groupBy = list(config['dims']).filter((d): d is Dimension => DIMS.has(d as Dimension)).slice(0, 4);
  else if (page === 'nested-report') groupBy = [config['parentDim'], config['childDim']].filter((d): d is Dimension => typeof d === 'string' && DIMS.has(d as Dimension));
  else groupBy = PAGE_GROUP[page];
  if (!groupBy.length) groupBy = ['day'];

  const f = (config['filters'] ?? {}) as Record<string, unknown>;
  const x = (config['exclusions'] ?? {}) as Record<string, unknown>;
  const one = (vals: string[]) => (vals.length === 0 ? undefined : vals.length === 1 ? vals[0] : vals);
  const range = presetRange(preset, now, tz);
  const filters: ReportFilters = {
    from: range.from, ...(range.to ? { to: range.to } : {}),
    offerId: one(list(f['offer'], true)), advertiserId: one(list(f['advertiser'], true)), publisherId: one(list(f['partner'], true)),
    smartLinkId: one(list(f['smartLink'], true)), country: one(list(f['country']).map((c) => c.toUpperCase())), device: one(list(f['device'])),
    excludeOfferId: one(list(x['offer'], true)), excludeAdvertiserId: one(list(x['advertiser'], true)), excludePublisherId: one(list(x['partner'], true)),
    excludeSmartLinkId: one(list(x['smartLink'], true)), excludeCountry: one(list(x['country']).map((c) => c.toUpperCase())), excludeDevice: one(list(x['device'])),
    ...(config['ignoreFailTraffic'] === true ? { excludeInvalid: true } : {}),
  };
  for (const k of Object.keys(filters) as (keyof ReportFilters)[]) if (filters[k] === undefined) delete filters[k];
  const orderBy = typeof config['orderBy'] === 'string' && (METRICS as string[]).includes(config['orderBy']) && config['orderBy'] !== 'currencies'
    ? (config['orderBy'] as Metric) : undefined;
  return {
    networkId, groupBy, metrics: METRICS, filters, limit: ROW_CAP, offset: 0,
    ...(orderBy ? { orderBy, orderDir: config['orderDir'] === 'asc' ? 'asc' as const : 'desc' as const } : {}),
    moneyFields: ['payout', 'revenue', 'margin'],
    ...(isUtcZone(tz) ? {} : { timeZone: tz }),
  };
}

/** One CSV cell — as the SPA's export (frontend lib/export.ts): text a spreadsheet would run as a
 *  formula (=, +, -, @, tab or CR first) gets a leading apostrophe, since partner / offer names are
 *  user-controlled; real numbers like "-5.0000" stay numeric. RFC 4180 quoting. */
const csvCell = (v: unknown): string => {
  let s = v == null ? '' : Array.isArray(v) ? v.join('|') : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const DIM_LABEL: Record<string, string> = { publisher: 'partner', smartLink: 'smart_link' };

/** The rows as CSV: each dimension (entity dimensions: name + id), then every metric as returned. */
export function reportCsv(result: ReportResult): string {
  const header: string[] = [];
  for (const d of result.groupBy) {
    const n = DIM_LABEL[d] ?? d;
    if (['offer', 'publisher', 'advertiser', 'smartLink'].includes(d)) header.push(n, `${n}_id`);
    else header.push(n);
  }
  header.push(...result.metrics);
  const lines = [header.join(',')];
  for (const row of result.rows) {
    const cells: unknown[] = [];
    for (const d of result.groupBy) {
      if (['offer', 'publisher', 'advertiser', 'smartLink'].includes(d)) cells.push(row.labels?.[d]?.name ?? '', row.dimensions[d]);
      else cells.push(row.dimensions[d]);
    }
    for (const m of result.metrics) cells.push(row.metrics[m]);
    lines.push(cells.map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Run a saved report now and email it to its recipients. */
export async function sendSavedReport(r: SavedReportRow, now: Date = new Date()): Promise<{ result: TransactionalResult; rows: number }> {
  const tz = await networkTimeZone(r.network_id);
  const req = savedReportRequest(r.network_id, r.page, r.config ?? {}, r.range_preset, now, tz);
  const provider = getReportingProvider();
  const [table, total] = await Promise.all([
    provider.runReport(req).then((res) => attachLabels(r.network_id, res)),
    provider.runReport({ ...req, groupBy: [], limit: 1, metrics: ['clicks', 'conversions', 'payout', 'revenue', 'margin', 'money_by_currency'] }),
  ]);
  const t = total.rows[0]?.metrics ?? {};
  const range = presetRange(r.range_preset, now, tz).label;
  const mbc = (t['money_by_currency'] ?? {}) as Record<string, { payout?: string; revenue?: string; margin?: string }>;
  const money = Object.keys(mbc).length > 1
    ? Object.entries(mbc).map(([cur, v]) => `${escapeHtml(cur)}: payout ${escapeHtml(v.payout ?? '0')}, revenue ${escapeHtml(v.revenue ?? '0')}, margin ${escapeHtml(v.margin ?? '0')}`).join('<br>')
    : `payout ${escapeHtml(String(t['payout'] ?? '0'))}, revenue ${escapeHtml(String(t['revenue'] ?? '0'))}, margin ${escapeHtml(String(t['margin'] ?? '0'))}${Object.keys(mbc)[0] ? ` ${escapeHtml(Object.keys(mbc)[0]!)}` : ''}`;
  const truncated = table.total > table.rows.length;
  const net = await networkName(r.network_id);
  const html = [
    `<p><strong>${escapeHtml(r.name)}</strong> — ${escapeHtml(range)} (${escapeHtml(tz)})</p>`,
    `<p>Clicks ${escapeHtml(String(t['clicks'] ?? 0))} · Conversions ${escapeHtml(String(t['conversions'] ?? 0))}<br>${money}</p>`,
    `<p>${table.rows.length} row${table.rows.length === 1 ? '' : 's'} attached as CSV${truncated ? ` (the first ${table.rows.length} of ${table.total})` : ''}.</p>`,
  ].join('\n');
  const slug = r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report';
  const result = await sendTransactionalNow(r.network_id, 'scheduled_report', r.recipients, {
    subject: `${net}: ${r.name} — ${range}`, html,
    attachments: [{ filename: `${slug}-${range.slice(0, 10)}.csv`, content: reportCsv(table), contentType: 'text/csv' }],
  });
  return { result, rows: table.rows.length };
}

/** Run every scheduled report that is due (the worker calls this every minute). */
export async function runDueSavedReports(now: Date = new Date(), limit = 50): Promise<{ sent: number; skipped: number; failed: number }> {
  // Claim: advance next_run_at in a transaction (SKIP LOCKED — two workers never take the same report;
  // a run that then fails waits for its next slot instead of retrying every minute).
  const client = await pool.connect();
  let due: SavedReportRow[] = [];
  try {
    await client.query('BEGIN');
    // Only active networks: a suspended or deleted one (F-26) emails nothing; its due reports run once
    // it is restored.
    due = (await client.query<SavedReportRow>(
      `SELECT r.* FROM saved_reports r JOIN networks n ON n.id = r.network_id AND n.status = 'active'
        WHERE r.schedule IS NOT NULL AND r.next_run_at <= $1
        ORDER BY r.next_run_at LIMIT ${limit} FOR UPDATE OF r SKIP LOCKED`, [now])).rows;
    for (const r of due) {
      const tz = await networkTimeZone(r.network_id);
      let next: Date | null = null;
      try { next = nextCronTime(r.schedule!, now, tz); } catch { next = null; }
      await client.query('UPDATE saved_reports SET next_run_at = $2 WHERE id = $1 AND network_id = $3', [r.id, next, r.network_id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  const out = { sent: 0, skipped: 0, failed: 0 };
  for (const r of due) {
    let status: 'sent' | 'skipped' | 'failed';
    let detail: string;
    try {
      const { result, rows } = await sendSavedReport(r, now);
      status = result.sent ? 'sent' : 'skipped';
      detail = result.sent ? `${rows} rows to ${result.recipients.length} recipient(s)` : result.reason ?? 'not sent';
    } catch (err) {
      status = 'failed';
      detail = err instanceof Error ? err.message : 'Report failed';
      logger.warn({ err, savedReportId: r.id }, 'scheduled report failed');
    }
    out[status === 'sent' ? 'sent' : status === 'skipped' ? 'skipped' : 'failed']++;
    await query(
      `UPDATE saved_reports SET last_run_at = $2, last_run_status = $3, last_run_detail = $4 WHERE id = $1 AND network_id = $5`,
      [r.id, now, status, detail.slice(0, 500), r.network_id]);
  }
  return out;
}
