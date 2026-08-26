/**
 * Shared rule-evaluation engine for Advertiser Postback Controls — used both by the CRUD routes
 * (to preview/validate) and by recordConversion() (to actually gate real conversions). Variables
 * are limited to fields genuinely available at conversion-record time (see conversions/record.ts);
 * nothing here is fabricated.
 */
import { query } from '../db/pool.js';

export const RULE_VARIABLES = ['event', 'payout', 'revenue', 'source', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5'] as const;
export type RuleVariable = typeof RULE_VARIABLES[number];
export const RULE_OPERATORS = ['equals', 'not_equals', 'contains', 'is_empty', 'greater_than', 'less_than'] as const;
export type RuleOperator = typeof RULE_OPERATORS[number];

export interface Rule { variable: RuleVariable; operator: RuleOperator; value: string }

export interface ConversionContext {
  offerId: string;
  advertiserId: string | null;
  publisherId: string | null;
  event: string | null;
  payout: string | null;
  revenue: string | null;
  source: string;
  sub1: string | null; sub2: string | null; sub3: string | null; sub4: string | null; sub5: string | null;
}

interface ControlRow {
  id: string; name: string; control_type: 'accept' | 'reject' | 'hold';
  target_type: 'offer' | 'advertiser' | null; target_ids: string[]; partner_ids: string[];
  condition_logic: 'all' | 'any'; rules: Rule[];
}

function valueOf(ctx: ConversionContext, variable: RuleVariable): string | null {
  switch (variable) {
    case 'event': return ctx.event;
    case 'payout': return ctx.payout;
    case 'revenue': return ctx.revenue;
    case 'source': return ctx.source;
    case 'sub1': return ctx.sub1;
    case 'sub2': return ctx.sub2;
    case 'sub3': return ctx.sub3;
    case 'sub4': return ctx.sub4;
    case 'sub5': return ctx.sub5;
    default: return null;
  }
}

export function evaluateRule(rule: Rule, ctx: ConversionContext): boolean {
  const actual = valueOf(ctx, rule.variable);
  switch (rule.operator) {
    case 'is_empty': return actual == null || actual === '';
    case 'equals': return (actual ?? '').toLowerCase() === rule.value.toLowerCase();
    case 'not_equals': return (actual ?? '').toLowerCase() !== rule.value.toLowerCase();
    case 'contains': return (actual ?? '').toLowerCase().includes(rule.value.toLowerCase());
    case 'greater_than': return Number(actual ?? NaN) > Number(rule.value);
    case 'less_than': return Number(actual ?? NaN) < Number(rule.value);
    default: return false;
  }
}

export function evaluateControl(control: Pick<ControlRow, 'condition_logic' | 'rules'>, ctx: ConversionContext): boolean {
  if (control.rules.length === 0) return true;
  return control.condition_logic === 'any'
    ? control.rules.some((r) => evaluateRule(r, ctx))
    : control.rules.every((r) => evaluateRule(r, ctx));
}

/** First active, in-effect, matching-target control wins. Returns null when nothing applies —
 * caller keeps whatever status it already had. */
export async function findMatchingControl(networkId: string, ctx: ConversionContext): Promise<{ id: string; name: string; controlType: 'accept' | 'reject' | 'hold' } | null> {
  const { rows } = await query<ControlRow>(
    `SELECT id, name, control_type, target_type, target_ids, partner_ids, condition_logic, rules
       FROM advertiser_postback_controls
      WHERE network_id = $1 AND status = 'active'
        AND (effective_start IS NULL OR effective_start <= now())
        AND (effective_end IS NULL OR effective_end >= now())
      ORDER BY ref ASC`,
    [networkId],
  );
  for (const row of rows) {
    if (row.target_type === 'offer' && !row.target_ids.includes(ctx.offerId)) continue;
    if (row.target_type === 'advertiser' && (!ctx.advertiserId || !row.target_ids.includes(ctx.advertiserId))) continue;
    if (row.partner_ids.length > 0 && (!ctx.publisherId || !row.partner_ids.includes(ctx.publisherId))) continue;
    if (!evaluateControl(row, ctx)) continue;
    return { id: row.id, name: row.name, controlType: row.control_type };
  }
  return null;
}
