/**
 * Automation › Alerts — user-defined alert rules (audit F-17a). A worker evaluates every active rule
 * every few minutes against the reporting provider (the same aggregation the reports use) and, when a
 * rule's conditions START to hold, raises an alert (In App → the Alerts inbox, lib/fraud/alerts.ts)
 * and/or emails it (Email → the network's active admins and managers, via lib/alerts/deliver.ts — the
 * delivery the fraud scan uses). Edge-triggered: a rule that keeps holding doesn't alert again until it
 * has stopped holding (rule.state.firing tracks what is currently firing). A raised alert also goes
 * to the network's webhooks as `alert.raised`.
 *
 * DECISION: `conditions` (free text in the UI) is a small, strict grammar, validated when a rule is
 * saved — CONDITIONS_HELP. A stored rule that doesn't parse is skipped and its last_error says why.
 * Per-entity rules see the entities that had activity in the window (no traffic → no row → no alert).
 */
import { query } from '../db/pool.js';
import { getReportingProvider } from '../reporting/index.js';
import type { Dimension, Metric, ReportRow } from '../reporting/types.js';
import { raiseAlert, type AlertInput } from '../fraud/alerts.js';
import { deliverAlert } from '../alerts/deliver.js';
import { emitAutomationEvent } from './webhooks.js';
import { logger } from '../logger.js';

export type RuleMetric =
  | 'clicks' | 'unique_clicks' | 'conversions' | 'invalid_clicks'
  | 'cr' | 'invalid_rate' | 'payout' | 'revenue' | 'margin' | 'epc';
type Op = '>' | '>=' | '<' | '<=' | '=' | '!=';
export interface RuleClause { metric: RuleMetric; op: Op; value: string }
export type RuleScope = 'offer' | 'publisher' | 'advertiser';
export interface ParsedConditions { clauses: RuleClause[]; scope: RuleScope | null; windowMinutes: number }

export const CONDITIONS_HELP =
  'Conditions look like "cr > 5 AND clicks >= 100 per offer in 24h": one to five "<metric> <op> <number>" '
  + 'joined by AND — metrics clicks, unique_clicks, conversions, invalid_clicks, cr (%), invalid_rate (%), '
  + 'payout, revenue, margin, epc; ops > >= < <= = != — optionally "per offer|partner|advertiser" and '
  + '"in <n>m|h|d" (default 24h, 5m to 30d).';

const ALIASES: Record<string, RuleMetric> = {
  clicks: 'clicks', unique_clicks: 'unique_clicks', uniques: 'unique_clicks',
  conversions: 'conversions', invalid_clicks: 'invalid_clicks', fraud_clicks: 'invalid_clicks',
  cr: 'cr', conversion_rate: 'cr', invalid_rate: 'invalid_rate', fraud_rate: 'invalid_rate',
  payout: 'payout', revenue: 'revenue', margin: 'margin', profit: 'margin', epc: 'epc',
};
const PERCENT: ReadonlySet<RuleMetric> = new Set(['cr', 'invalid_rate']);
const MONEY: ReadonlySet<RuleMetric> = new Set(['payout', 'revenue', 'margin']);
const COUNT: ReadonlySet<RuleMetric> = new Set(['clicks', 'unique_clicks', 'conversions', 'invalid_clicks']);
const UNIT_MIN: Record<string, number> = { m: 1, h: 60, d: 1440 };

export function parseConditions(raw: string): ParsedConditions | { error: string } {
  let text = ` ${raw.trim()} `;
  let scope: RuleScope | null = null;
  let windowMinutes = 24 * 60;

  const per = /\s+per\s+(offer|partner|publisher|advertiser)s?(?=\s)/i.exec(text);
  if (per) {
    const s = per[1]!.toLowerCase();
    scope = s === 'partner' ? 'publisher' : (s as RuleScope);
    text = text.replace(per[0], ' ');
  }
  const win = /\s+(?:in|over|during)\s+(?:the\s+)?(?:last\s+)?(\d+)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?)(?=\s)/i.exec(text);
  if (win) {
    windowMinutes = Number(win[1]) * UNIT_MIN[win[2]!.toLowerCase()[0]!]!;
    if (windowMinutes < 5 || windowMinutes > 30 * 1440) return { error: `The window must be between 5m and 30d. ${CONDITIONS_HELP}` };
    text = text.replace(win[0], ' ');
  }

  const parts = text.trim().split(/\s+and\s+|\s*&&\s*/i).map((p) => p.trim()).filter(Boolean);
  if (!parts.length || parts.length > 5) return { error: CONDITIONS_HELP };
  const clauses: RuleClause[] = [];
  for (const part of parts) {
    const m = /^([a-z][a-z _]*?)\s*(>=|<=|!=|==|=|>|<)\s*(\d+(?:\.\d+)?)\s*(%?)$/i.exec(part);
    const metric = m ? ALIASES[m[1]!.trim().toLowerCase().replace(/\s+/g, '_')] : undefined;
    if (!m || !metric) return { error: `Can't read "${part}". ${CONDITIONS_HELP}` };
    if (m[4] && !PERCENT.has(metric)) return { error: `"%" only applies to cr and invalid_rate ("${part}").` };
    const value = m[3]!;
    if (COUNT.has(metric) && value.includes('.')) return { error: `${metric} is a count — use a whole number ("${part}").` };
    if (MONEY.has(metric) && /\.\d{5,}$/.test(value)) return { error: `${metric} takes at most 4 decimals ("${part}").` };
    clauses.push({ metric, op: (m[2] === '==' ? '=' : m[2]) as Op, value });
  }
  return { clauses, scope, windowMinutes };
}

/** A decimal string as exact 1/10000 units (no 10-digit cap: report sums can be larger than one amount). */
function units(v: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(v.trim());
  if (!m) throw new Error(`not a decimal: ${v}`);
  const u = BigInt(m[2]!) * 10000n + BigInt(((m[3] ?? '') + '0000').slice(0, 4));
  return m[1] ? -u : u;
}

function holds(cmp: number, op: Op): boolean {
  switch (op) {
    case '>': return cmp > 0;
    case '>=': return cmp >= 0;
    case '<': return cmp < 0;
    case '<=': return cmp <= 0;
    case '=': return cmp === 0;
    default: return cmp !== 0;
  }
}

/** The metric values one report row gives a rule (cr / invalid_rate as percentages). */
export function ruleValues(m: Record<string, unknown>): Record<RuleMetric, string | number> {
  const clicks = Number(m['clicks'] ?? 0);
  const conversions = Number(m['conversions'] ?? 0);
  const invalid = Number(m['invalid_clicks'] ?? 0);
  return {
    clicks, unique_clicks: Number(m['unique_clicks'] ?? 0), conversions, invalid_clicks: invalid,
    cr: clicks > 0 ? (conversions / clicks) * 100 : 0,
    invalid_rate: clicks > 0 ? (invalid / clicks) * 100 : 0,
    payout: String(m['payout'] ?? '0'), revenue: String(m['revenue'] ?? '0'), margin: String(m['margin'] ?? '0'),
    epc: Number(m['epc'] ?? 0),
  };
}

export function clausesHold(clauses: RuleClause[], v: Record<RuleMetric, string | number>): boolean {
  return clauses.every((c) => {
    const actual = v[c.metric];
    // Money compares exactly as decimals; counts and ratios as numbers.
    const cmp = MONEY.has(c.metric)
      ? Math.sign(Number(units(String(actual)) - units(c.value)))
      : Math.sign(Number(actual) - Number(c.value));
    return holds(cmp, c.op);
  });
}

/** "cr 0.21% (< 0.5%)" — a clause with the value it was evaluated on. */
export const describeClause = (c: RuleClause, v: Record<RuleMetric, string | number>) => {
  const a = v[c.metric];
  const shown = PERCENT.has(c.metric) ? `${Number(a).toFixed(2)}%` : String(a);
  return `${c.metric} ${shown} (${c.op} ${c.value}${PERCENT.has(c.metric) ? '%' : ''})`;
};
export const windowLabel = (min: number) => (min % 1440 === 0 ? `${min / 1440}d` : min % 60 === 0 ? `${min / 60}h` : `${min}m`);

interface RuleRow {
  id: string; network_id: string; ref: string; name: string; conditions: string;
  notify_in_app: boolean; notify_email: boolean; state: { firing?: Record<string, string> } | null;
}

const NAME_SQL: Record<RuleScope, string> = {
  offer: 'SELECT id::text, name FROM offers WHERE network_id = $1 AND id = ANY($2::uuid[])',
  publisher: 'SELECT id::text, name FROM publishers WHERE network_id = $1 AND id = ANY($2::uuid[])',
  advertiser: 'SELECT id::text, name FROM advertisers WHERE network_id = $1 AND id = ANY($2::uuid[])',
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Entity names by id (ids that aren't UUIDs or don't exist are left out). */
export async function entityNames(networkId: string, scope: RuleScope, ids: string[]): Promise<Map<string, string>> {
  const valid = ids.filter((id) => UUID_RE.test(id));
  if (!valid.length) return new Map();
  const { rows } = await query<{ id: string; name: string }>(NAME_SQL[scope], [networkId, valid]);
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Where automation emails go: the network's active admins and managers. */
export async function adminEmails(networkId: string): Promise<string[]> {
  const { rows } = await query<{ email: string }>(
    `SELECT email FROM users WHERE network_id = $1 AND status = 'active' AND role IN ('admin', 'manager') ORDER BY email`,
    [networkId]);
  return rows.map((r) => r.email);
}

const METRICS: Metric[] = ['clicks', 'unique_clicks', 'conversions', 'invalid_clicks', 'payout', 'revenue', 'margin', 'epc'];

/** Evaluate one rule at `now`; returns how many entities started firing. */
async function evaluateRule(rule: RuleRow, now: Date): Promise<number> {
  const parsed = parseConditions(rule.conditions);
  if ('error' in parsed) {
    await query(`UPDATE automation_alert_rules SET last_evaluated_at = $3, last_error = $4 WHERE network_id = $1 AND id = $2`,
      [rule.network_id, rule.id, now, `Conditions can't be evaluated: ${parsed.error}`]);
    return 0;
  }
  const groupBy: Dimension[] = parsed.scope ? [parsed.scope] : [];
  const report = await getReportingProvider().runReport({
    networkId: rule.network_id, groupBy, metrics: METRICS,
    // Traffic that reached the offer: rejected clicks (cap exceeded, geo, …) are left out, as before
    // they were recorded (lib/click-rejections) — a capped partner mustn't read as a bad converter.
    filters: { from: new Date(now.getTime() - parsed.windowMinutes * 60_000).toISOString(), to: now.toISOString(), excludeRejected: true },
    limit: 1000, offset: 0,
  });

  const wasFiring = rule.state?.firing ?? {};
  const firing: Record<string, string> = {};
  const started: { key: string; row: ReportRow; values: Record<RuleMetric, string | number> }[] = [];
  for (const row of report.rows) {
    const key = parsed.scope ? row.dimensions[parsed.scope] : '*';
    if (!key) continue;
    const values = ruleValues(row.metrics);
    if (!clausesHold(parsed.clauses, values)) continue;
    firing[key] = wasFiring[key] ?? now.toISOString();
    if (!wasFiring[key]) started.push({ key, row, values });
  }

  if (started.length) {
    const nameOf = parsed.scope ? await entityNames(rule.network_id, parsed.scope, started.map((s) => s.key)) : new Map<string, string>();
    const emails = rule.notify_email ? await adminEmails(rule.network_id) : [];
    const label = { offer: 'Offer', publisher: 'Partner', advertiser: 'Advertiser' } as const;
    for (const s of started) {
      const who = parsed.scope ? `${label[parsed.scope]} ${nameOf.get(s.key) ?? s.key} — ` : '';
      const alert: AlertInput = {
        type: 'automation_rule', severity: 'medium',
        entityType: 'automation_alert_rule', entityId: parsed.scope ? `${rule.id}:${s.key}` : rule.id,
        title: rule.name,
        description: `${who}${parsed.clauses.map((c) => describeClause(c, s.values)).join(', ')} in the last ${windowLabel(parsed.windowMinutes)}.`,
        metadata: {
          ruleId: rule.id, ruleRef: Number(rule.ref), conditions: rule.conditions,
          ...(parsed.scope ? { scope: parsed.scope, entityId: s.key, entityName: nameOf.get(s.key) ?? null } : {}),
          windowMinutes: parsed.windowMinutes, values: s.values,
        },
      };
      const id = rule.notify_in_app ? await raiseAlert(rule.network_id, alert) : null;
      if (emails.length) await deliverAlert(rule.network_id, { ...alert, id, severity: 'medium' }, { emails, webhookUrl: null }, 'alert_threshold_triggered');
      if (id) {
        await emitAutomationEvent(rule.network_id, 'alert.raised', {
          id, type: alert.type, severity: alert.severity, title: alert.title, description: alert.description,
          entityType: alert.entityType, entityId: alert.entityId, metadata: alert.metadata,
        });
      }
    }
  }

  await query(
    `UPDATE automation_alert_rules
        SET state = $3, last_evaluated_at = $4, last_error = NULL,
            last_fired_at = CASE WHEN $5 THEN $4 ELSE last_fired_at END
      WHERE network_id = $1 AND id = $2`,
    [rule.network_id, rule.id, JSON.stringify({ firing }), now, started.length > 0]);
  return started.length;
}

/** Evaluate every active rule of every active network. */
export async function evaluateAlertRules(now: Date = new Date(), networkId?: string): Promise<{ rules: number; fired: number; errors: number }> {
  const { rows } = await query<RuleRow>(
    `SELECT r.id, r.network_id, r.ref, r.name, r.conditions, r.notify_in_app, r.notify_email, r.state
       FROM automation_alert_rules r JOIN networks n ON n.id = r.network_id AND n.status = 'active'
      WHERE r.status = 'active' ${networkId ? 'AND r.network_id = $1' : ''}
      ORDER BY r.network_id, r.created_at`,
    networkId ? [networkId] : []);
  let fired = 0;
  let errors = 0;
  for (const rule of rows) {
    try {
      fired += await evaluateRule(rule, now);
    } catch (err) {
      errors++;
      logger.warn({ err, ruleId: rule.id }, 'alert rule evaluation failed');
      await query(`UPDATE automation_alert_rules SET last_evaluated_at = $3, last_error = $4 WHERE network_id = $1 AND id = $2`,
        [rule.network_id, rule.id, now, `Evaluation failed: ${(err as Error).message}`]).catch(() => undefined);
    }
  }
  return { rules: rows.length, fired, errors };
}
