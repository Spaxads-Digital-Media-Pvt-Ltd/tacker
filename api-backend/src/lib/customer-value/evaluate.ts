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
import type { QueryResultRow } from 'pg';
import { query } from '../db/pool.js';
import { logger } from '../logger.js';
import { isSensitiveParamKey } from '../reporting/redact.js';

/**
 * How every evaluator query runs. Outside a transaction that's the shared pool (the default); inside
 * the conversion transaction recordConversion() passes its OWN client — never the pool, which would
 * need a second connection while one is held (pool exhaustion) and wouldn't run under the lock.
 */
export type CvQuery = <R extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => Promise<{ rows: R[] }>;

/** Max wait for another conversion of the same customer to finish evaluating (then the postback fails and is retried). */
export const CV_LOCK_TIMEOUT_MS = 5000;

/** The per-customer advisory-lock key — network-scoped, so two networks never wait on each other. */
export function customerValueLockKey(networkId: string, userId: string): string {
  return JSON.stringify(['cvcust', networkId, userId]);
}

/**
 * Serialize Customer Value evaluation per (network, customer) for the rest of the caller's
 * transaction: a transaction-scoped advisory lock, released at COMMIT / ROLLBACK. Waits at most
 * CV_LOCK_TIMEOUT_MS (lock_timeout set just for this lock, then restored) — a timeout throws
 * (55P03), the caller's transaction rolls back and nothing is recorded.
 */
export async function lockCustomerValue(db: CvQuery, networkId: string, userId: string): Promise<void> {
  const prev = (await db<{ v: string }>(`SELECT current_setting('lock_timeout') AS v`)).rows[0]?.v ?? '0';
  await db(`SELECT set_config('lock_timeout', $1, true)`, [`${CV_LOCK_TIMEOUT_MS}ms`]);
  try {
    await db('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [customerValueLockKey(networkId, userId)]);
  } catch (err) {
    if ((err as { code?: string }).code === '55P03') logger.warn({ networkId, timeoutMs: CV_LOCK_TIMEOUT_MS }, 'customer value: customer lock timeout — conversion not recorded, retry expected');
    throw err;
  }
  await db(`SELECT set_config('lock_timeout', $1, true)`, [prev]);
}

/**
 * Performance only: whether the network has any active rule, so conversions in networks without
 * rules skip the lock. Correctness never depends on it — a rule activated after this check simply
 * applies from the next conversion; evaluation itself always runs after the lock.
 */
export async function hasActiveCustomerValueRules(networkId: string): Promise<boolean> {
  const { rows } = await query<{ x: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM customer_value_rules WHERE network_id = $1 AND status = 'active') AS x`, [networkId]);
  return rows[0]?.x === true;
}

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
  start_date: string | Date | null; end_date: string | Date | null;
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
  /** Decimal money strings, passed through untouched — never converted to floats. */
  payout: string;
  revenue: string;
  rawParams: Record<string, unknown>;
}

export interface CvResult {
  payout: string; revenue: string; appliedId: string | null; appliedName: string | null;
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

/**
 * A rule's `start_date` / `end_date` (Postgres `date`) as `YYYY-MM-DD`, or null. node-pg parses a
 * `date` into a JS Date at LOCAL midnight of that day, so a Date is read back with local getters
 * (which recovers the stored day in any process timezone); a string keeps its first 10 characters.
 * Anything else is null. The evaluator's own query selects the columns as text, so it never sees a
 * Date — this also normalizes rows read through the CRUD routes.
 */
export function toYmd(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/**
 * Rule Duration as UTC instants: the Start Date from 00:00:00.000 UTC, the End Date through
 * 23:59:59.999 UTC (inclusive). Report days are UTC, so rule days are too.
 */
export function ruleDateBounds(startDate: unknown, endDate: unknown): { start: Date | null; end: Date | null } {
  const s = toYmd(startDate);
  const e = toYmd(endDate);
  return {
    start: s ? new Date(`${s}T00:00:00.000Z`) : null,
    end: e ? new Date(`${e}T23:59:59.999Z`) : null,
  };
}

/**
 * Start of the recurring goal window containing `now`, in UTC: daily 00:00, weekly Monday 00:00,
 * monthly day 1, quarterly 1 Jan / Apr / Jul / Oct. (Local-time getters made the window depend on
 * the server's timezone.) An unknown period is "all time".
 */
export function periodStartUtc(period: string, now: Date): Date {
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate();
  if (period === 'daily') return new Date(Date.UTC(y, m, d));
  if (period === 'weekly') {
    const day = now.getUTCDay();
    return new Date(Date.UTC(y, m, d - (day === 0 ? 6 : day - 1)));
  }
  if (period === 'monthly') return new Date(Date.UTC(y, m, 1));
  if (period === 'quarterly') return new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1));
  return new Date(0);
}

/** First approved conversion timestamp for this user within the rule's offer/partner scope. */
async function firstConversionAt(db: CvQuery, networkId: string, rule: RuleRow, userId: string): Promise<Date | null> {
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
  const { rows } = await db<{ created_at: string }>(
    `SELECT created_at FROM conversions WHERE ${where} ORDER BY created_at ASC LIMIT 1`, params,
  );
  return rows[0] ? new Date(rows[0].created_at) : null;
}

async function resolveWindow(db: CvQuery, networkId: string, rule: RuleRow, userId: string, now: Date): Promise<{ start: Date; end: Date | null } | null> {
  // Rule Duration (Start/End Date) gates the rule regardless of Goal Cycle mode — UTC days, End
  // Date inclusive. (`${end_date}T23:59:59.999Z` on the Date node-pg returns was an Invalid Date, so
  // the End Date never applied.)
  const { start: effStart, end: effEnd } = ruleDateBounds(rule.start_date, rule.end_date);
  if (effStart && now < effStart) return null;
  if (effEnd && now > effEnd) return null;

  if (rule.goal_cycle === 'continuous') {
    if (rule.continuous_mode === 'from_first_conversion') {
      const first = (await firstConversionAt(db, networkId, rule, userId)) ?? now; // no prior history — this conversion anchors the window
      const end = rule.continuous_days ? new Date(first.getTime() + rule.continuous_days * 86400000) : null;
      if (end && now > end) return null;
      return { start: first, end };
    }
    return { start: effStart ?? new Date(0), end: effEnd };
  }
  return { start: periodStartUtc(rule.recurring_duration ?? 'monthly', now), end: null };
}

/** Every value recorded for this data point for this user within the window, PLUS the current
 * (not-yet-inserted) conversion's value if present — reproduces the "Swiss cheese" accumulation
 * described in the reference's own Customer Value docs, where the conversion that completes a
 * rule's conditions is itself one of the data points. */
async function collectValues(
  db: CvQuery, networkId: string, dp: DataPointRow, userId: string, window: { start: Date; end: Date | null },
  currentRawParams: Record<string, unknown>,
): Promise<(string | number)[]> {
  const params: unknown[] = [networkId, userId, dp.parameter_key, window.start.toISOString()];
  let where = `network_id = $1 AND status = 'approved' AND raw_params->>'user_id' = $2 AND raw_params ? $3 AND created_at >= $4`;
  if (window.end) { params.push(window.end.toISOString()); where += ` AND created_at <= $${params.length}`; }
  const { rows } = await db<{ v: string }>(
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

async function alreadyFired(db: CvQuery, rule: RuleRow, userId: string, window: { start: Date; end: Date | null }): Promise<boolean> {
  const params: unknown[] = [rule.id, userId];
  let where = `rule_id = $1 AND user_id = $2`;
  if (rule.outcome_frequency === 'every_cycle') {
    params.push(window.start.toISOString());
    where += ` AND created_at >= $${params.length}`;
    if (window.end) { params.push(window.end.toISOString()); where += ` AND created_at <= $${params.length}`; }
  }
  const { rows } = await db<{ n: number }>(`SELECT COUNT(*)::int AS n FROM customer_value_rule_firings WHERE ${where}`, params);
  return (rows[0]?.n ?? 0) > 0;
}

/** First active, in-scope, in-window, condition-matching rule wins (ordered by ref, same "first
 * match wins" convention as Postback Controls / Tiered Commissions). Requires a `user_id` in the
 * conversion's raw_params — without one there's no customer identity to evaluate rules against.
 * recordConversion() calls this inside its transaction, after lockCustomerValue(), passing its own
 * client as `db` — so the "already fired?" check and the firing insert happen under one lock. */
export async function evaluateCustomerValueRules(ctx: CvContext, db: CvQuery = query): Promise<CvResult> {
  const none: CvResult = {
    payout: ctx.payout, revenue: ctx.revenue, appliedId: null, appliedName: null,
    payoutOverridden: false, revenueOverridden: false,
  };
  if (!ctx.userId) return none;

  const { rows: rules } = await db<RuleRow>(
    `SELECT id, name, status, apply_offers_mode, apply_offer_ids, apply_advertisers_mode, apply_advertiser_ids,
            apply_partners_mode, apply_partner_ids,
            start_date::text AS start_date, end_date::text AS end_date, goal_cycle, recurring_duration, continuous_mode, continuous_days,
            set_goal_conditions, conditions, outcome_frequency, payout_value, revenue_value
       FROM customer_value_rules WHERE network_id = $1 AND status = 'active' ORDER BY ref ASC`,
    [ctx.networkId],
  );
  if (rules.length === 0) return none;

  const { rows: dataPoints } = await db<DataPointRow>(
    `SELECT id, name, data_type, parameter_key FROM customer_data_points WHERE network_id = $1`, [ctx.networkId],
  );
  // A data point on a secret param (secure_code, token…) is rejected at create/update; one that
  // predates that check is treated as missing, so its condition never matches — a rule must not be
  // usable as an oracle on the advertiser's postback secret.
  const dpById = new Map(dataPoints.filter((d) => !isSensitiveParamKey(d.parameter_key)).map((d) => [d.id, d]));
  const now = new Date();

  for (const rule of rules) {
    if (!ruleMatchesScope(rule, ctx.offerId, ctx.advertiserId, ctx.publisherId)) continue;
    const window = await resolveWindow(db, ctx.networkId, rule, ctx.userId, now);
    if (!window) continue;

    if (rule.set_goal_conditions) {
      if (rule.conditions.length === 0) continue;
      let allMatch = true;
      for (const cond of rule.conditions) {
        const dp = dpById.get(cond.dataPointId);
        if (!dp) { allMatch = false; break; }
        const values = await collectValues(db, ctx.networkId, dp, ctx.userId, window, ctx.rawParams);
        if (!evaluateCondition(dp, cond, values)) { allMatch = false; break; }
      }
      if (!allMatch) continue;
    }

    if (await alreadyFired(db, rule, ctx.userId, window)) continue;

    const payout = rule.payout_value ?? ctx.payout;
    const revenue = rule.revenue_value ?? ctx.revenue;
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
