/**
 * SmartSwitch (D8) — rules that watch each partner's traffic on each offer and act on it, run by the
 * automation worker every few minutes (surfaces/workers/processors/smartswitch.ts).
 *
 * A rule has conditions in the Automation grammar (parseConditions, lib/automation/alert-rules.ts —
 * e.g. "cr < 0.5 AND clicks >= 200 in 24h"), always evaluated per offer × partner over its window,
 * read through the reporting provider like every report; a scope (offers, advertisers' offers,
 * partners — empty = all); an action; and an optional delay (the conditions must keep holding that
 * long before the action runs). Actions:
 *   notify   — an alert only
 *   block    — the partner is blocked on the offer (offer_publisher_access deny), so /click diverts them
 *   redirect — their traffic on the offer goes to the rule's URL (an Offer Custom Setting › Landing Page)
 *   payout   — their payout on the offer becomes the rule's amount (offer_publisher_access.payout_override)
 * Every firing raises an alert (Alerts inbox + email to active admins / managers + the `alert.raised`
 * webhook), is audited, and is written to the rule's log (smartswitch_history, kind 'action').
 * A pair acts once per holding period (state.acted); a block / redirect / payout stays until someone
 * changes it. Safety: an action other than notify needs a minimum-volume clause (clicks >= n), and one
 * run acts on at most MAX_ACTIONS pairs per rule — the rest wait for the next run (noted on the rule).
 */
import { pool, query } from '../db/pool.js';
import { getReportingProvider } from '../reporting/index.js';
import type { Metric, ReportFilters } from '../reporting/types.js';
import {
  parseConditions, clausesHold, ruleValues, describeClause, windowLabel, entityNames, adminEmails,
  type ParsedConditions, type RuleMetric,
} from './alert-rules.js';
import { raiseAlert, type AlertInput } from '../fraud/alerts.js';
import { deliverAlert } from '../alerts/deliver.js';
import { emitAutomationEvent } from './webhooks.js';
import { writeSystemAudit } from '../audit.js';
import { roundMoney } from '../money.js';
import { invalidateOfferConfig } from '../../surfaces/tracking/offer-cache.js';
import { logger } from '../logger.js';

export const SMARTSWITCH_ACTIONS = ['notify', 'block', 'redirect', 'payout'] as const;
export type SmartSwitchAction = (typeof SMARTSWITCH_ACTIONS)[number];
export interface SmartSwitchParams { redirectUrl?: string | null; payout?: string | null }

/** At most this many partner / offer pairs acted on per rule per run. */
export const MAX_ACTIONS = 25;
const MAX_DELAY_MIN = 30 * 1440;
const METRICS: Metric[] = ['clicks', 'unique_clicks', 'conversions', 'invalid_clicks', 'payout', 'revenue', 'margin', 'epc'];

/** An Action Delay ("30 minutes", "2 hours", "1 days", "45m", "15") in minutes; empty → 0; unreadable / over 30 days → null. */
export function parseDelay(s: string | null | undefined): number | null {
  if (s == null || !s.trim()) return 0;
  const m = /^(\d+(?:\.\d+)?)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?)?$/i.exec(s.trim());
  if (!m) return null;
  const unit = (m[2] ?? 'm').toLowerCase()[0];
  const minutes = Math.round(Number(m[1]) * (unit === 'd' ? 1440 : unit === 'h' ? 60 : 1));
  return minutes <= MAX_DELAY_MIN ? minutes : null;
}

/** Why a rule can't run (checked on save and before every run), or null. */
export function smartSwitchProblem(r: { conditions: string | null | undefined; action: string; actionDelay: string | null | undefined; params: SmartSwitchParams }): string | null {
  if (!r.conditions?.trim()) return 'Add conditions — e.g. "cr < 0.5 AND clicks >= 200 in 24h".';
  const parsed = parseConditions(r.conditions);
  if ('error' in parsed) return parsed.error;
  if (parsed.scope) return 'SmartSwitch rules always look at each partner on each offer — leave out "per …".';
  if (r.action !== 'notify' && !parsed.clauses.some((c) => c.metric === 'clicks' && (c.op === '>=' || c.op === '>') && Number(c.value) >= 1)) {
    return 'Add a minimum volume — e.g. "AND clicks >= 100" — so a partner isn\'t blocked, redirected or repriced on a handful of clicks.';
  }
  if (parseDelay(r.actionDelay) == null) return 'Action Delay must be like "30 minutes", "2 hours" or "1 days" (up to 30 days).';
  if (r.action === 'redirect' && !/^https?:\/\/\S+$/i.test(r.params.redirectUrl ?? '')) return 'A redirect rule needs the http(s) URL to send the traffic to.';
  if (r.action === 'payout') {
    try { if (r.params.payout == null || roundMoney(r.params.payout).startsWith('-')) return 'A payout rule needs the new payout (0 or more, e.g. 1.50).'; }
    catch { return 'A payout rule needs the new payout as a decimal amount (e.g. 1.50).'; }
  }
  if (!(SMARTSWITCH_ACTIONS as readonly string[]).includes(r.action)) return `Unknown action ${r.action}.`;
  return null;
}

interface RuleRow {
  id: string; network_id: string; name: string; action: SmartSwitchAction; action_delay: string | null; conditions: string | null;
  action_params: SmartSwitchParams | null; offer_ids: string[] | null; advertiser_ids: string[] | null; partner_ids: string[] | null;
  state: { holding?: Record<string, string>; acted?: Record<string, string> } | null;
}
interface Due { key: string; offerId: string; publisherId: string; values: Record<RuleMetric, string | number> }
type Db = Pick<import('pg').PoolClient, 'query'>;

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Apply the rule's action to one pair inside a transaction; returns what happened. */
async function applyAction(db: Db, rule: RuleRow, d: Due): Promise<{ outcome: string; changed: boolean; details: Record<string, unknown> }> {
  const net = rule.network_id;
  const params = rule.action_params ?? {};
  if (rule.action === 'notify') return { outcome: 'notified', changed: false, details: {} };

  if (rule.action === 'block' || rule.action === 'payout') {
    const cur = (await db.query<{ access: string; payout_override: string | null }>(
      `SELECT access, payout_override::text FROM offer_publisher_access WHERE network_id = $1 AND offer_id = $2 AND publisher_id = $3 FOR UPDATE`,
      [net, d.offerId, d.publisherId])).rows[0];
    if (rule.action === 'block') {
      if (cur?.access === 'deny') return { outcome: 'was already blocked', changed: false, details: {} };
      await db.query(
        `INSERT INTO offer_publisher_access (network_id, offer_id, publisher_id, access, approval_status) VALUES ($1, $2, $3, 'deny', 'approved')
         ON CONFLICT (offer_id, publisher_id) DO UPDATE SET access = 'deny'`, [net, d.offerId, d.publisherId]);
      await writeSystemAudit(net, {
        action: 'offer.partners.block', entityType: 'offer', entityId: d.offerId,
        before: { access: cur?.access ?? null }, after: { partners: [d.publisherId], access: 'deny', smartSwitchRuleId: rule.id },
      }, db);
      return { outcome: 'blocked', changed: true, details: { accessBefore: cur?.access ?? null } };
    }
    const amount = roundMoney(params.payout!);
    if (cur?.access === 'deny') return { outcome: 'is blocked on the offer — payout not changed', changed: false, details: {} };
    if (cur?.payout_override != null && roundMoney(cur.payout_override) === amount) return { outcome: `payout was already ${amount}`, changed: false, details: {} };
    await db.query(
      `INSERT INTO offer_publisher_access (network_id, offer_id, publisher_id, access, approval_status, payout_override) VALUES ($1, $2, $3, 'allow', 'approved', $4)
       ON CONFLICT (offer_id, publisher_id) DO UPDATE SET payout_override = EXCLUDED.payout_override`, [net, d.offerId, d.publisherId, amount]);
    await writeSystemAudit(net, {
      action: 'offer.partner.payout', entityType: 'offer', entityId: d.offerId,
      before: { publisherId: d.publisherId, payoutOverride: cur?.payout_override ?? null },
      after: { publisherId: d.publisherId, payoutOverride: amount, smartSwitchRuleId: rule.id },
    }, db);
    return { outcome: `payout set to ${amount}`, changed: true, details: { payoutBefore: cur?.payout_override ?? null, payout: amount } };
  }

  // redirect: an active Landing Page custom setting for this partner on this offer.
  const url = params.redirectUrl!;
  const existing = (await db.query<{ id: string }>(
    `SELECT id FROM offer_custom_settings WHERE network_id = $1 AND offer_id = $2 AND category = 'landing_pages'
        AND partner_id = $3 AND status = 'active' AND landing_page_url = $4 LIMIT 1`, [net, d.offerId, d.publisherId, url])).rows[0];
  if (existing) return { outcome: 'was already redirected there', changed: false, details: { settingId: existing.id } };
  const setting = (await db.query<{ id: string }>(
    `INSERT INTO offer_custom_settings (network_id, category, name, offer_id, partner_id, partner_ids, apply_all_partners, landing_page_url, status, description)
     VALUES ($1, 'landing_pages', $2, $3, $4, $5, false, $6, 'active', $7) RETURNING id`,
    [net, `SmartSwitch: ${rule.name}`.slice(0, 200), d.offerId, d.publisherId, JSON.stringify([d.publisherId]), url,
      `Added by SmartSwitch rule "${rule.name}" — delete it to send this partner to the offer again.`])).rows[0]!;
  await writeSystemAudit(net, {
    action: 'offer_custom_setting.create', entityType: 'offer_custom_setting', entityId: setting.id,
    after: { category: 'landing_pages', offerId: d.offerId, partnerId: d.publisherId, landingPageUrl: url, smartSwitchRuleId: rule.id },
  }, db);
  return { outcome: `redirected to ${url}`, changed: true, details: { settingId: setting.id, redirectUrl: url } };
}

/** Act on one pair: the change + its log row in one transaction, then the alert. */
async function act(rule: RuleRow, parsed: ParsedConditions, d: Due, names: { offer: Map<string, string>; partner: Map<string, string> }): Promise<void> {
  const offerName = names.offer.get(d.offerId) ?? d.offerId;
  const partnerName = names.partner.get(d.publisherId) ?? d.publisherId;
  const why = `${parsed.clauses.map((c) => describeClause(c, d.values)).join(', ')} in the last ${windowLabel(parsed.windowMinutes)}`;
  const client = await pool.connect();
  let result: Awaited<ReturnType<typeof applyAction>>;
  try {
    await client.query('BEGIN');
    result = await applyAction(client, rule, d);
    await client.query(
      `INSERT INTO smartswitch_history (network_id, rule_id, rule_name, change, employee, kind, offer_id, publisher_id, details)
       VALUES ($1, $2, $3, $4, NULL, 'action', $5, $6, $7)`,
      [rule.network_id, rule.id, rule.name, `Partner ${partnerName} on offer ${offerName}: ${result.outcome} (${why})`.slice(0, 2000),
        d.offerId, d.publisherId, JSON.stringify({ action: rule.action, outcome: result.outcome, changed: result.changed, values: d.values, conditions: rule.conditions, ...result.details })]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  if (result.changed) await invalidateOfferConfig(rule.network_id, d.offerId);

  const alert: AlertInput = {
    type: 'smartswitch', severity: rule.action === 'notify' ? 'medium' : 'high',
    entityType: 'smartswitch_rule', entityId: `${rule.id}:${d.key}`,
    title: `SmartSwitch: ${rule.name}`,
    description: `Partner ${partnerName} on offer ${offerName}: ${result.outcome} — ${why}.`,
    metadata: { ruleId: rule.id, action: rule.action, outcome: result.outcome, offerId: d.offerId, publisherId: d.publisherId, values: d.values, conditions: rule.conditions },
  };
  const id = await raiseAlert(rule.network_id, alert);
  const emails = await adminEmails(rule.network_id);
  if (emails.length) await deliverAlert(rule.network_id, { ...alert, id, severity: alert.severity ?? 'medium' }, { emails, webhookUrl: null }, 'alert_threshold_triggered');
  if (id) {
    await emitAutomationEvent(rule.network_id, 'alert.raised', {
      id, type: alert.type, severity: alert.severity, title: alert.title, description: alert.description,
      entityType: alert.entityType, entityId: alert.entityId, metadata: alert.metadata,
    });
  }
}

/** The partner / offer pairs in scope whose conditions hold over the window ending `now`. */
async function matchingPairs(
  networkId: string, parsed: ParsedConditions, scope: { offers: string[]; advertisers: string[]; partners: string[] }, now: Date,
): Promise<Omit<Due, 'key'>[]> {
  const filters: ReportFilters = {
    from: new Date(now.getTime() - parsed.windowMinutes * 60_000).toISOString(), to: now.toISOString(),
    ...(scope.offers.length ? { offerId: scope.offers } : {}), ...(scope.advertisers.length ? { advertiserId: scope.advertisers } : {}),
    ...(scope.partners.length ? { publisherId: scope.partners } : {}),
  };
  const report = await getReportingProvider().runReport({ networkId, groupBy: ['offer', 'publisher'], metrics: METRICS, filters, limit: 5000, offset: 0 });
  const out: Omit<Due, 'key'>[] = [];
  for (const row of report.rows) {
    const offerId = row.dimensions['offer'];
    const publisherId = row.dimensions['publisher'];
    if (!offerId || !publisherId) continue;
    const values = ruleValues(row.metrics);
    if (clausesHold(parsed.clauses, values)) out.push({ offerId, publisherId, values });
  }
  return out;
}

/**
 * What a rule would act on now — the pairs whose conditions hold, with names and values — without
 * acting (the SmartSwitch page's Preview). `problem` when the rule can't run.
 */
export async function previewSmartSwitchRule(networkId: string, r: {
  conditions: string | null; action: string; actionDelay: string | null; params: SmartSwitchParams;
  offerIds: string[]; advertiserIds: string[]; partnerIds: string[];
}, now: Date = new Date()): Promise<{ problem: string } | { windowMinutes: number; total: number; pairs: { offerId: string; offerName: string | null; publisherId: string; partnerName: string | null; values: Record<RuleMetric, string | number> }[] }> {
  const problem = smartSwitchProblem({ conditions: r.conditions, action: r.action, actionDelay: r.actionDelay, params: r.params });
  if (problem) return { problem };
  const parsed = parseConditions(r.conditions!) as ParsedConditions;
  const pairs = await matchingPairs(networkId, parsed, { offers: r.offerIds, advertisers: r.advertiserIds, partners: r.partnerIds }, now);
  const shown = pairs.slice(0, 100);
  const [offerNames, partnerNames] = await Promise.all([
    entityNames(networkId, 'offer', shown.map((p) => p.offerId)), entityNames(networkId, 'publisher', shown.map((p) => p.publisherId)),
  ]);
  return {
    windowMinutes: parsed.windowMinutes, total: pairs.length,
    pairs: shown.map((p) => ({ ...p, offerName: offerNames.get(p.offerId) ?? null, partnerName: partnerNames.get(p.publisherId) ?? null })),
  };
}

/** Evaluate one rule at `now`; returns how many pairs it acted on. */
async function evaluateRule(rule: RuleRow, now: Date): Promise<number> {
  const params = rule.action_params ?? {};
  const problem = smartSwitchProblem({ conditions: rule.conditions, action: rule.action, actionDelay: rule.action_delay, params });
  if (problem) {
    await query(`UPDATE smartswitch_rules SET last_evaluated_at = $3, last_error = $4 WHERE network_id = $1 AND id = $2`,
      [rule.network_id, rule.id, now, `Can't run: ${problem}`]);
    return 0;
  }
  const parsed = parseConditions(rule.conditions!) as ParsedConditions;
  const delayMs = parseDelay(rule.action_delay)! * 60_000;
  const pairs = await matchingPairs(rule.network_id, parsed,
    { offers: ids(rule.offer_ids), advertisers: ids(rule.advertiser_ids), partners: ids(rule.partner_ids) }, now);

  const wasHolding = rule.state?.holding ?? {};
  const wasActed = rule.state?.acted ?? {};
  const holding: Record<string, string> = {};
  const acted: Record<string, string> = {};
  const due: Due[] = [];
  for (const { offerId, publisherId, values } of pairs) {
    const key = `${offerId}:${publisherId}`;
    holding[key] = wasHolding[key] ?? now.toISOString();
    if (wasActed[key]) { acted[key] = wasActed[key]!; continue; }
    if (now.getTime() - Date.parse(holding[key]!) >= delayMs) due.push({ key, offerId, publisherId, values });
  }

  const run = due.slice(0, MAX_ACTIONS);
  const names = run.length
    ? { offer: await entityNames(rule.network_id, 'offer', run.map((d) => d.offerId)), partner: await entityNames(rule.network_id, 'publisher', run.map((d) => d.publisherId)) }
    : { offer: new Map<string, string>(), partner: new Map<string, string>() };
  let done = 0;
  const failures: string[] = [];
  for (const d of run) {
    try {
      await act(rule, parsed, d, names);
      acted[d.key] = now.toISOString();
      done++;
    } catch (err) {
      failures.push(`${names.partner.get(d.publisherId) ?? d.publisherId} on ${names.offer.get(d.offerId) ?? d.offerId}: ${(err as Error).message}`);
      logger.warn({ err, ruleId: rule.id, pair: d.key }, 'smartswitch action failed');
    }
  }
  const waiting = due.length - run.length;
  const lastError = failures.length ? `Some actions failed — ${failures.slice(0, 3).join('; ')}`
    : waiting > 0 ? `${waiting} more partner / offer pair(s) wait for the next run (at most ${MAX_ACTIONS} actions per run).` : null;
  await query(
    `UPDATE smartswitch_rules
        SET state = $3, last_evaluated_at = $4, last_error = $5,
            last_fired_at = CASE WHEN $6 THEN $4 ELSE last_fired_at END
      WHERE network_id = $1 AND id = $2`,
    [rule.network_id, rule.id, JSON.stringify({ holding, acted }), now, lastError, done > 0]);
  return done;
}

/** Evaluate every active SmartSwitch rule of every active network. */
export async function evaluateSmartSwitchRules(now: Date = new Date(), networkId?: string): Promise<{ rules: number; acted: number; errors: number }> {
  const { rows } = await query<RuleRow>(
    `SELECT r.id, r.network_id, r.name, r.action, r.action_delay, r.conditions, r.action_params, r.offer_ids, r.advertiser_ids, r.partner_ids, r.state
       FROM smartswitch_rules r JOIN networks n ON n.id = r.network_id AND n.status = 'active'
      WHERE r.status = 'active' ${networkId ? 'AND r.network_id = $1' : ''}
      ORDER BY r.network_id, r.created_at`,
    networkId ? [networkId] : []);
  let acted = 0;
  let errors = 0;
  for (const rule of rows) {
    try {
      acted += await evaluateRule(rule, now);
    } catch (err) {
      errors++;
      logger.warn({ err, ruleId: rule.id }, 'smartswitch rule evaluation failed');
      await query(`UPDATE smartswitch_rules SET last_evaluated_at = $3, last_error = $4 WHERE network_id = $1 AND id = $2`,
        [rule.network_id, rule.id, now, `Evaluation failed: ${(err as Error).message}`]).catch(() => undefined);
    }
  }
  return { rules: rows.length, acted, errors };
}
