/**
 * Shared rule-evaluation engine for Customer Value (Payout & Revenue Rules) — used both by the
 * CRUD routes and by recordConversion() to actually adjust real conversion payout/revenue once a
 * customer's tracked activity meets a rule's conditions. Mirrors the same real-enforcement
 * pattern as lib/tiered-commissions/evaluate.ts and lib/postback-controls/evaluate.ts.
 *
 * Customer identity is the `user_id` a caller passes on the postback/pixel/S2S conversion call —
 * captured verbatim in conversions.raw_params already (surfaces/tracking/app.ts merges all query
 * + body params). Custom Data Points read named keys out of that same raw_params bag. No fields
 * are fabricated: every condition is evaluated against real historical conversions plus the
 * conversion currently being recorded.
 *
 * `conversion_event_grouping: 'separately_by'` is stored for real (matches the reference's own
 * "Scope" field) but evaluated identically to 'all_together' — the reference doesn't specify what
 * dimension "separately by" splits on beyond the label, so implementing a guessed dimension would
 * be dishonest; the field is real, persisted data, just not yet a second evaluation path.
 */
import { query } from '../db/pool.js';

export const CV_TEXT_OPERATORS = ['exact_match'] as const;
export const CV_NUMBER_OPERATORS = ['greater_than', 'greater_than_or_equal_to', 'less_than', 'less_than_or_equal_to', 'equal_to'] as const;

export interface CvCondition {
  dataPointId: string;
  conditionLogic: 'any_value' | 'sum_of_values';
  operator: string;
  value: string;
}

interface DataPointRow { id: string; name: string; data_type: 'text' | 'number'; parameter_key: string }

interface RuleRow {
  id: string; name: string; status: string;
  apply_offers_mode: string; apply_offer_ids: string[];
  apply_advertisers_mode: string; apply_advertiser_ids: string[];
  apply_partners_mode: string; apply_partner_ids: string[];
  start_date: string | null; end_date: string | null;
  goal_cycle: string; recurring_duration: string | null;
  continuous_mode: string | null; continuous_days: number | null;
  set_goal_conditions: boolean; conditions: CvCondition[];
  outcome_frequency: string; payout_value: string | null; revenue_value: string | null;
}

export interface CvContext {
  networkId: string;
  offerId: string;
  advertiserId: string | null;
  publisherId: string | null;
  userId: string | null;
  payout: number;
  revenue: number;
  rawParams: Record<string, unknown>;
}

export interface CvResult {
  payout: number; revenue: number; appliedId: string | null; appliedName: string | null;
  payoutOverridden: boolean; revenueOverridden: boolean;
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function compareNumber(value: number, operator: string, target: number): boolean {
  if (operator === 'greater_than') return value > target;
  if (operator === 'greater_than_or_equal_to') return value >= target;
  if (operator === 'less_than') return value < target;
  if (operator === 'less_than_or_equal_to') return value <= target;
  if (operator === 'equal_to') return value === target;
  return false;
}

function ruleMatchesScope(rule: RuleRow, offerId: string, advertiserId: string | null, publisherId: string | null): boolean {
  if (rule.apply_offers_mode === 'specific' && !rule.apply_offer_ids.includes(offerId)) return false;
  if (rule.apply_advertisers_mode === 'specific' && (!advertiserId || !rule.apply_advertiser_ids.includes(advertiserId))) return false;
  if (rule.apply_partners_mode === 'specific' && (!publisherId || !rule.apply_partner_ids.includes(publisherId))) return false;
  return true;
}

function periodStart(period: string, now: Date): Date {
  const d = new Date(now);
  if (period === 'daily') { d.setHours(0, 0, 0, 0); return d; }
  if (period === 'weekly') {
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (period === 'monthly') return new Date(d.getFullYear(), d.getMonth(), 1);
  if (period === 'quarterly') { const q = Math.floor(d.getMonth() / 3); return new Date(d.getFullYear(), q * 3, 1); }
  return new Date(0);
}

/** First approved conversion timestamp for this user within the rule's offer/partner scope. */
async function firstConversionAt(networkId: string, rule: RuleRow, userId: string): Promise<Date | null> {
  const params: unknown[] = [networkId, userId];
  let where = `network_id = $1 AND status = 'approved' AND raw_params->>'user_id' = $2`;
  if (rule.apply_offers_mode === 'specific' && rule.apply_offer_ids.length) {
    params.push(rule.apply_offer_ids);
    where += ` AND offer_id = ANY($${params.length})`;
  }
  if (rule.apply_advertisers_mode === 'specific' && rule.apply_advertiser_ids.length) {
    params.push(rule.apply_advertiser_ids);
    where += ` AND advertiser_id = ANY($${params.length})`;
  }
  if (rule.apply_partners_mode === 'specific' && rule.apply_partner_ids.length) {
    params.push(rule.apply_partner_ids);
    where += ` AND publisher_id = ANY($${params.length})`;
  }
  const { rows } = await query<{ created_at: string }>(
    `SELECT created_at FROM conversions WHERE ${where} ORDER BY created_at ASC LIMIT 1`, params,
  );
  return rows[0] ? new Date(rows[0].created_at) : null;
}

async function resolveWindow(networkId: string, rule: RuleRow, userId: string, now: Date): Promise<{ start: Date; end: Date | null } | null> {
  // Rule Duration (Start/End Date) gates the rule regardless of Goal Cycle mode.
  const effStart = rule.start_date ? new Date(rule.start_date) : null;
  const effEnd = rule.end_date ? new Date(`${rule.end_date}T23:59:59.999Z`) : null;
  if (effStart && now < effStart) return null;
  if (effEnd && now > effEnd) return null;

  if (rule.goal_cycle === 'continuous') {
    if (rule.continuous_mode === 'from_first_conversion') {
      const first = (await firstConversionAt(networkId, rule, userId)) ?? now; // no prior history — this conversion anchors the window
      const end = rule.continuous_days ? new Date(first.getTime() + rule.continuous_days * 86400000) : null;
      if (end && now > end) return null;
      return { start: first, end };
    }
    return { start: effStart ?? new Date(0), end: effEnd };
  }
  return { start: periodStart(rule.recurring_duration ?? 'monthly', now), end: null };
}

/** Every value recorded for this data point for this user within the window, PLUS the current
 * (not-yet-inserted) conversion's value if present — reproduces the "Swiss cheese" accumulation
 * described in the reference's own Customer Value docs, where the conversion that completes a
 * rule's conditions is itself one of the data points. */
async function collectValues(
  networkId: string, dp: DataPointRow, userId: string, window: { start: Date; end: Date | null },
  currentRawParams: Record<string, unknown>,
): Promise<(string | number)[]> {
  const params: unknown[] = [networkId, userId, dp.parameter_key, window.start.toISOString()];
  let where = `network_id = $1 AND status = 'approved' AND raw_params->>'user_id' = $2 AND raw_params ? $3 AND created_at >= $4`;
  if (window.end) { params.push(window.end.toISOString()); where += ` AND created_at <= $${params.length}`; }
  const { rows } = await query<{ v: string }>(
    `SELECT raw_params->>'${dp.parameter_key.replace(/'/g, "''")}' AS v FROM conversions WHERE ${where}`, params,
  );
  const values: (string | number)[] = [];
  for (const r of rows) {
    if (dp.data_type === 'number') { const n = numOrNull(r.v); if (n != null) values.push(n); }
    else if (r.v != null) values.push(r.v);
  }
  const cur = currentRawParams[dp.parameter_key];
  if (cur != null) {
    if (dp.data_type === 'number') { const n = numOrNull(cur); if (n != null) values.push(n); }
    else values.push(String(cur));
  }
  return values;
}

function evaluateCondition(dp: DataPointRow, cond: CvCondition, values: (string | number)[]): boolean {
  if (dp.data_type === 'text') {
    return values.some((v) => String(v).toLowerCase() === cond.value.toLowerCase());
  }
  const target = Number(cond.value);
  if (!Number.isFinite(target)) return false;
  const nums = values.filter((v): v is number => typeof v === 'number');
  if (cond.conditionLogic === 'sum_of_values') {
    return compareNumber(nums.reduce((a, b) => a + b, 0), cond.operator, target);
  }
  return nums.some((n) => compareNumber(n, cond.operator, target));
}

async function alreadyFired(rule: RuleRow, userId: string, window: { start: Date; end: Date | null }): Promise<boolean> {
  const params: unknown[] = [rule.id, userId];
  let where = `rule_id = $1 AND user_id = $2`;
  if (rule.outcome_frequency === 'every_cycle') {
    params.push(window.start.toISOString());
    where += ` AND created_at >= $${params.length}`;
    if (window.end) { params.push(window.end.toISOString()); where += ` AND created_at <= $${params.length}`; }
  }
  const { rows } = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM customer_value_rule_firings WHERE ${where}`, params);
  return (rows[0]?.n ?? 0) > 0;
}

/** First active, in-scope, in-window, condition-matching rule wins (ordered by ref, same "first
 * match wins" convention as Postback Controls / Tiered Commissions). Requires a `user_id` in the
 * conversion's raw_params — without one there's no customer identity to evaluate rules against. */
export async function evaluateCustomerValueRules(ctx: CvContext): Promise<CvResult> {
  const none: CvResult = {
    payout: ctx.payout, revenue: ctx.revenue, appliedId: null, appliedName: null,
    payoutOverridden: false, revenueOverridden: false,
  };
  if (!ctx.userId) return none;

  const { rows: rules } = await query<RuleRow>(
    `SELECT id, name, status, apply_offers_mode, apply_offer_ids, apply_advertisers_mode, apply_advertiser_ids,
            apply_partners_mode, apply_partner_ids,
            start_date, end_date, goal_cycle, recurring_duration, continuous_mode, continuous_days,
            set_goal_conditions, conditions, outcome_frequency, payout_value, revenue_value
       FROM customer_value_rules WHERE network_id = $1 AND status = 'active' ORDER BY ref ASC`,
    [ctx.networkId],
  );
  if (rules.length === 0) return none;

  const { rows: dataPoints } = await query<DataPointRow>(
    `SELECT id, name, data_type, parameter_key FROM customer_data_points WHERE network_id = $1`, [ctx.networkId],
  );
  const dpById = new Map(dataPoints.map((d) => [d.id, d]));
  const now = new Date();

  for (const rule of rules) {
    if (!ruleMatchesScope(rule, ctx.offerId, ctx.advertiserId, ctx.publisherId)) continue;
    const window = await resolveWindow(ctx.networkId, rule, ctx.userId, now);
    if (!window) continue;

    if (rule.set_goal_conditions) {
      if (rule.conditions.length === 0) continue;
      let allMatch = true;
      for (const cond of rule.conditions) {
        const dp = dpById.get(cond.dataPointId);
        if (!dp) { allMatch = false; break; }
        const values = await collectValues(ctx.networkId, dp, ctx.userId, window, ctx.rawParams);
        if (!evaluateCondition(dp, cond, values)) { allMatch = false; break; }
      }
      if (!allMatch) continue;
    }

    if (await alreadyFired(rule, ctx.userId, window)) continue;

    const payout = rule.payout_value != null ? Number(rule.payout_value) : ctx.payout;
    const revenue = rule.revenue_value != null ? Number(rule.revenue_value) : ctx.revenue;
    return {
      payout, revenue, appliedId: rule.id, appliedName: rule.name,
      payoutOverridden: rule.payout_value != null, revenueOverridden: rule.revenue_value != null,
    };
  }
  return none;
}

/** Records that a rule's outcome fired for this user/conversion — call only after the conversion
 * row has actually been committed, inside the same transaction, mirroring the ledger write. */
export async function recordCustomerValueFiring(
  client: { query: (sql: string, params: unknown[]) => Promise<unknown> },
  args: { networkId: string; ruleId: string; userId: string; conversionId: string },
): Promise<void> {
  await client.query(
    `INSERT INTO customer_value_rule_firings (network_id, rule_id, user_id, conversion_id) VALUES ($1,$2,$3,$4)`,
    [args.networkId, args.ruleId, args.userId, args.conversionId],
  );
}
