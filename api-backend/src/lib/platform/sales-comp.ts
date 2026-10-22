/**
 * Super Admin › Sales › quotas and commissions.
 *
 * - Quota: a salesperson's target of new MRR won in a UTC month, per currency (sales_quotas). Attainment =
 *   the expected MRR of the leads they own that were won in that month.
 * - Commission (sales_comp_plans): a % of what the networks they sold (networks.sales_owner_id) PAID — paid
 *   platform invoices by paid_at month (UTC), per currency — optionally only for the first N months after the
 *   deal was won (the lead's won_at, else the network's creation). The current % applies, rounded to cents
 *   per month and currency (as reseller statements are). Money is text.
 */
import { query } from '../db/pool.js';

/** "2026-10" → "2026-10-01" (or null when it isn't a month). */
export function monthStart(month: string): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  return m ? `${m[1]}-${m[2]}-01` : null;
}
export const currentMonth = (): string => new Date().toISOString().slice(0, 7);

export interface TeamRow {
  id: string; name: string; email: string; role_name: string;
  comp: { commissionPct: string; commissionMonths: number | null } | null;
  quota: { currency: string; target: string }[];
  won: { currency: string; amount: string; deals: number }[];
  commission: { currency: string; paid: string; amount: string }[];
}

// Invoices that earn commission for their network's salesperson: paid, by a network they sold, within the plan's window.
const EARNING = `FROM platform_invoices i
  JOIN networks n ON n.id = i.network_id
  JOIN sales_comp_plans c ON c.admin_id = n.sales_owner_id
  LEFT JOIN sales_leads wl ON wl.network_id = n.id
 WHERE i.status = 'paid' AND i.paid_amount IS NOT NULL
   AND (c.commission_months IS NULL OR i.paid_at < COALESCE(wl.won_at, n.created_at) + make_interval(months => c.commission_months))`;

/**
 * The sales team for a month: every active member whose role sells (sales at full) or who has a quota / comp
 * plan, with their quota, what they won and the commission earned that month. `only` limits it to one member.
 */
export async function salesTeam(month: string, only?: string): Promise<TeamRow[]> {
  const start = monthStart(month);
  if (!start) return [];
  const params: unknown[] = [start];
  let onlySql = '';
  if (only) { params.push(only); onlySql = `AND pa.id = $${params.length}`; }
  const { rows } = await query<TeamRow>(
    `WITH m AS (SELECT $1::date AS start, ($1::date + interval '1 month')::date AS stop)
     SELECT pa.id, COALESCE(pa.name, pa.email) AS name, pa.email, r.name AS role_name,
            (SELECT json_build_object('commissionPct', c.commission_pct::text, 'commissionMonths', c.commission_months)
               FROM sales_comp_plans c WHERE c.admin_id = pa.id) AS comp,
            COALESCE((SELECT json_agg(json_build_object('currency', q.currency, 'target', q.target::text) ORDER BY q.currency)
               FROM sales_quotas q, m WHERE q.admin_id = pa.id AND q.month = m.start), '[]'::json) AS quota,
            COALESCE((SELECT json_agg(json_build_object('currency', w.currency, 'amount', w.amount, 'deals', w.deals) ORDER BY w.currency)
               FROM (SELECT l.currency, COALESCE(SUM(l.expected_mrr), 0)::numeric(14,2)::text AS amount, COUNT(*)::int AS deals
                       FROM sales_leads l, m WHERE l.owner_id = pa.id AND l.stage = 'won'
                        AND l.won_at >= m.start::timestamp AT TIME ZONE 'UTC' AND l.won_at < m.stop::timestamp AT TIME ZONE 'UTC'
                      GROUP BY l.currency) w), '[]'::json) AS won,
            COALESCE((SELECT json_agg(json_build_object('currency', e.currency, 'paid', e.paid, 'amount', e.amount) ORDER BY e.currency)
               FROM (SELECT i.currency, SUM(i.paid_amount)::numeric(14,2)::text AS paid,
                            ROUND(SUM(i.paid_amount) * c.commission_pct / 100, 2)::numeric(14,2)::text AS amount
                       ${EARNING} AND n.sales_owner_id = pa.id
                        AND i.paid_at >= (SELECT start FROM m)::timestamp AT TIME ZONE 'UTC' AND i.paid_at < (SELECT stop FROM m)::timestamp AT TIME ZONE 'UTC'
                      GROUP BY i.currency, c.commission_pct) e), '[]'::json) AS commission
       FROM platform_admins pa JOIN platform_roles r ON r.id = pa.role_id
      WHERE pa.status = 'active' ${onlySql}
        AND (r.permissions->>'sales' = 'full' OR EXISTS (SELECT 1 FROM sales_comp_plans c WHERE c.admin_id = pa.id)
             OR EXISTS (SELECT 1 FROM sales_quotas q, m WHERE q.admin_id = pa.id AND q.month = m.start))
      ORDER BY name`, params);
  return rows;
}

/** A salesperson's commission per month and currency, the last `months` UTC months (newest first). */
export async function commissionStatement(adminId: string, months = 12): Promise<{ month: string; currency: string; paid: string; invoices: number; commission: string }[]> {
  const { rows } = await query<{ month: string; currency: string; paid: string; invoices: number; commission: string }>(
    `SELECT to_char(i.paid_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month, i.currency,
            SUM(i.paid_amount)::numeric(14,2)::text AS paid, COUNT(*)::int AS invoices,
            ROUND(SUM(i.paid_amount) * c.commission_pct / 100, 2)::numeric(14,2)::text AS commission
       ${EARNING} AND n.sales_owner_id = $1
        AND i.paid_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') - make_interval(months => $2 - 1)) AT TIME ZONE 'UTC'
      GROUP BY 1, i.currency, c.commission_pct
      ORDER BY 1 DESC, i.currency`, [adminId, months]);
  return rows;
}

/** The invoices behind one month of a statement. */
export async function commissionInvoices(adminId: string, month: string) {
  const start = monthStart(month);
  if (!start) return [];
  return (await query<{ id: string; number: string; network_id: string; network_name: string; currency: string; paid_amount: string; paid_at: string; commission: string }>(
    `SELECT i.id, i.number::text AS number, n.id AS network_id, n.name AS network_name, i.currency, i.paid_amount::text AS paid_amount, i.paid_at,
            ROUND(i.paid_amount * c.commission_pct / 100, 2)::numeric(14,2)::text AS commission
       ${EARNING} AND n.sales_owner_id = $1
        AND i.paid_at >= $2::date::timestamp AT TIME ZONE 'UTC' AND i.paid_at < ($2::date + interval '1 month')::timestamp AT TIME ZONE 'UTC'
      ORDER BY i.paid_at`, [adminId, start])).rows;
}

/** A member's quota and what they've won this UTC month (the Sales dashboard's "Your quota"). */
export async function myQuota(adminId: string): Promise<{ currency: string; target: string; won: string }[]> {
  const t = (await salesTeam(currentMonth(), adminId))[0];
  if (!t) return [];
  return t.quota.map((q) => ({ currency: q.currency, target: q.target, won: t.won.find((w) => w.currency === q.currency)?.amount ?? '0.00' }));
}
