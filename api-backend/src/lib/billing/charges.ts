/**
 * What a subscription's invoice is made of — its lines, computed in whole cents (never floats):
 *
 *   plan      the plan's price for the period;
 *   overage   for the period that just ended, each metric over the plan's limit, charged per started block
 *             (subscription_plans.overage: { clicks: { per: 1000, price: "0.50" } } — 1,200 clicks over the
 *             limit = 2 blocks = 1.00);
 *   discount  the network's active coupon: a percent of the plan line, or an amount in the plan's currency —
 *             never more than the plan line (overage is never discounted).
 *
 * After its invoice is issued the discount is used: a 'once' coupon ends, a 'repeating' one has a cycle fewer
 * (and ends at 0), a 'forever' one stays.
 */
import type { PoolClient } from 'pg';
import { centsToDecimal } from './invoices.js';

type Db = Pick<PoolClient, 'query'>;

export type LineKind = 'plan' | 'overage' | 'discount' | 'addon' | 'setup' | 'one_off';
export interface InvoiceLine { kind: LineKind; description: string; quantity: string; unitAmount: string; amount: string; meta?: Record<string, unknown> }

export const OVERAGE_METRICS = ['clicks', 'conversions', 'events'] as const;
export type OverageMetric = (typeof OVERAGE_METRICS)[number];
export type OverageConfig = Partial<Record<OverageMetric, { per: number; price: string }>>;

/** "0.50" → 50 cents; null unless a non-negative amount with at most 2 decimals. */
export function toCents(text: string): number | null {
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(String(text).trim());
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : null;
}

const group = (n: number) => n.toLocaleString('en-US');
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** "Growth plan · 2026-10-16 – 2026-11-16" — what an invoice for one period says. */
export const periodDescription = (planName: string, start: Date, end: Date): string => `${planName} plan · ${ymd(start)} – ${ymd(end)}`;

export interface ActiveDiscount {
  id: string; coupon_id: string; code: string; name: string; kind: 'percent' | 'amount'; percent_off: string | null; amount_off: string | null;
  currency: string | null; duration: 'once' | 'repeating' | 'forever'; cycles_left: number | null;
}

export async function activeDiscount(db: Db, networkId: string): Promise<ActiveDiscount | null> {
  return (await db.query<ActiveDiscount>(
    `SELECT d.id, d.coupon_id, c.code, c.name, c.kind, c.percent_off::text, c.amount_off::text, c.currency, c.duration, d.cycles_left
       FROM subscription_discounts d JOIN platform_coupons c ON c.id = d.coupon_id
      WHERE d.network_id = $1 AND d.ended_at IS NULL`, [networkId])).rows[0] ?? null;
}

/** The discount in cents off a plan line of `planCents` (0 when the coupon's currency isn't the plan's). */
export function discountCents(d: Pick<ActiveDiscount, 'kind' | 'percent_off' | 'amount_off' | 'currency'>, planCents: number, planCurrency: string): number {
  if (d.kind === 'percent') {
    const bp = toCents(d.percent_off ?? '0') ?? 0; // "12.5" % → 1250 basis points
    return Math.min(planCents, Math.round((planCents * bp) / 10000));
  }
  if ((d.currency ?? '').toUpperCase() !== planCurrency.toUpperCase()) return 0;
  return Math.min(planCents, toCents(d.amount_off ?? '0') ?? 0);
}

/** Overage lines for one metric each, from usage over [start, end) against the plan's limits (pure). */
export function overageLines(used: Partial<Record<OverageMetric, number>>, limits: Record<string, unknown>, overage: OverageConfig, currency: string): InvoiceLine[] {
  const out: InvoiceLine[] = [];
  for (const metric of OVERAGE_METRICS) {
    const cfg = overage[metric];
    const limit = limits[metric];
    const u = used[metric] ?? 0;
    if (!cfg || typeof limit !== 'number' || u <= limit) continue;
    const priceCents = toCents(cfg.price);
    if (!priceCents || !(cfg.per >= 1)) continue;
    const blocks = Math.ceil((u - limit) / cfg.per);
    out.push({
      kind: 'overage',
      description: `${metric[0]!.toUpperCase()}${metric.slice(1)} over the plan's ${group(limit)} · ${group(u)} used · ${group(blocks)} × ${group(cfg.per)} at ${currency} ${centsToDecimal(priceCents)}`,
      quantity: String(blocks), unitAmount: centsToDecimal(priceCents), amount: centsToDecimal(blocks * priceCents),
      meta: { metric, used: u, limit, per: cfg.per },
    });
  }
  return out;
}

export interface PlanForLines { name: string; price_cents: number; currency: string; limits: Record<string, unknown>; overage?: OverageConfig | null }

/**
 * The plan line for `period`, overage for `usagePeriod` (the period that just ended — omitted after a trial)
 * and the network's discount. `subtotal` = their sum.
 */
export async function subscriptionLines(db: Db, networkId: string, plan: PlanForLines, period: { start: Date; end: Date },
  usagePeriod: { start: Date; end: Date } | null): Promise<{ lines: InvoiceLine[]; subtotal: string; discount: ActiveDiscount | null }> {
  const planCents = plan.price_cents;
  const lines: InvoiceLine[] = [{
    kind: 'plan', description: periodDescription(plan.name, period.start, period.end),
    quantity: '1', unitAmount: centsToDecimal(planCents), amount: centsToDecimal(planCents),
  }];
  let cents = planCents;
  const overage = plan.overage ?? {};
  if (usagePeriod && Object.keys(overage).length) {
    const { rows } = await db.query<{ metric: OverageMetric; used: string }>(
      `SELECT metric, COALESCE(SUM(value), 0)::text AS used FROM usage_records
        WHERE network_id = $1 AND metric = ANY($2::text[])
          AND period_date >= ($3::timestamptz AT TIME ZONE 'UTC')::date AND period_date < ($4::timestamptz AT TIME ZONE 'UTC')::date
        GROUP BY metric`, [networkId, Object.keys(overage), usagePeriod.start, usagePeriod.end]);
    const used = Object.fromEntries(rows.map((r) => [r.metric, Number(r.used)]));
    for (const l of overageLines(used, plan.limits ?? {}, overage, plan.currency)) { lines.push(l); cents += toCents(l.amount)!; }
  }
  const discount = await activeDiscount(db, networkId);
  if (discount) {
    const off = discountCents(discount, planCents, plan.currency);
    if (off > 0) {
      lines.push({
        kind: 'discount', description: `Discount · ${discount.name} (${discount.code.toUpperCase()})`, quantity: '1',
        unitAmount: `-${centsToDecimal(off)}`, amount: `-${centsToDecimal(off)}`, meta: { couponId: discount.coupon_id },
      });
      cents -= off;
    }
  }
  return { lines, subtotal: centsToDecimal(Math.max(0, cents)), discount };
}

/** A discount was billed once: 'once' ends; 'repeating' counts down (ends at 0); 'forever' stays. */
export async function useDiscount(db: Db, d: ActiveDiscount): Promise<void> {
  if (d.duration === 'once') await db.query('UPDATE subscription_discounts SET ended_at = now(), cycles_left = 0 WHERE id = $1', [d.id]);
  else if (d.duration === 'repeating') {
    await db.query(`UPDATE subscription_discounts SET cycles_left = GREATEST(COALESCE(cycles_left, 1) - 1, 0),
                           ended_at = CASE WHEN COALESCE(cycles_left, 1) - 1 <= 0 THEN now() END WHERE id = $1`, [d.id]);
  }
}
