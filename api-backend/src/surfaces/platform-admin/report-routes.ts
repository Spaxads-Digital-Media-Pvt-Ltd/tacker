/**
 * Super Admin › Reports — the platform's own reports, as JSON for the page and as CSV (`?format=csv`, audited).
 *
 * - /reports/networks (networks:read): every network in scope — status, owner, plan and what it pays (its own
 *   price when it has one; billing exempt), MRR, account manager, seller, reseller, health, the last 30 days'
 *   clicks and conversions, created.
 * - /reports/usage?from&to (networks:read): clicks, conversions and events per network over UTC days (≤ 366).
 * - /reports/growth?months (revenue:read): per UTC month — networks created, deleted, live at the month's end,
 *   MRR at the month's end (the last MRR snapshot in it) and what was paid, per currency.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateQuery } from '../../lib/http/validate.js';
import { badRequest } from '../../lib/http/errors.js';
import { query } from '../../lib/db/pool.js';
import { csvCell } from '../../lib/csv.js';
import { writePlatformAudit } from '../../lib/audit.js';
import { NETWORK_MRR_SQL } from '../../lib/billing/revenue.js';
import { requirePerm, networkScope } from './auth.js';

const fmt = z.enum(['json', 'csv']).default('json');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date, like 2026-10-01');

async function respond(req: Request, res: Response, name: string, cols: string[], rows: Record<string, unknown>[], format: 'json' | 'csv', meta: Record<string, unknown> = {}): Promise<void> {
  if (format === 'json') { sendOk(res, { ...meta, columns: cols, rows }); return; }
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`${cols.join(',')}\n${rows.map((r) => cols.map((c) => csvCell(r[c])).join(',')).join('\n')}${rows.length ? '\n' : ''}`);
  await writePlatformAudit(req, null, { action: 'report.export', entityType: 'report', entityId: name, after: { rows: rows.length, ...meta } });
}

export function reportRoutes(): Router {
  const r = Router();

  r.get('/reports/networks', requirePerm('networks', 'read'), validateQuery(z.object({ format: fmt })), asyncHandler(async (req, res) => {
    const { format } = res.locals.query as { format: 'json' | 'csv' };
    const sc = networkScope(req, 'n', 1);
    const { rows } = await query(
      `SELECT n.ref, n.name, n.slug, n.status, to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS created,
              (SELECT u.email FROM users u WHERE u.network_id = n.id AND u.role = 'admin' ORDER BY u.created_at LIMIT 1) AS owner_email,
              p.name AS plan, s.status AS subscription, p.currency, p.billing_interval AS interval,
              (COALESCE(o.price_cents, p.price_cents)::numeric / 100)::numeric(14,2)::text AS price,
              COALESCE(o.billing_exempt, false) AS billing_exempt, (o.price_cents IS NOT NULL) AS custom_price,
              COALESCE(m.mrr, 0)::numeric(14,2)::text AS mrr,
              COALESCE(am.name, am.email) AS account_manager, COALESCE(so.name, so.email) AS seller, rs.name AS reseller,
              na.health_score, na.health_status,
              COALESCE(u.clicks, 0)::bigint AS clicks_30d, COALESCE(u.conversions, 0)::bigint AS conversions_30d
         FROM networks n
         LEFT JOIN subscriptions s ON s.network_id = n.id
         LEFT JOIN subscription_plans p ON p.id = s.plan_id
         LEFT JOIN network_plan_overrides o ON o.network_id = n.id
         LEFT JOIN (${NETWORK_MRR_SQL}) m ON m.network_id = n.id
         LEFT JOIN platform_admins am ON am.id = n.account_manager_id
         LEFT JOIN platform_admins so ON so.id = n.sales_owner_id
         LEFT JOIN platform_resellers rs ON rs.id = n.reseller_id
         LEFT JOIN network_accounts na ON na.network_id = n.id
         LEFT JOIN LATERAL (SELECT SUM(value) FILTER (WHERE metric = 'clicks') AS clicks, SUM(value) FILTER (WHERE metric = 'conversions') AS conversions
                              FROM usage_records ur WHERE ur.network_id = n.id AND ur.period_date >= (now() AT TIME ZONE 'UTC')::date - 30) u ON true
        WHERE ${sc.sql}
        ORDER BY n.created_at DESC LIMIT 10000`, sc.params);
    await respond(req, res, 'networks', ['ref', 'name', 'slug', 'status', 'created', 'owner_email', 'plan', 'subscription', 'currency', 'interval', 'price',
      'custom_price', 'billing_exempt', 'mrr', 'account_manager', 'seller', 'reseller', 'health_score', 'health_status', 'clicks_30d', 'conversions_30d'], rows, format);
  }));

  r.get('/reports/usage', requirePerm('networks', 'read'), validateQuery(z.object({ from: day, to: day, format: fmt })), asyncHandler(async (req, res) => {
    const q = res.locals.query as { from: string; to: string; format: 'json' | 'csv' };
    const span = (Date.parse(q.to) - Date.parse(q.from)) / 864e5;
    if (!(span >= 0)) throw badRequest('“From” must be on or before “to”.');
    if (span > 366) throw badRequest('Choose at most a year.');
    const sc = networkScope(req, 'n', 3);
    const { rows } = await query(
      `SELECT n.ref, n.name, n.slug, n.status, p.name AS plan,
              COALESCE(SUM(ur.value) FILTER (WHERE ur.metric = 'clicks'), 0)::bigint AS clicks,
              COALESCE(SUM(ur.value) FILTER (WHERE ur.metric = 'conversions'), 0)::bigint AS conversions,
              COALESCE(SUM(ur.value) FILTER (WHERE ur.metric = 'events'), 0)::bigint AS events
         FROM networks n
         LEFT JOIN subscriptions s ON s.network_id = n.id LEFT JOIN subscription_plans p ON p.id = s.plan_id
         LEFT JOIN usage_records ur ON ur.network_id = n.id AND ur.period_date BETWEEN $1::date AND $2::date
        WHERE n.status <> 'deleted' AND ${sc.sql}
        GROUP BY n.id, p.name ORDER BY clicks DESC, n.name LIMIT 10000`, [q.from, q.to, ...sc.params]);
    await respond(req, res, 'usage', ['ref', 'name', 'slug', 'status', 'plan', 'clicks', 'conversions', 'events'], rows, q.format, { from: q.from, to: q.to });
  }));

  r.get('/reports/growth', requirePerm('revenue', 'read'), validateQuery(z.object({ months: z.coerce.number().int().min(1).max(36).default(12), format: fmt })), asyncHandler(async (req, res) => {
    const q = res.locals.query as { months: number; format: 'json' | 'csv' };
    const { rows } = await query<{ month: string; created: number; deleted: number; live_at_end: number; mrr: { currency: string; amount: string }[]; paid: { currency: string; amount: string }[] }>(
      `WITH m AS (SELECT gs::date AS start, (gs + interval '1 month')::date AS stop
                    FROM generate_series(date_trunc('month', now() AT TIME ZONE 'UTC') - make_interval(months => $1 - 1), date_trunc('month', now() AT TIME ZONE 'UTC'), interval '1 month') gs)
       SELECT to_char(m.start, 'YYYY-MM') AS month,
              (SELECT COUNT(*) FROM networks n WHERE n.created_at >= m.start::timestamp AT TIME ZONE 'UTC' AND n.created_at < m.stop::timestamp AT TIME ZONE 'UTC')::int AS created,
              (SELECT COUNT(*) FROM networks n WHERE n.deleted_at >= m.start::timestamp AT TIME ZONE 'UTC' AND n.deleted_at < m.stop::timestamp AT TIME ZONE 'UTC')::int AS deleted,
              (SELECT COUNT(*) FROM networks n WHERE n.created_at < m.stop::timestamp AT TIME ZONE 'UTC'
                  AND (n.deleted_at IS NULL OR n.deleted_at >= m.stop::timestamp AT TIME ZONE 'UTC'))::int AS live_at_end,
              COALESCE((SELECT json_agg(json_build_object('currency', x.currency, 'amount', x.amount) ORDER BY x.currency) FROM (
                 SELECT ms.currency, SUM(ms.mrr)::numeric(14,2)::text AS amount FROM platform_mrr_snapshots ms
                  WHERE ms.day = (SELECT max(day) FROM platform_mrr_snapshots WHERE day >= m.start AND day < m.stop) GROUP BY ms.currency) x), '[]'::json) AS mrr,
              COALESCE((SELECT json_agg(json_build_object('currency', y.currency, 'amount', y.amount) ORDER BY y.currency) FROM (
                 SELECT i.currency, SUM(i.paid_amount)::numeric(14,2)::text AS amount FROM platform_invoices i
                  WHERE i.status = 'paid' AND i.paid_at >= m.start::timestamp AT TIME ZONE 'UTC' AND i.paid_at < m.stop::timestamp AT TIME ZONE 'UTC' GROUP BY i.currency) y), '[]'::json) AS paid
         FROM m ORDER BY m.start DESC`, [q.months]);
    // CSV: one money column per currency seen ("mrr_usd", "paid_usd").
    const currencies = [...new Set(rows.flatMap((r) => [...r.mrr, ...r.paid].map((x) => x.currency)))].sort();
    const flat = rows.map((r) => ({
      month: r.month, created: r.created, deleted: r.deleted, live_at_end: r.live_at_end,
      ...Object.fromEntries(currencies.flatMap((c) => [[`mrr_${c.toLowerCase()}`, r.mrr.find((x) => x.currency === c)?.amount ?? '0.00'], [`paid_${c.toLowerCase()}`, r.paid.find((x) => x.currency === c)?.amount ?? '0.00']])),
    }));
    if (q.format === 'json') { sendOk(res, { months: rows }); return; }
    await respond(req, res, 'growth', ['month', 'created', 'deleted', 'live_at_end', ...currencies.flatMap((c) => [`mrr_${c.toLowerCase()}`, `paid_${c.toLowerCase()}`])], flat, 'csv', { months: q.months });
  }));

  return r;
}
