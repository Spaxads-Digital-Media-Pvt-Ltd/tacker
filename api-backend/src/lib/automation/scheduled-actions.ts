/**
 * Scheduled actions (Automation › Scheduled Actions and the offer's Scheduled Actions tab) — audit
 * F-17a. A worker runs every minute and applies each pending action whose time has come, one per
 * transaction, row-locked with SKIP LOCKED so two workers never run the same action:
 *  - no partners: activate / pause / archive the offer, or cap_change → set one of its caps
 *    (params { capType: daily_click | daily_conversion | total_conversion, capValue: n | null = none });
 *  - with partners: activate → those partners are approved on the offer; pause → they're blocked on
 *    it (offer_publisher_access 'deny' — /click diverts them). archive / cap_change are offer-wide only.
 * The action is marked executed — or failed, with the reason — and keeps its result; the change is
 * audited as a system action (the audit log shows "Scheduled Action"); the offer's /click config is
 * invalidated; `scheduled_action.executed` goes to the network's webhooks. Actions are time-triggered
 * only: `event` is informational, and an action without a scheduled time never runs by itself.
 */
import { pool, query } from '../db/pool.js';
import { writeSystemAudit } from '../audit.js';
import { invalidateOfferConfig } from '../../surfaces/tracking/offer-cache.js';
import { emitAutomationEvent } from './webhooks.js';
import { logger } from '../logger.js';

export const CAP_COLUMNS = {
  daily_click: 'daily_click_cap',
  daily_conversion: 'daily_conversion_cap',
  total_conversion: 'total_conversion_cap',
} as const;
export type CapType = keyof typeof CAP_COLUMNS;

export interface ScheduledActionParams { capType?: CapType | null; capValue?: number | null }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePartnerIds(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    try { const a = JSON.parse(v) as unknown; return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
  }
  return [];
}

/** What would stop this action from running, or null. The routes answer 422 with it. */
export function scheduledActionProblem(a: { actionType: string; partnerIds: string[]; params: ScheduledActionParams }): string | null {
  if ((a.actionType === 'archive' || a.actionType === 'cap_change') && a.partnerIds.length) {
    return `${a.actionType} applies to the whole offer — leave Partners empty.`;
  }
  if (a.actionType === 'cap_change') {
    if (!a.params.capType || !(a.params.capType in CAP_COLUMNS)) {
      return 'cap_change needs capType: daily_click, daily_conversion or total_conversion.';
    }
    const v = a.params.capValue;
    if (v === undefined || (v !== null && !(Number.isInteger(v) && v >= 0))) {
      return 'cap_change needs capValue: a whole number ≥ 0, or null to remove the cap.';
    }
  }
  return null;
}

/** Partner ids that aren't partners of this network (the routes answer 422 with them). */
export async function unknownPartners(networkId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const valid = ids.filter((id) => UUID_RE.test(id));
  const { rows } = await query<{ id: string }>(
    'SELECT id FROM publishers WHERE network_id = $1 AND id = ANY($2::uuid[])', [networkId, valid]);
  const found = new Set(rows.map((r) => r.id));
  return ids.filter((id) => !found.has(id));
}

/** The cap fields of a create/update body → the stored params (an update keeps what it doesn't set). */
export function scheduledActionParams(
  b: { capType?: CapType | null; capValue?: number | null }, base: ScheduledActionParams = {},
): ScheduledActionParams {
  return {
    ...base,
    ...(b.capType !== undefined ? { capType: b.capType } : {}),
    ...(b.capValue !== undefined ? { capValue: b.capValue } : {}),
  };
}

/** Why a pending action could not run (422 for the routes), or null. Partners must be the network's own. */
export async function validateScheduledAction(
  networkId: string, a: { actionType: string; partnerIds: string[]; params: ScheduledActionParams },
): Promise<string | null> {
  const problem = scheduledActionProblem(a);
  if (problem) return problem;
  const unknown = await unknownPartners(networkId, a.partnerIds);
  return unknown.length ? `Unknown partner id(s): ${unknown.join(', ')}` : null;
}

/** The execution fields every scheduled-action DTO carries (F-17a). */
export const scheduledActionDtoExtras = (r: { params?: ScheduledActionParams | null; executed_at?: string | null; result?: unknown }) => ({
  capType: r.params?.capType ?? null,
  capValue: r.params?.capValue ?? null,
  executedAt: r.executed_at ?? null,
  result: r.result ?? null,
});

interface ActionRow {
  id: string; network_id: string; offer_id: string; action_type: string;
  partner_ids: unknown; params: ScheduledActionParams | null;
}
interface OfferRow {
  id: string; status: string;
  daily_click_cap: number | null; daily_conversion_cap: number | null; total_conversion_cap: number | null;
}
type Db = Pick<import('pg').PoolClient, 'query'>;

class ActionError extends Error {}

const STATUS_FOR: Record<string, string> = { activate: 'active', pause: 'paused', archive: 'archived' };

async function apply(db: Db, a: ActionRow): Promise<Record<string, unknown>> {
  const offer = (await db.query<OfferRow>(
    `SELECT id, status, daily_click_cap, daily_conversion_cap, total_conversion_cap
       FROM offers WHERE network_id = $1 AND id = $2 FOR UPDATE`, [a.network_id, a.offer_id])).rows[0];
  if (!offer) throw new ActionError('The offer no longer exists.');
  const partnerIds = parsePartnerIds(a.partner_ids);
  const params = a.params ?? {};
  const problem = scheduledActionProblem({ actionType: a.action_type, partnerIds, params });
  if (problem) throw new ActionError(problem);

  if (partnerIds.length) {
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM publishers WHERE network_id = $1 AND id = ANY($2::uuid[])',
      [a.network_id, partnerIds.filter((id) => UUID_RE.test(id))]);
    const partners = rows.map((r) => r.id);
    if (!partners.length) throw new ActionError("None of the action's partners exist any more.");
    const access = a.action_type === 'activate' ? 'allow' : 'deny';
    await db.query(
      `INSERT INTO offer_publisher_access (network_id, offer_id, publisher_id, access, approval_status)
       SELECT $1, $2, p, $4, 'approved' FROM unnest($3::uuid[]) AS p
       ON CONFLICT (offer_id, publisher_id) DO UPDATE SET access = EXCLUDED.access
         ${access === 'allow' ? ", approval_status = 'approved'" : ''}`,
      [a.network_id, offer.id, partners, access]);
    const skipped = partnerIds.filter((id) => !partners.includes(id));
    await writeSystemAudit(a.network_id, {
      action: access === 'allow' ? 'offer.partners.approve' : 'offer.partners.block',
      entityType: 'offer', entityId: offer.id, after: { partners, access },
    }, db);
    return { scope: 'partners', access, partners, ...(skipped.length ? { skippedPartners: skipped } : {}) };
  }

  if (a.action_type === 'cap_change') {
    const col = CAP_COLUMNS[params.capType!];
    const from = offer[col];
    const to = params.capValue ?? null;
    if (from === to) return { scope: 'offer', changed: false, capType: params.capType, value: to };
    await db.query(`UPDATE offers SET ${col} = $3 WHERE network_id = $1 AND id = $2`, [a.network_id, offer.id, to]);
    await writeSystemAudit(a.network_id, {
      action: 'offer.update', entityType: 'offer', entityId: offer.id, before: { [col]: from }, after: { [col]: to },
    }, db);
    return { scope: 'offer', changed: true, capType: params.capType, from, to };
  }

  const to = STATUS_FOR[a.action_type];
  if (!to) throw new ActionError(`Unknown action type ${a.action_type}.`);
  if (a.action_type === 'pause' && offer.status !== 'active') {
    return { scope: 'offer', changed: false, status: offer.status, note: `The offer was ${offer.status}, not active.` };
  }
  if (offer.status === to) return { scope: 'offer', changed: false, status: to };
  await db.query('UPDATE offers SET status = $3 WHERE network_id = $1 AND id = $2', [a.network_id, offer.id, to]);
  await writeSystemAudit(a.network_id, {
    action: 'offer.update', entityType: 'offer', entityId: offer.id, before: { status: offer.status }, after: { status: to },
  }, db);
  return { scope: 'offer', changed: true, from: offer.status, to };
}

interface Ran { id: string; networkId: string; offerId: string; actionType: string; status: 'executed' | 'failed'; result: Record<string, unknown> }

/** Run the earliest due action, if any. */
async function runOne(now: Date): Promise<Ran | null> {
  const client = await pool.connect();
  let ran: Ran;
  try {
    await client.query('BEGIN');
    const a = (await client.query<ActionRow>(
      `SELECT id, network_id, offer_id, action_type, partner_ids, params
         FROM offer_scheduled_actions
        WHERE status = 'pending' AND scheduled_time IS NOT NULL AND scheduled_time <= $1
        ORDER BY scheduled_time, created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED`, [now])).rows[0];
    if (!a) {
      await client.query('COMMIT');
      return null;
    }
    // Whatever goes wrong applying it (a rule above, or a DB error), the action is marked failed with
    // the reason instead of being retried forever — it would otherwise block every action after it.
    let status: Ran['status'] = 'executed';
    let result: Record<string, unknown>;
    await client.query('SAVEPOINT apply');
    try {
      result = await apply(client, a);
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT apply');
      status = 'failed';
      result = { error: err instanceof ActionError ? err.message : `Could not apply: ${(err as Error).message}` };
      if (!(err instanceof ActionError)) logger.warn({ err, actionId: a.id }, 'scheduled action failed');
    }
    await client.query(
      `UPDATE offer_scheduled_actions SET status = $3, executed_at = now(), result = $4 WHERE network_id = $1 AND id = $2`,
      [a.network_id, a.id, status, JSON.stringify(result)]);
    await writeSystemAudit(a.network_id, {
      action: 'offer.scheduled_action.execute', entityType: 'offer_scheduled_actions', entityId: a.id,
      after: { status, actionType: a.action_type, offerId: a.offer_id, result },
    }, client);
    await client.query('COMMIT');
    ran = { id: a.id, networkId: a.network_id, offerId: a.offer_id, actionType: a.action_type, status, result };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  if (ran.status === 'executed') await invalidateOfferConfig(ran.networkId, ran.offerId);
  await emitAutomationEvent(ran.networkId, 'scheduled_action.executed', {
    id: ran.id, offerId: ran.offerId, actionType: ran.actionType, status: ran.status, result: ran.result,
  });
  return ran;
}

/** Apply every action due at `now` (at most `limit` per run). */
export async function runDueScheduledActions(now: Date = new Date(), limit = 200): Promise<{ executed: number; failed: number }> {
  let executed = 0;
  let failed = 0;
  for (let i = 0; i < limit; i++) {
    const ran = await runOne(now);
    if (!ran) break;
    if (ran.status === 'executed') executed++;
    else failed++;
  }
  return { executed, failed };
}
