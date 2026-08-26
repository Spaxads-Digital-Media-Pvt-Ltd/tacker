/**
 * Shared rule-evaluation engine for Advertiser Tiered Commissions — used both by the CRUD routes
 * and by recordConversion() to actually adjust real conversion payout/revenue once a Partner
 * crosses a volume threshold within a rolling period. Variables are limited to what this app can
 * honestly compute from the conversions table (conversion count, total payout, total revenue) —
 * no fabricated "Sale Amount"/"Event" metrics distinct from those. Retroactive Mode is stored for
 * real but only "disabled" semantics are enforced (affects this conversion and future ones once a
 * threshold is crossed) — retroactively rewriting already-recorded conversions would need a batch
 * reprocessing job this app doesn't have.
 */
import { query } from '../db/pool.js';

export const TIERED_VARIABLES = ['conversion', 'total_payout', 'total_revenue'] as const;
export type TieredVariable = typeof TIERED_VARIABLES[number];
export const TIERED_ACTIONS = ['decrease_flat', 'decrease_pct', 'increase_flat', 'increase_pct'] as const;
export type TieredAction = typeof TIERED_ACTIONS[number];
export const TIME_PERIODS = ['daily', 'weekly', 'monthly', 'quarterly', 'global'] as const;
export type TimePeriod = typeof TIME_PERIODS[number];

export interface TieredGoal { variable: TieredVariable; minValue: number; maxValue: number | null }

export interface ConversionContext {
  offerId: string;
  advertiserId: string | null;
  publisherId: string | null;
  payout: number;
  revenue: number;
}

interface CommissionRow {
  id: string; name: string; target_type: 'offer' | 'advertiser'; target_ids: string[]; partner_ids: string[];
  time_period: TimePeriod; goals: TieredGoal[];
  payout_enabled: boolean; payout_action: TieredAction | null; payout_value: string | null;
  revenue_enabled: boolean; revenue_action: TieredAction | null; revenue_value: string | null;
}

function periodStart(period: TimePeriod, now: Date): Date {
  const d = new Date(now);
  if (period === 'daily') { d.setHours(0, 0, 0, 0); return d; }
  if (period === 'weekly') {
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1; // Monday start
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (period === 'monthly') return new Date(d.getFullYear(), d.getMonth(), 1);
  if (period === 'quarterly') { const q = Math.floor(d.getMonth() / 3); return new Date(d.getFullYear(), q * 3, 1); }
  return new Date(0); // global — lifetime
}

export function applyAction(base: number, action: TieredAction | null | undefined, value: string | number | null | undefined): number {
  if (!action || value == null) return base;
  const v = Number(value);
  if (action === 'increase_flat') return base + v;
  if (action === 'decrease_flat') return Math.max(0, base - v);
  if (action === 'increase_pct') return base * (1 + v / 100);
  if (action === 'decrease_pct') return Math.max(0, base * (1 - v / 100));
  return base;
}

async function currentPeriodValue(
  networkId: string, publisherId: string, targetType: 'offer' | 'advertiser', targetIds: string[],
  variable: TieredVariable, since: Date,
): Promise<number> {
  const targetCol = targetType === 'offer' ? 'offer_id' : 'advertiser_id';
  const params: unknown[] = [networkId, publisherId, since];
  let where = `network_id = $1 AND publisher_id = $2 AND status = 'approved' AND created_at >= $3`;
  if (targetIds.length > 0) {
    params.push(targetIds);
    where += ` AND ${targetCol} = ANY($${params.length})`;
  }
  const col = variable === 'conversion' ? 'COUNT(*)' : variable === 'total_payout' ? 'COALESCE(SUM(payout), 0)' : 'COALESCE(SUM(revenue), 0)';
  const { rows } = await query<{ v: string }>(`SELECT ${col}::text AS v FROM conversions WHERE ${where}`, params);
  return Number(rows[0]?.v ?? 0);
}

/** First active, in-effect, matching-target-and-partner commission whose goals match wins.
 * Returns the (possibly unchanged) payout/revenue plus which commission applied, if any. */
export async function applyTieredCommission(
  networkId: string, ctx: ConversionContext,
): Promise<{ payout: number; revenue: number; appliedId: string | null; appliedName: string | null }> {
  if (!ctx.publisherId) return { payout: ctx.payout, revenue: ctx.revenue, appliedId: null, appliedName: null };

  const { rows } = await query<CommissionRow>(
    `SELECT id, name, target_type, target_ids, partner_ids, time_period, goals,
            payout_enabled, payout_action, payout_value, revenue_enabled, revenue_action, revenue_value
       FROM advertiser_tiered_commissions
      WHERE network_id = $1 AND status = 'active'
        AND (effective_start IS NULL OR effective_start <= now())
        AND (effective_end IS NULL OR effective_end >= now())
      ORDER BY ref ASC`,
    [networkId],
  );

  for (const row of rows) {
    if (row.target_type === 'offer' && !row.target_ids.includes(ctx.offerId)) continue;
    if (row.target_type === 'advertiser' && (!ctx.advertiserId || !row.target_ids.includes(ctx.advertiserId))) continue;
    if (row.partner_ids.length > 0 && !row.partner_ids.includes(ctx.publisherId)) continue;

    const since = periodStart(row.time_period, new Date());
    let matched = false;
    for (const goal of row.goals) {
      const current = await currentPeriodValue(networkId, ctx.publisherId, row.target_type, row.target_ids, goal.variable, since);
      const projected = goal.variable === 'conversion' ? current + 1 : current + (goal.variable === 'total_payout' ? ctx.payout : ctx.revenue);
      if (projected >= goal.minValue && (goal.maxValue == null || projected < goal.maxValue)) { matched = true; break; }
    }
    if (!matched) continue;

    const payout = row.payout_enabled ? applyAction(ctx.payout, row.payout_action, row.payout_value) : ctx.payout;
    const revenue = row.revenue_enabled ? applyAction(ctx.revenue, row.revenue_action, row.revenue_value) : ctx.revenue;
    return { payout, revenue, appliedId: row.id, appliedName: row.name };
  }
  return { payout: ctx.payout, revenue: ctx.revenue, appliedId: null, appliedName: null };
}
