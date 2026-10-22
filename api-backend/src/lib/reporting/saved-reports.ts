/**
 * Saved reports on the server (audit F-24) — what a report page saved (its filters, sort, …) as a
 * row of saved_reports, owned by the user who saved it; the SPA keeps localStorage only as a cache.
 * A saved report can be scheduled (5-field cron in the network's time zone) and emailed to recipients:
 * the scheduled-reports worker re-runs it for a rolling range (yesterday, last 7 days, …) through the
 * reporting provider and sends a summary + the rows as CSV (lib/email/transactional.ts).
 *
 * Who it may go to (D4): every role can schedule its own reports, and a report is always sent with
 * its OWNER's permissions — an admin's or manager's to any address; a Finance or Read-only member's
 * only to that member's own email; a disabled member's to nobody. It is checked when the schedule is
 * saved and again at every run, so a later role change or a disabled account applies at once.
 */
import { pool, query } from '../db/pool.js';
import { getReportingProvider } from './index.js';
import { attachLabels } from './labels.js';
import { isUtcZone, localDate, zonedDayStart, addDays, inclusiveBefore } from './time-zone.js';
import { nextCronTime } from '../scheduling/cron.js';
import { sendTransactionalNow, escapeHtml, networkName, type TransactionalResult } from '../email/transactional.js';
import { logger } from '../logger.js';
import { networkTimeZone } from './network-zone.js';
import { teamMembersByLogin, type TeamMember } from '../auth/team-members.js';
import type { Dimension, Metric, ReportFilters, ReportRequest, ReportResult, ReportRow } from './types.js';
import { csvCell } from '../csv.js';

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
/** Rows per reporting call while a file is built. */
export const EXPORT_PAGE = 5000;
/** The most rows a report file holds (an email or a requested export). */
export const EXPORT_MAX_ROWS = 100_000;
/** The most rows attached to an email — the whole file waits in Requested Reports. */
export const EMAIL_ATTACH_ROWS = 5000;

export interface SavedReportRow {
  id: string; network_id: string; owner_user_id: string; page: SavedReportPage; name: string;
  config: Record<string, unknown>; schedule: string | null; range_preset: RangePreset; recipients: string[];
  next_run_at: Date | null; last_run_at: Date | null; last_run_status: string | null; last_run_detail: string | null;
  created_at: Date; updated_at: Date;
}

/** Roles whose reports may be emailed to any address; every other role only to its own email (D4). */
export const SCHEDULE_ANYONE_ROLES: readonly string[] = ['admin', 'manager'];

/** The team member behind a saved report (saved_reports.owner_user_id is their login's id). */
export type ReportOwner = TeamMember;

/** Where a report may be emailed: anywhere, or only to its owner's own address. */
export type ScheduleTo = 'anyone' | 'self';
export const scheduleToFor = (role: string): ScheduleTo => (SCHEDULE_ANYONE_ROLES.includes(role) ? 'anyone' : 'self');

/**
 * Who a run of this report emails — with its owner's permissions, as they are NOW:
 * disabled → nobody; Finance / Read-only → their own current email only, whatever is saved;
 * admin / manager → the saved recipients. A login with no team-member row (token claims only) keeps
 * the saved recipients, as before. `ownerOnly`: saved recipients were narrowed to the owner.
 */
export function deliveryFor(owner: ReportOwner | null | undefined, recipients: string[]):
  { recipients: string[]; ownerOnly: boolean } | { refused: string } {
  if (!owner) return { recipients, ownerOnly: false };
  if (owner.status === 'disabled') return { refused: "Not sent: its owner's account is disabled." };
  if (scheduleToFor(owner.role) === 'anyone') return { recipients, ownerOnly: false };
  const own = owner.email.trim().toLowerCase();
  return { recipients: [own], ownerOnly: recipients.some((x) => x !== own) };
}

export async function savedReportDelivery(r: SavedReportRow): Promise<ReturnType<typeof deliveryFor>> {
  return deliveryFor((await teamMembersByLogin(r.network_id, [r.owner_user_id])).get(r.owner_user_id), r.recipients);
}

/** The owner as the SPA shows it: name / email, whether it can go to anyone, and a disabled account. */
export interface SavedReportOwnerView { name: string | null; email: string | null; scheduleTo: ScheduleTo; disabled: boolean }
export const ownerView = (owner: ReportOwner): SavedReportOwnerView =>
  ({ name: owner.name, email: owner.email, scheduleTo: scheduleToFor(owner.role), disabled: owner.status === 'disabled' });

export const savedReportDto = (r: SavedReportRow, owner?: SavedReportOwnerView | null) => ({
  id: r.id, page: r.page, name: r.name, config: r.config, ownerUserId: r.owner_user_id,
  owner: owner ? { name: owner.name, email: owner.email, disabled: owner.disabled } : null,
  scheduleTo: owner?.scheduleTo ?? 'anyone',
  schedule: r.schedule, rangePreset: r.range_preset, recipients: r.recipients,
  nextRunAt: r.next_run_at, lastRunAt: r.last_run_at, lastRunStatus: r.last_run_status, lastRunDetail: r.last_run_detail,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export { networkTimeZone } from './network-zone.js';

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

/** The span a report covers: ISO instants (to inclusive, absent = now) + a label for people. */
export interface ReportRange { from: string; to?: string; label: string }

/** Whole local days `from`..`to` (YYYY-MM-DD, inclusive) of the network's zone. */
export function datesRange(from: string, to: string, tz: string): ReportRange {
  return {
    from: zonedDayStart(from, tz).toISOString(), to: inclusiveBefore(zonedDayStart(addDays(to, 1), tz)),
    label: from === to ? from : `${from} – ${to}`,
  };
}

/** A saved page config → the report request the page itself would make (rolling or given range, network zone). */
export function savedReportRequest(networkId: string, page: SavedReportPage, config: Record<string, unknown>, preset: RangePreset | ReportRange, now: Date, tz: string): ReportRequest {
  let groupBy: Dimension[];
  if (page === 'flex-report') groupBy = list(config['dims']).filter((d): d is Dimension => DIMS.has(d as Dimension)).slice(0, 4);
  else if (page === 'nested-report') groupBy = [config['parentDim'], config['childDim']].filter((d): d is Dimension => typeof d === 'string' && DIMS.has(d as Dimension));
  else groupBy = PAGE_GROUP[page];
  if (!groupBy.length) groupBy = ['day'];

  const f = (config['filters'] ?? {}) as Record<string, unknown>;
  const x = (config['exclusions'] ?? {}) as Record<string, unknown>;
  const one = (vals: string[]) => (vals.length === 0 ? undefined : vals.length === 1 ? vals[0] : vals);
  const range = typeof preset === 'string' ? presetRange(preset, now, tz) : preset;
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
  // The Fraud metric filter needs the groups' average fraud score.
  const metrics: Metric[] = metricFiltersOf(config).some((m) => m.key === 'fraudScore') ? [...METRICS, 'avg_fraud_score'] : METRICS;
  return {
    networkId, groupBy, metrics, filters, limit: EXPORT_PAGE, offset: 0,
    ...(orderBy ? { orderBy, orderDir: config['orderDir'] === 'asc' ? 'asc' as const : 'desc' as const } : {}),
    moneyFields: ['payout', 'revenue', 'margin'],
    ...(isUtcZone(tz) ? {} : { timeZone: tz }),
  };
}

const DIM_LABEL: Record<string, string> = { publisher: 'partner', smartLink: 'smart_link' };

// ── The page's metric filters and hidden columns ─────────────────────────────────────────────────

/** The report pages' metric filters (Reporting Filters › Metric) — the keys and ops the SPA saves. */
export const METRIC_FILTER_KEYS = ['clicks', 'uniqueClicks', 'dupClicks', 'invalidClicks', 'totalCv', 'cv', 'payout', 'revenue', 'fraudScore'] as const;
export type MetricFilterKey = (typeof METRIC_FILTER_KEYS)[number];
type MetricOp = '>' | '>=' | '<' | '<=';
const OPS: Record<string, MetricOp> = { '>': '>', gt: '>', '>=': '>=', gte: '>=', '<': '<', lt: '<', '<=': '<=', lte: '<=' };
const OP_TEST: Record<MetricOp, (a: number, b: number) => boolean> = {
  '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b,
};
const MONEY_FILTERS: readonly MetricFilterKey[] = ['payout', 'revenue'];
export interface MetricFilter { key: MetricFilterKey; op: MetricOp; value: number }

/** The usable metric filters in a saved config (unknown keys / ops and blank or non-numeric values dropped). */
export function metricFiltersOf(config: Record<string, unknown>): MetricFilter[] {
  const raw = config['metricFilters'];
  if (!raw || typeof raw !== 'object') return [];
  const out: MetricFilter[] = [];
  for (const key of METRIC_FILTER_KEYS) {
    const e = (raw as Record<string, unknown>)[key] as { op?: unknown; value?: unknown } | undefined;
    if (!e || typeof e !== 'object') continue;
    const op = OPS[String(e.op)];
    const value = typeof e.value === 'number' ? e.value : typeof e.value === 'string' && e.value.trim() !== '' ? Number(e.value) : NaN;
    if (op && Number.isFinite(value)) out.push({ key, op, value });
  }
  return out;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) || 0 : 0);
/** A row's value for a metric filter — the same derivation as the page (SPA lib/reportMath deriveRow). */
function filterValue(m: Record<string, unknown>, key: MetricFilterKey): number {
  const gross = num(m['clicks']);
  switch (key) {
    case 'clicks': return Math.max(0, gross - num(m['invalid_clicks'])); // net of invalid, as the Clicks column
    case 'uniqueClicks': return num(m['unique_clicks']);
    case 'dupClicks': return Math.max(0, gross - num(m['unique_clicks']));
    case 'invalidClicks': return num(m['invalid_clicks']);
    case 'totalCv': return num(m['total_conversions']);
    case 'cv': return num(m['conversions']);
    case 'payout': return num(m['payout']);
    case 'revenue': return num(m['revenue']);
    case 'fraudScore': return num(m['avg_fraud_score']);
  }
}

/**
 * The rows the page would show under its metric filters. A payout / revenue threshold has no currency,
 * so when the rows span more than one currency it isn't applied (like the page) — `moneySkipped` says so.
 */
export function applyMetricFilters(rows: ReportRow[], filters: MetricFilter[]): { rows: ReportRow[]; moneySkipped: boolean } {
  if (!filters.length) return { rows, moneySkipped: false };
  const currencies = new Set(rows.flatMap((r) => (Array.isArray(r.metrics['currencies']) ? r.metrics['currencies'] as string[] : [])));
  const moneySkipped = currencies.size > 1 && filters.some((f) => MONEY_FILTERS.includes(f.key));
  const active = moneySkipped ? filters.filter((f) => !MONEY_FILTERS.includes(f.key)) : filters;
  return { rows: rows.filter((r) => active.every((f) => OP_TEST[f.op](filterValue(r.metrics, f.key), f.value))), moneySkipped };
}

/** The page columns (as the SPA names them) each CSV metric belongs to — a metric goes when all of its are hidden. */
const METRIC_COLUMNS: Partial<Record<Metric, string[]>> = {
  clicks: ['Clicks', 'Gross Clicks'], unique_clicks: ['Uniq. Clicks'], conversions: ['CV'], cr: ['CVR'], payout: ['Payout'],
  revenue: ['Revenue'], margin: ['Profit'], epc: ['EPC'], invalid_clicks: ['Invalid Clicks'], total_conversions: ['Total CV'],
  avg_fraud_score: ['Fraud'],
};

/** The CSV's metrics: the report's, minus the page's hidden columns; `currencies` stays while any money column does. */
export function exportMetrics(metrics: Metric[], hiddenColumns: unknown): Metric[] {
  const hidden = new Set(Array.isArray(hiddenColumns) ? hiddenColumns.filter((c): c is string => typeof c === 'string') : []);
  const kept = metrics.filter((m) => {
    const cols = METRIC_COLUMNS[m];
    return !cols || !cols.every((c) => hidden.has(c));
  });
  return kept.some((m) => m === 'payout' || m === 'revenue' || m === 'margin') ? kept : kept.filter((m) => m !== 'currencies');
}

/** The rows as CSV: each dimension (entity dimensions: name + id), then each metric (all, or `metrics`). */
export function reportCsv(result: ReportResult, metrics: Metric[] = result.metrics): string {
  const header: string[] = [];
  for (const d of result.groupBy) {
    const n = DIM_LABEL[d] ?? d;
    if (['offer', 'publisher', 'advertiser', 'smartLink'].includes(d)) header.push(n, `${n}_id`);
    else header.push(n);
  }
  header.push(...metrics);
  const lines = [header.join(',')];
  for (const row of result.rows) {
    const cells: unknown[] = [];
    for (const d of result.groupBy) {
      if (['offer', 'publisher', 'advertiser', 'smartLink'].includes(d)) cells.push(row.labels?.[d]?.name ?? '', row.dimensions[d]);
      else cells.push(row.dimensions[d]);
    }
    for (const m of metrics) cells.push(row.metrics[m]);
    lines.push(cells.map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** A saved report run as a file: what the page would show (filters, metric filters, sort) and its CSV. */
export interface ReportFile {
  result: ReportResult;
  /** The CSV's metrics (hidden columns left out). */
  metrics: Metric[];
  /** Groups the report has before metric filters (the reporting total). */
  groups: number;
  /** More groups than EXPORT_MAX_ROWS — the file holds the first ones. */
  truncated: boolean;
  /** Metric filters were applied; a money one was skipped because the rows span several currencies. */
  metricFiltered: boolean;
  moneyFilterSkipped: boolean;
  range: ReportRange;
  tz: string;
}

/** Run a saved report, every page of it (up to `maxRows`), with its metric filters and hidden columns. */
export async function buildReportFile(
  networkId: string, page: SavedReportPage, config: Record<string, unknown>, range: RangePreset | ReportRange,
  now: Date = new Date(), maxRows = EXPORT_MAX_ROWS,
): Promise<ReportFile> {
  const tz = await networkTimeZone(networkId);
  const resolved = typeof range === 'string' ? presetRange(range, now, tz) : range;
  const req = savedReportRequest(networkId, page, config, resolved, now, tz);
  const provider = getReportingProvider();
  const rows: ReportRow[] = [];
  let groups = 0;
  for (let offset = 0; offset < maxRows; offset += EXPORT_PAGE) {
    const res = await attachLabels(networkId, await provider.runReport({ ...req, limit: Math.min(EXPORT_PAGE, maxRows - offset), offset }));
    if (offset === 0) groups = res.total;
    rows.push(...res.rows);
    if (res.rows.length < EXPORT_PAGE || rows.length >= groups) break;
  }
  const filters = metricFiltersOf(config);
  const filtered = applyMetricFilters(rows, filters);
  return {
    result: { groupBy: req.groupBy, metrics: req.metrics, rows: filtered.rows, total: groups },
    metrics: exportMetrics(req.metrics, config['hiddenColumns']),
    groups, truncated: groups > rows.length, metricFiltered: filters.length > 0, moneyFilterSkipped: filtered.moneySkipped,
    range: resolved, tz,
  };
}

/** A file name for the report: its name, slugged, and the range. */
export function reportFileName(name: string, range: ReportRange): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report';
  return `${slug}-${range.label.slice(0, 10)}.csv`;
}

/** Run a saved report now and email it to its recipients. */
export async function sendSavedReport(r: SavedReportRow, now: Date = new Date(), opts: { attachRows?: number } = {}): Promise<{ result: TransactionalResult; rows: number }> {
  const attachRows = opts.attachRows ?? EMAIL_ATTACH_ROWS;
  const file = await buildReportFile(r.network_id, r.page, r.config ?? {}, r.range_preset, now);
  const { tz } = file;
  const req = savedReportRequest(r.network_id, r.page, r.config ?? {}, file.range, now, tz);
  const total = await getReportingProvider().runReport({ ...req, groupBy: [], limit: 1, metrics: ['clicks', 'conversions', 'payout', 'revenue', 'margin', 'money_by_currency'] });
  const t = total.rows[0]?.metrics ?? {};
  const range = file.range.label;
  const mbc = (t['money_by_currency'] ?? {}) as Record<string, { payout?: string; revenue?: string; margin?: string }>;
  const money = Object.keys(mbc).length > 1
    ? Object.entries(mbc).map(([cur, v]) => `${escapeHtml(cur)}: payout ${escapeHtml(v.payout ?? '0')}, revenue ${escapeHtml(v.revenue ?? '0')}, margin ${escapeHtml(v.margin ?? '0')}`).join('<br>')
    : `payout ${escapeHtml(String(t['payout'] ?? '0'))}, revenue ${escapeHtml(String(t['revenue'] ?? '0'))}, margin ${escapeHtml(String(t['margin'] ?? '0'))}${Object.keys(mbc)[0] ? ` ${escapeHtml(Object.keys(mbc)[0]!)}` : ''}`;
  const rowCount = file.result.rows.length;
  const attached = Math.min(rowCount, attachRows);
  // Too big for an email: the whole file waits in Requested Reports, the email carries the first rows.
  let fullFile: string | null = null;
  if (rowCount > attachRows) {
    const { storeFinishedReport } = await import('./report-requests.js');
    fullFile = await storeFinishedReport(r.network_id, {
      requestedBy: r.owner_user_id, savedReportId: r.id, name: r.name, page: r.page, config: r.config ?? {}, file, source: 'scheduled',
    });
  }
  const net = await networkName(r.network_id);
  const notes = [
    file.metricFiltered ? `Metric filters applied: ${rowCount} of ${file.groups} row${file.groups === 1 ? '' : 's'} match.` : '',
    file.moneyFilterSkipped ? 'A payout / revenue filter was not applied — the rows are in more than one currency.' : '',
    file.truncated ? `The report has ${file.groups} rows; files hold the first ${EXPORT_MAX_ROWS}.` : '',
  ].filter(Boolean);
  const html = [
    `<p><strong>${escapeHtml(r.name)}</strong> — ${escapeHtml(range)} (${escapeHtml(tz)})</p>`,
    `<p>Clicks ${escapeHtml(String(t['clicks'] ?? 0))} · Conversions ${escapeHtml(String(t['conversions'] ?? 0))}<br>${money}</p>`,
    `<p>${attached} row${attached === 1 ? '' : 's'} attached as CSV${fullFile ? ` (the first ${attached} of ${rowCount} — the whole file is in Reporting › Saved &amp; Scheduled › Requested Reports, #${escapeHtml(fullFile)})` : ''}.</p>`,
    ...notes.map((n) => `<p>${escapeHtml(n)}</p>`),
  ].join('\n');
  const csv = reportCsv({ ...file.result, rows: file.result.rows.slice(0, attachRows) }, file.metrics);
  const result = await sendTransactionalNow(r.network_id, 'scheduled_report', r.recipients, {
    subject: `${net}: ${r.name} — ${range}`, html,
    attachments: [{ filename: reportFileName(r.name, file.range), content: csv, contentType: 'text/csv' }],
  });
  return { result, rows: rowCount };
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
      const to = await savedReportDelivery(r);
      if ('refused' in to) {
        status = 'skipped';
        detail = to.refused;
      } else {
        const { result, rows } = await sendSavedReport({ ...r, recipients: to.recipients }, now);
        status = result.sent ? 'sent' : 'skipped';
        detail = result.sent
          ? `${rows} rows to ${result.recipients.length} recipient(s)${to.ownerOnly ? " — its owner's own email only (Finance / Read-only)" : ''}`
          : result.reason ?? 'not sent';
      }
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
