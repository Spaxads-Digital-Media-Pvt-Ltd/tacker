/**
 * Manage Reporting Adjustments (Partners › Adjustments) — manual per-day overrides on top of a
 * Partner+Offer's real reported numbers. "Original" values are computed live by aggregating the
 * real clicks/conversions tables (not fabricated) for the adjustment's date range; "Adjusted" is
 * whatever override an admin set for that day, falling back to the original when unset. Gross
 * Sales and Impressions have no real tracked source in this app, so their "original" is always 0
 * — they're adjustment-only metrics, matching how the reference itself has no upstream data for
 * those either outside of what's manually entered. Tenant-scoped by network_id (§3A).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { LIST_CAP, warnIfCapped } from '../../../lib/http/list-cap.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { queryDate } from '../../../lib/http/query-params.js';
import { notFound, badRequest } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';

const TABLE = 'reporting_adjustments';

interface DayOverride {
  date: string; revenue?: number; payout?: number; grossSales?: number;
  totalClicks?: number; uniqueClicks?: number; conversions?: number; impressions?: number; notes?: string;
}
interface Row {
  id: string; publisher_id: string; offer_id: string; date_from: string; date_to: string;
  days: DayOverride[]; last_modified_by: string | null; created_at: string; updated_at: string;
}
interface Metrics { revenue: number; payout: number; grossSales: number; totalClicks: number; uniqueClicks: number; conversions: number; impressions: number }
const zeroMetrics = (): Metrics => ({ revenue: 0, payout: 0, grossSales: 0, totalClicks: 0, uniqueClicks: 0, conversions: 0, impressions: 0 });

/** node-pg parses `date` columns into JS Date objects constructed at LOCAL midnight, not strings
 * — normalize using local getters (never toISOString/UTC, which can shift the day by the server's
 * UTC offset) before doing any string date-math on a DB-read row. */
function toDateStr(v: string | Date): string {
  if (!(v instanceof Date)) return v;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
}
function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) { out.push(dateKey(cur)); cur.setUTCDate(cur.getUTCDate() + 1); }
  return out;
}

/** Real per-day aggregate from clicks + approved conversions — the "original" numbers. */
async function originalByDay(networkId: string, publisherId: string, offerId: string, dateFrom: string, dateTo: string): Promise<Map<string, Metrics>> {
  const map = new Map<string, Metrics>();
  for (const d of eachDate(dateFrom, dateTo)) map.set(d, zeroMetrics());

  // Clicks contribute COUNTS only. clicks.resolved_revenue/payout are the per-conversion rates
  // frozen for later attribution — not money earned — so summing them double-counted revenue/payout.
  const { rows: clickRows } = await query<{ day: string; total_clicks: string; unique_clicks: string }>(
    `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day,
            COUNT(*)::text AS total_clicks,
            COUNT(*) FILTER (WHERE is_unique)::text AS unique_clicks
       FROM clicks
      WHERE network_id = $1 AND publisher_id = $2 AND offer_id = $3
        AND created_at >= $4::date AND created_at < ($5::date + interval '1 day')
      GROUP BY 1`,
    [networkId, publisherId, offerId, dateFrom, dateTo],
  );
  for (const r of clickRows) {
    const m = map.get(r.day) ?? zeroMetrics();
    m.totalClicks += Number(r.total_clicks); m.uniqueClicks += Number(r.unique_clicks);
    map.set(r.day, m);
  }

  const { rows: convRows } = await query<{ day: string; conversions: string; revenue: string; payout: string }>(
    `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day,
            COUNT(*)::text AS conversions,
            COALESCE(SUM(revenue), 0)::text AS revenue,
            COALESCE(SUM(payout), 0)::text AS payout
       FROM conversions
      WHERE network_id = $1 AND publisher_id = $2 AND offer_id = $3 AND status = 'approved'
        AND created_at >= $4::date AND created_at < ($5::date + interval '1 day')
      GROUP BY 1`,
    [networkId, publisherId, offerId, dateFrom, dateTo],
  );
  for (const r of convRows) {
    const m = map.get(r.day) ?? zeroMetrics();
    m.conversions += Number(r.conversions);
    m.revenue += Number(r.revenue); m.payout += Number(r.payout);
    map.set(r.day, m);
  }

  return map;
}

function applyOverride(original: Metrics, override?: DayOverride): Metrics {
  if (!override) return original;
  return {
    revenue: override.revenue ?? original.revenue, payout: override.payout ?? original.payout,
    grossSales: override.grossSales ?? original.grossSales,
    totalClicks: override.totalClicks ?? original.totalClicks, uniqueClicks: override.uniqueClicks ?? original.uniqueClicks,
    conversions: override.conversions ?? original.conversions, impressions: override.impressions ?? original.impressions,
  };
}
const sumMetrics = (a: Metrics, b: Metrics): Metrics => ({
  revenue: a.revenue + b.revenue, payout: a.payout + b.payout, grossSales: a.grossSales + b.grossSales,
  totalClicks: a.totalClicks + b.totalClicks, uniqueClicks: a.uniqueClicks + b.uniqueClicks,
  conversions: a.conversions + b.conversions, impressions: a.impressions + b.impressions,
});
const derived = (m: Metrics) => ({
  margin: m.revenue > 0 ? (m.revenue - m.payout) / m.revenue : 0,
  cvr: m.totalClicks > 0 ? m.conversions / m.totalClicks : 0,
  profit: m.revenue - m.payout,
});

interface JoinFields { publisher_ref: number; publisher_name: string; offer_ref: number; offer_name: string; advertiser_name: string; last_modified_by_name: string | null }
const SELECT = `
  SELECT a.*, p.ref AS publisher_ref, p.name AS publisher_name, o.ref AS offer_ref, o.name AS offer_name,
         adv.name AS advertiser_name, u.name AS last_modified_by_name
    FROM reporting_adjustments a
    JOIN publishers p ON p.id = a.publisher_id AND p.network_id = a.network_id
    JOIN offers o ON o.id = a.offer_id AND o.network_id = a.network_id
    LEFT JOIN advertisers adv ON adv.id = o.advertiser_id AND adv.network_id = a.network_id
    LEFT JOIN users u ON u.id = a.last_modified_by AND u.network_id = a.network_id
`;

async function listDTO(networkId: string, row: Row & JoinFields) {
  const originals = await originalByDay(networkId, row.publisher_id, row.offer_id, toDateStr(row.date_from), toDateStr(row.date_to));
  let original = zeroMetrics(); let adjusted = zeroMetrics();
  for (const [day, orig] of originals) {
    original = sumMetrics(original, orig);
    const override = row.days.find((d) => d.date === day);
    adjusted = sumMetrics(adjusted, applyOverride(orig, override));
  }
  return {
    id: row.id, publisherId: row.publisher_id, publisherRef: row.publisher_ref, publisherName: row.publisher_name,
    offerId: row.offer_id, offerRef: row.offer_ref, offerName: row.offer_name, advertiserName: row.advertiser_name,
    dateFrom: toDateStr(row.date_from), dateTo: toDateStr(row.date_to),
    original, adjusted,
    lastModifiedByName: row.last_modified_by_name,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** Longest span one adjustment / preview may cover — eachDate() materialises one entry per day. */
const MAX_RANGE_DAYS = 366;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// Round-trip check: Date.parse accepts impossible days like 2024-02-30 (rolls over), Postgres doesn't.
const dayParam = queryDate.refine(
  (s) => {
    if (!DAY_RE.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  },
  { message: 'must be a date (YYYY-MM-DD)' },
);

function rangeDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}
/** Throws 400 unless from <= to and the inclusive span is at most MAX_RANGE_DAYS. */
function assertRange(from: string, to: string): void {
  if (from > to) throw badRequest('dateFrom must be on or before dateTo');
  if (rangeDays(from, to) > MAX_RANGE_DAYS) throw badRequest(`date range cannot exceed ${MAX_RANGE_DAYS} days`);
}
const orderedRange = (q: { dateFrom?: string; dateTo?: string }) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo;
const listQuery = z.object({ dateFrom: dayParam.optional(), dateTo: dayParam.optional() })
  .refine(orderedRange, { message: 'dateFrom must be on or before dateTo', path: ['dateFrom'] });
const previewQuery = z.object({
  publisherId: z.string().uuid(), offerId: z.string().uuid(), dateFrom: dayParam, dateTo: dayParam,
})
  .refine(orderedRange, { message: 'dateFrom must be on or before dateTo', path: ['dateFrom'] })
  .refine((q) => rangeDays(q.dateFrom, q.dateTo) <= MAX_RANGE_DAYS, { message: `date range cannot exceed ${MAX_RANGE_DAYS} days`, path: ['dateTo'] });

export function reportingAdjustmentsRoutes(): Router {
  const r = Router();

  r.get('/', validateQuery(listQuery), asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const { dateFrom, dateTo } = res.locals.query as z.infer<typeof listQuery>;
    const params: unknown[] = [networkId];
    let where = 'a.network_id = $1';
    if (dateFrom && dateTo) { where += ` AND a.date_to >= $2::date AND a.date_from <= $3::date`; params.push(dateFrom, dateTo); }
    const { rows } = await query<Row & JoinFields>(`${SELECT} WHERE ${where} ORDER BY a.created_at DESC LIMIT ${LIST_CAP}`, params);
    warnIfCapped(rows, LIST_CAP, 'reporting-adjustments.list');
    const dtos = await Promise.all(rows.map((row) => listDTO(networkId, row)));
    sendOk(res, dtos);
  }));

  /** Real per-day originals for a not-yet-created adjustment — powers the Add form's table. */
  r.get('/preview', validateQuery(previewQuery), asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const { publisherId, offerId, dateFrom, dateTo } = res.locals.query as z.infer<typeof previewQuery>;
    const db = dbForRequest(req);
    const pub = await db.selectOne<{ id: string; name: string }>('publishers', { id: publisherId });
    if (!pub) throw badRequest('publisherId does not belong to this network');
    const offer = await db.selectOne<{ id: string; name: string; default_revenue: string; default_payout: string }>('offers', { id: offerId });
    if (!offer) throw badRequest('offerId does not belong to this network');
    const originals = await originalByDay(networkId, publisherId, offerId, dateFrom, dateTo);
    const days = Array.from(originals.entries()).map(([date, original]) => ({
      date, original, adjusted: { ...original, ...derived(original) }, override: null, notes: null,
    }));
    sendOk(res, {
      publisherName: pub.name, offerName: offer.name,
      offerDefaultRevenue: Number(offer.default_revenue ?? 0), offerDefaultPayout: Number(offer.default_payout ?? 0),
      days,
    });
  }));

  const daySchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    revenue: z.number().nullable().optional(), payout: z.number().nullable().optional(), grossSales: z.number().nullable().optional(),
    totalClicks: z.number().int().nullable().optional(), uniqueClicks: z.number().int().nullable().optional(),
    conversions: z.number().int().nullable().optional(), impressions: z.number().int().nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  });
  const createSchema = z.object({
    publisherId: z.string().uuid(), offerId: z.string().uuid(),
    dateFrom: dayParam, dateTo: dayParam,
    days: z.array(daySchema).default([]),
  });
  const updateSchema = createSchema.partial();

  const cleanDay = (d: z.infer<typeof daySchema>) => ({
    date: d.date,
    ...(d.revenue != null ? { revenue: d.revenue } : {}), ...(d.payout != null ? { payout: d.payout } : {}),
    ...(d.grossSales != null ? { grossSales: d.grossSales } : {}), ...(d.totalClicks != null ? { totalClicks: d.totalClicks } : {}),
    ...(d.uniqueClicks != null ? { uniqueClicks: d.uniqueClicks } : {}), ...(d.conversions != null ? { conversions: d.conversions } : {}),
    ...(d.impressions != null ? { impressions: d.impressions } : {}), ...(d.notes ? { notes: d.notes } : {}),
  });

  /** req.identity.userId is the Supabase auth_user_id, not users.id — resolve the FK target. */
  async function currentUserId(req: Parameters<typeof dbForRequest>[0]): Promise<string | null> {
    const authUserId = (req.identity as { userId?: string }).userId;
    if (!authUserId) return null;
    const { rows } = await query<{ id: string }>(
      `SELECT id FROM users WHERE auth_user_id = $1 AND network_id = $2`,
      [authUserId, req.scope!.networkId],
    );
    return rows[0]?.id ?? null;
  }

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof createSchema>;
    assertRange(b.dateFrom, b.dateTo);
    const pub = await db.selectOne('publishers', { id: b.publisherId });
    if (!pub) throw badRequest('publisherId does not belong to this network');
    const offer = await db.selectOne('offers', { id: b.offerId });
    if (!offer) throw badRequest('offerId does not belong to this network');
    const actorId = await currentUserId(req);
    const row = await db.insert<Row>(TABLE, {
      publisher_id: b.publisherId, offer_id: b.offerId, date_from: b.dateFrom, date_to: b.dateTo,
      days: JSON.stringify(b.days.map(cleanDay)), last_modified_by: actorId,
    });
    await writeAudit(req, { action: 'reporting_adjustment.create', entityType: 'reporting_adjustment', entityId: row.id, after: row });
    const { rows } = await query<Row & JoinFields>(`${SELECT} WHERE a.id = $1 AND a.network_id = $2`, [row.id, req.scope!.networkId]);
    sendOk(res, await listDTO(req.scope!.networkId, rows[0]!), undefined, 201);
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const { rows } = await query<Row & JoinFields>(`${SELECT} WHERE a.id = $1 AND a.network_id = $2`, [req.params.id, networkId]);
    if (!rows[0]) throw notFound('Adjustment not found');
    const row = rows[0];
    const originals = await originalByDay(networkId, row.publisher_id, row.offer_id, toDateStr(row.date_from), toDateStr(row.date_to));
    const days = Array.from(originals.entries()).map(([date, original]) => {
      const override = row.days.find((d) => d.date === date);
      const adjusted = applyOverride(original, override);
      return { date, original, adjusted: { ...adjusted, ...derived(adjusted) }, override: override ?? null, notes: override?.notes ?? null };
    });
    sendOk(res, {
      id: row.id, publisherId: row.publisher_id, publisherName: row.publisher_name,
      offerId: row.offer_id, offerName: row.offer_name, advertiserName: row.advertiser_name,
      dateFrom: toDateStr(row.date_from), dateTo: toDateStr(row.date_to), days,
      createdAt: row.created_at, updatedAt: row.updated_at,
    });
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Adjustment not found');
    const b = req.body as z.infer<typeof updateSchema>;
    if (b.dateFrom !== undefined || b.dateTo !== undefined) {
      assertRange(b.dateFrom ?? toDateStr(before.date_from), b.dateTo ?? toDateStr(before.date_to));
    }
    if (b.publisherId) { const pub = await db.selectOne('publishers', { id: b.publisherId }); if (!pub) throw badRequest('publisherId does not belong to this network'); }
    if (b.offerId) { const offer = await db.selectOne('offers', { id: b.offerId }); if (!offer) throw badRequest('offerId does not belong to this network'); }
    const patch: Record<string, unknown> = {};
    if (b.publisherId !== undefined) patch['publisher_id'] = b.publisherId;
    if (b.offerId !== undefined) patch['offer_id'] = b.offerId;
    if (b.dateFrom !== undefined) patch['date_from'] = b.dateFrom;
    if (b.dateTo !== undefined) patch['date_to'] = b.dateTo;
    if (b.days !== undefined) patch['days'] = JSON.stringify(b.days.map(cleanDay));
    patch['last_modified_by'] = await currentUserId(req);
    const [row] = await db.update<Row>(TABLE, patch, { id: req.params.id });
    if (!row) throw notFound('Adjustment not found');
    await writeAudit(req, { action: 'reporting_adjustment.update', entityType: 'reporting_adjustment', entityId: req.params.id, before, after: row });
    const { rows } = await query<Row & JoinFields>(`${SELECT} WHERE a.id = $1 AND a.network_id = $2`, [req.params.id, req.scope!.networkId]);
    sendOk(res, await listDTO(req.scope!.networkId, rows[0]!));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Adjustment not found');
    await db.delete(TABLE, { id: req.params.id });
    await writeAudit(req, { action: 'reporting_adjustment.delete', entityType: 'reporting_adjustment', entityId: req.params.id, before });
    sendOk(res, { deleted: true });
  }));

  return r;
}
