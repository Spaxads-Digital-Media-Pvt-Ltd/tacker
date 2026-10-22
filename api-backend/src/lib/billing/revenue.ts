/**
 * Platform revenue (Super Admin › Revenue): what each network pays per month and how that moves.
 *
 * - NETWORK_MRR_SQL — each paying network's MRR now (active / past due, a price above 0; a yearly price as a
 *   twelfth), net of a recurring discount (a 'once' coupon isn't recurring revenue). The one definition used
 *   by the Overview and the Revenue page.
 * - snapshotMrr — run with the billing worker (every 15 min): today's MRR per paying network
 *   (platform_mrr_snapshots), and its movement against the previous day the snapshot ran
 *   (platform_mrr_days): new · expansion · contraction · churn · reactivation (platform_mrr_movements).
 *   The very first day only records the baseline (no history to move from). Re-running the same day
 *   recomputes that day.
 */
import { query, withTransaction } from '../db/pool.js';

export const NETWORK_MRR_SQL = `
  SELECT s.network_id, p.currency, p.id AS plan_id, p.name AS plan_name, s.status,
         GREATEST(0, round(base.m - COALESCE(disc.off, 0), 2)) AS mrr
    FROM subscriptions s
    JOIN subscription_plans p ON p.id = s.plan_id
    JOIN networks nn ON nn.id = s.network_id AND nn.status <> 'deleted'
    CROSS JOIN LATERAL (SELECT (CASE WHEN p.billing_interval = 'year' THEN p.price_cents::numeric / 12 ELSE p.price_cents::numeric END) / 100 AS m) base
    LEFT JOIN LATERAL (
      SELECT CASE WHEN c.kind = 'percent' THEN base.m * c.percent_off / 100
                  WHEN c.kind = 'amount' AND upper(c.currency) = upper(p.currency)
                    THEN LEAST(base.m, c.amount_off / CASE WHEN p.billing_interval = 'year' THEN 12 ELSE 1 END) END AS off
        FROM subscription_discounts d JOIN platform_coupons c ON c.id = d.coupon_id
       WHERE d.network_id = s.network_id AND d.ended_at IS NULL AND c.duration <> 'once') disc ON true
   WHERE s.status IN ('active', 'past_due') AND p.price_cents > 0`;

export type MovementKind = 'new' | 'expansion' | 'contraction' | 'churn' | 'reactivation';

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

export async function snapshotMrr(now: Date = new Date()): Promise<{ paying: number; movements: number; baseline: boolean }> {
  const day = utcDay(now);
  return withTransaction(async (c) => {
    // One run at a time per day (the billing worker is concurrency 1, but a manual run could overlap).
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('platform_mrr_snapshot'))`);
    const prevDay = (await c.query<{ day: string | null }>(`SELECT max(day)::text AS day FROM platform_mrr_days WHERE day < $1::date`, [day])).rows[0]?.day ?? null;
    await c.query('DELETE FROM platform_mrr_snapshots WHERE day = $1::date', [day]);
    const paying = (await c.query(
      `INSERT INTO platform_mrr_snapshots (day, network_id, currency, mrr, status, plan_id)
       SELECT $1::date, m.network_id, m.currency, m.mrr, m.status, m.plan_id FROM (${NETWORK_MRR_SQL}) m WHERE m.mrr > 0`, [day])).rowCount ?? 0;
    await c.query(`INSERT INTO platform_mrr_days (day, computed_at) VALUES ($1::date, now()) ON CONFLICT (day) DO UPDATE SET computed_at = now()`, [day]);
    await c.query('DELETE FROM platform_mrr_movements WHERE day = $1::date', [day]);
    if (!prevDay) return { paying, movements: 0, baseline: true };

    // Today against the previous run day, per network (either side may be absent = 0).
    const { rowCount } = await c.query(
      `WITH cur AS (SELECT network_id, currency, mrr FROM platform_mrr_snapshots WHERE day = $1::date),
            prev AS (SELECT network_id, currency, mrr FROM platform_mrr_snapshots WHERE day = $2::date),
            pairs AS (
              SELECT COALESCE(cur.network_id, prev.network_id) AS network_id, prev.currency AS prev_currency, COALESCE(prev.mrr, 0) AS prev_mrr,
                     cur.currency AS cur_currency, COALESCE(cur.mrr, 0) AS cur_mrr,
                     EXISTS (SELECT 1 FROM platform_mrr_snapshots h WHERE h.network_id = COALESCE(cur.network_id, prev.network_id) AND h.day < $2::date) AS paid_before
                FROM cur FULL JOIN prev ON prev.network_id = cur.network_id
               WHERE COALESCE(cur.mrr, 0) <> COALESCE(prev.mrr, 0) OR cur.currency IS DISTINCT FROM prev.currency),
            moves AS (
              -- Same currency: expansion / contraction, or churn (to 0), or new / reactivation (from 0).
              SELECT network_id, COALESCE(cur_currency, prev_currency) AS currency,
                     CASE WHEN prev_mrr = 0 THEN CASE WHEN paid_before THEN 'reactivation' ELSE 'new' END
                          WHEN cur_mrr = 0 THEN 'churn'
                          WHEN cur_mrr > prev_mrr THEN 'expansion' ELSE 'contraction' END AS kind,
                     cur_mrr - prev_mrr AS amount, prev_mrr AS from_mrr, cur_mrr AS to_mrr
                FROM pairs WHERE prev_currency IS NULL OR cur_currency IS NULL OR prev_currency = cur_currency
              UNION ALL
              -- A different currency: the old one churns, the new one starts.
              SELECT network_id, prev_currency, 'churn', -prev_mrr, prev_mrr, 0 FROM pairs WHERE prev_currency <> cur_currency
              UNION ALL
              SELECT network_id, cur_currency, 'new', cur_mrr, 0, cur_mrr FROM pairs WHERE prev_currency <> cur_currency)
       INSERT INTO platform_mrr_movements (day, network_id, currency, kind, amount, from_mrr, to_mrr)
       SELECT $1::date, network_id, currency, kind, amount, from_mrr, to_mrr FROM moves`, [day, prevDay]);
    return { paying, movements: rowCount ?? 0, baseline: false };
  });
}

/**
 * MRR at the end of each of the last 12 months (this one so far), per currency — the last snapshot day of each
 * month; months before the history began are absent. `ids` = the networks an 'assigned' role may see (null = all).
 * The Revenue page and the Overview.
 */
export async function mrrTrend(ids: string[] | null): Promise<{ month: string; currency: string; mrr: string; customers: number }[]> {
  return (await query<{ month: string; currency: string; mrr: string; customers: number }>(
    `SELECT to_char(mo, 'YYYY-MM') AS month, s.currency, SUM(s.mrr)::text AS mrr, COUNT(*)::int AS customers
       FROM (SELECT (date_trunc('month', now() AT TIME ZONE 'UTC') - make_interval(months => g))::date AS mo FROM generate_series(0, 11) g) months
       JOIN LATERAL (SELECT max(day) AS d FROM platform_mrr_days WHERE day >= mo AND day < (mo + interval '1 month')::date) last ON last.d IS NOT NULL
       JOIN platform_mrr_snapshots s ON s.day = last.d AND ($1::uuid[] IS NULL OR s.network_id = ANY($1::uuid[]))
      GROUP BY 1, s.currency ORDER BY 1, s.currency`, [ids])).rows;
}

/** Live MRR per network (for the pages; the same numbers the snapshot stores). */
export async function currentMrr(): Promise<{ network_id: string; currency: string; plan_id: string; plan_name: string; status: string; mrr: string }[]> {
  return (await query<{ network_id: string; currency: string; plan_id: string; plan_name: string; status: string; mrr: string }>(
    `SELECT network_id, currency, plan_id, plan_name, status, mrr::text FROM (${NETWORK_MRR_SQL}) m WHERE m.mrr > 0`)).rows;
}
