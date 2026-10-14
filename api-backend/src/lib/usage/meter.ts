/**
 * Plan metering (audit F-26). The usage-meter worker counts each active network's clicks, conversions
 * and events (conversions that carry an event name) per UTC day into usage_records — today and
 * yesterday on every run, so late rows land — then compares the billing period's usage with the plan's
 * limits and raises an alert when a limit is near (≥ 80 %) or reached (≥ 100 %), once per period.
 *
 * POLICY at the limit (decision): FLAG, never block. Clicks keep tracking over the limit; the network
 * gets the alerts and both its own subscription view and the platform's usage view show the limit as
 * 'over'. Dropping a customer's traffic on a metering signal risks their revenue, and the platform admin
 * has the real levers (change plan, suspend the network — which does stop tracking).
 *
 * Limits (plan.limits, as the super-admin plan form writes them): `clicks`, `conversions`, `events`
 * per billing period; `offers` (non-archived offers) and `seats` (active users) as current counts. The
 * billing period is the subscription's current period when it has one covering now, else the UTC month.
 */
import { query } from '../db/pool.js';
import { raiseAlert } from '../fraud/alerts.js';
import { logger } from '../logger.js';

export const METERED = ['clicks', 'conversions', 'events'] as const;
export type MeteredMetric = (typeof METERED)[number];
const COUNTED = ['offers', 'seats'] as const;
export type LimitKey = MeteredMetric | (typeof COUNTED)[number];

const NEAR = 0.8;
const DAY_MS = 86_400_000;
const utcDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Count one network's usage for one UTC day (YYYY-MM-DD) into usage_records (idempotent upsert). */
export async function meterDay(networkId: string, day: string): Promise<Record<MeteredMetric, number>> {
  const start = `${day}T00:00:00Z`;
  const end = `${utcDate(new Date(Date.parse(start) + DAY_MS))}T00:00:00Z`;
  const [clicks, convs] = await Promise.all([
    query<{ n: string }>('SELECT COUNT(*)::text AS n FROM clicks WHERE network_id = $1 AND created_at >= $2 AND created_at < $3', [networkId, start, end]),
    query<{ n: string; e: string }>(
      `SELECT COUNT(*)::text AS n, COUNT(*) FILTER (WHERE event_name IS NOT NULL AND event_name <> '')::text AS e
         FROM conversions WHERE network_id = $1 AND created_at >= $2 AND created_at < $3`, [networkId, start, end]),
  ]);
  const counts: Record<MeteredMetric, number> = {
    clicks: Number(clicks.rows[0]?.n ?? 0), conversions: Number(convs.rows[0]?.n ?? 0), events: Number(convs.rows[0]?.e ?? 0),
  };
  await query(
    `INSERT INTO usage_records (network_id, metric, period_date, value)
     SELECT $1, m, $2::date, v FROM unnest($3::text[], $4::bigint[]) AS t(m, v)
     ON CONFLICT (network_id, metric, period_date) DO UPDATE SET value = EXCLUDED.value`,
    [networkId, day, METERED as readonly string[], METERED.map((m) => counts[m])]);
  return counts;
}

export interface LimitStatus { key: LimitKey; used: number; limit: number; pct: number; state: 'ok' | 'near' | 'over' }
export interface UsageVsPlan {
  plan: { code: string; name: string } | null;
  period: { start: string; end: string };
  limits: LimitStatus[];
}

/** The billing period covering `now`: the subscription's, when it has one, else the UTC month. */
function billingPeriod(sub: { current_period_start: Date | null; current_period_end: Date | null } | undefined, now: Date): { start: string; end: string } {
  const s = sub?.current_period_start;
  const e = sub?.current_period_end;
  if (s && e && s <= now && now < e) return { start: utcDate(s), end: utcDate(e) };
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: utcDate(first), end: utcDate(next) };
}

/** A network's usage this billing period against its plan's limits (only the limits the plan sets). */
export async function usageVsPlan(networkId: string, now: Date = new Date()): Promise<UsageVsPlan> {
  const sub = (await query<{ code: string; name: string; limits: Record<string, unknown>; current_period_start: Date | null; current_period_end: Date | null }>(
    `SELECT p.code, p.name, p.limits, s.current_period_start, s.current_period_end
       FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
      WHERE s.network_id = $1 AND s.status IN ('trialing', 'active', 'past_due')`, [networkId])).rows[0];
  const period = billingPeriod(sub, now);
  const limits: LimitStatus[] = [];
  if (!sub) return { plan: null, period, limits };

  const want = (k: LimitKey): number | null => {
    const v = Number(sub.limits?.[k]);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const used: Partial<Record<LimitKey, number>> = {};
  if (METERED.some((m) => want(m) !== null)) {
    const { rows } = await query<{ metric: MeteredMetric; total: string }>(
      `SELECT metric, SUM(value)::text AS total FROM usage_records
        WHERE network_id = $1 AND period_date >= $2 AND period_date < $3 AND metric = ANY($4::text[])
        GROUP BY metric`, [networkId, period.start, period.end, METERED as readonly string[]]);
    for (const r of rows) used[r.metric] = Number(r.total);
  }
  if (want('offers') !== null) {
    used.offers = Number((await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM offers WHERE network_id = $1 AND status <> 'archived'`, [networkId])).rows[0]?.n ?? 0);
  }
  if (want('seats') !== null) {
    used.seats = Number((await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM users WHERE network_id = $1 AND status = 'active'`, [networkId])).rows[0]?.n ?? 0);
  }
  for (const key of [...METERED, ...COUNTED]) {
    const limit = want(key);
    if (limit === null) continue;
    const u = used[key] ?? 0;
    const pct = u / limit;
    limits.push({ key, used: u, limit, pct: Math.round(pct * 1000) / 10, state: pct >= 1 ? 'over' : pct >= NEAR ? 'near' : 'ok' });
  }
  return { plan: { code: sub.code, name: sub.name }, period, limits };
}

const LABEL: Record<LimitKey, string> = { clicks: 'Clicks', conversions: 'Conversions', events: 'Events', offers: 'Offers', seats: 'Seats' };

/** Raise the near / reached alerts for this period — each at most once per limit per period. */
async function alertOnLimits(networkId: string, u: UsageVsPlan): Promise<number> {
  let raised = 0;
  for (const l of u.limits) {
    if (l.state === 'ok') continue;
    const type = l.state === 'over' ? 'plan_limit_reached' : 'plan_limit_near';
    const entityId = `${l.key}:${u.period.start}`;
    const seen = await query('SELECT 1 FROM alerts WHERE network_id = $1 AND type = $2 AND entity_id = $3 LIMIT 1', [networkId, type, entityId]);
    if (seen.rowCount) continue;
    const id = await raiseAlert(networkId, {
      type, severity: l.state === 'over' ? 'high' : 'medium', entityType: 'plan_usage', entityId,
      title: l.state === 'over' ? `${LABEL[l.key]} plan limit reached` : `${LABEL[l.key]} near the plan limit`,
      description: `${l.used.toLocaleString('en-US')} of ${l.limit.toLocaleString('en-US')} ${LABEL[l.key].toLowerCase()} (${l.pct}%) on the ${u.plan?.name ?? ''} plan`
        + `${['offers', 'seats'].includes(l.key) ? '' : ` for ${u.period.start} – ${u.period.end}`}. Tracking is not blocked — upgrade the plan or contact the platform administrator.`,
      metadata: { metric: l.key, used: l.used, limit: l.limit, pct: l.pct, period: u.period, plan: u.plan?.code },
    });
    if (id) raised++;
  }
  return raised;
}

/** Meter one network (yesterday + today, UTC) and raise any limit alert due; returns alerts raised. */
export async function meterNetwork(networkId: string, now: Date = new Date()): Promise<number> {
  for (const day of [utcDate(new Date(now.getTime() - DAY_MS)), utcDate(now)]) await meterDay(networkId, day);
  return alertOnLimits(networkId, await usageVsPlan(networkId, now));
}

/** The worker's run: every active network. */
export async function runUsageMeter(now: Date = new Date()): Promise<{ networks: number; alerts: number }> {
  const { rows } = await query<{ id: string }>(`SELECT id FROM networks WHERE status = 'active' ORDER BY created_at`);
  let alerts = 0;
  for (const { id } of rows) {
    try {
      alerts += await meterNetwork(id, now);
    } catch (err) {
      logger.warn({ err, networkId: id }, 'usage meter failed for a network');
    }
  }
  return { networks: rows.length, alerts };
}
