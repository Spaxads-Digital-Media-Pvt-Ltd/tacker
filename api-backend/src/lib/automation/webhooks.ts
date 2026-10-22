/**
 * Automation › Webhooks delivery (audit F-17a). Events the platform emits — a conversion recorded /
 * approved / rejected, an alert raised, a scheduled action run — go to every active webhook of the
 * network that listens to them: queued with retries + exponential backoff (like partner postbacks),
 * sent through the SSRF guard (lib/net/safe-http.ts — never plain fetch), every delivery logged in
 * automation_webhook_deliveries.
 *
 * Emitting is cheap for whatever triggered it: which events a network's webhooks listen to is cached
 * in Redis (load-through, busted by the webhook CRUD), and nothing is queued when nobody listens. A
 * webhook's `events` is a list of WEBHOOK_EVENTS (comma/space separated), or `*` for all of them.
 * POST/PUT/PATCH send `{ event, occurredAt, data }` as JSON; GET/DELETE send no body — `event` and
 * `delivery_id` go in the query string.
 */
import { randomUUID } from 'node:crypto';
import { UnrecoverableError } from 'bullmq';
import { query } from '../db/pool.js';
import { getRedis } from '../redis.js';
import { getQueue, QUEUE } from '../queues.js';
import { BlockedDestinationError, safeRequest } from '../net/safe-http.js';
import { BRAND } from '../../config/branding.js';
import { logger } from '../logger.js';

export const WEBHOOK_EVENTS = [
  'conversion.created', 'conversion.approved', 'conversion.rejected', 'alert.raised', 'scheduled_action.executed',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** A webhook's `events` text → the known event names it lists (lower-cased, de-duplicated), or ['*']. */
export function parseWebhookEvents(raw: string): { events: string[]; unknown: string[] } {
  const tokens = raw.split(/[\s,;]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (tokens.includes('*')) return { events: ['*'], unknown: [] };
  const known = (t: string) => (WEBHOOK_EVENTS as readonly string[]).includes(t);
  return { events: Array.from(new Set(tokens.filter(known))), unknown: tokens.filter((t) => !known(t)) };
}

const listensTo = (events: string[], event: string) => events.includes('*') || events.includes(event);

interface Subscription { id: string; events: string[] }
const subsKey = (networkId: string) => `autowh:${networkId}`;

async function subscriptions(networkId: string): Promise<Subscription[]> {
  const redis = getRedis();
  const cached = await redis.get(subsKey(networkId));
  if (cached) return JSON.parse(cached) as Subscription[];
  const { rows } = await query<{ id: string; events: string }>(
    `SELECT id, events FROM automation_webhooks WHERE network_id = $1 AND status = 'active'`, [networkId]);
  const subs = rows.map((r) => ({ id: r.id, events: parseWebhookEvents(r.events).events })).filter((s) => s.events.length);
  await redis.set(subsKey(networkId), JSON.stringify(subs), 'EX', 300);
  return subs;
}

export async function invalidateWebhookSubscriptions(networkId: string): Promise<void> {
  await getRedis().del(subsKey(networkId));
}

export const WEBHOOK_ATTEMPTS = 6;

export interface WebhookJob {
  deliveryId: string;
  networkId: string;
  webhookId: string;
  event: string;
  payload: { event: string; occurredAt: string; data: Record<string, unknown> };
}

/**
 * Queue each event for every webhook of the network that listens to it; returns how many deliveries
 * were queued. Never throws — a webhook problem must not fail the conversion / alert / action that
 * triggered it.
 */
export async function emitAutomationEvent(
  networkId: string, events: WebhookEvent | WebhookEvent[], data: Record<string, unknown>,
): Promise<number> {
  try {
    const subs = await subscriptions(networkId);
    if (!subs.length) return 0;
    const occurredAt = new Date().toISOString();
    let queued = 0;
    for (const event of Array.isArray(events) ? events : [events]) {
      for (const s of subs.filter((x) => listensTo(x.events, event))) {
        const job: WebhookJob = { deliveryId: randomUUID(), networkId, webhookId: s.id, event, payload: { event, occurredAt, data } };
        await getQueue(QUEUE.automationWebhook).add('webhook', job, QUEUE_OPTS);
        queued++;
      }
    }
    return queued;
  } catch (err) {
    logger.warn({ err, networkId, events }, 'automation webhook emit failed');
    return 0;
  }
}

const QUEUE_OPTS = { attempts: WEBHOOK_ATTEMPTS, backoff: { type: 'exponential' as const, delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 };

/**
 * Send a delivery again (Automation › Webhooks › Deliveries › Retry): the same payload and delivery id
 * (so a receiver that already processed it can tell), a fresh set of attempts. Only a failed or blocked
 * one — a pending delivery is still being retried, a successful one arrived. Returns false when there is
 * nothing to retry.
 */
export async function redeliverWebhook(networkId: string, webhookId: string, deliveryId: string): Promise<boolean> {
  const { rows } = await query<{ event: string; payload: WebhookJob['payload'] }>(
    `UPDATE automation_webhook_deliveries SET status = 'pending', attempts = 0, status_code = NULL, error = NULL
      WHERE network_id = $1 AND webhook_id = $2 AND id = $3 AND status IN ('failed', 'blocked')
      RETURNING event, payload`, [networkId, webhookId, deliveryId]);
  const d = rows[0];
  if (!d) return false;
  await getQueue(QUEUE.automationWebhook).add('webhook', { deliveryId, networkId, webhookId, event: d.event, payload: d.payload } satisfies WebhookJob, QUEUE_OPTS);
  return true;
}

/** A test delivery to one webhook (event `webhook.test`) — to check the URL before real events flow. */
export async function sendTestWebhook(networkId: string, webhookId: string): Promise<string> {
  const deliveryId = randomUUID();
  const job: WebhookJob = {
    deliveryId, networkId, webhookId, event: 'webhook.test',
    payload: { event: 'webhook.test', occurredAt: new Date().toISOString(), data: { test: true, message: 'A test delivery from Automation › Webhooks.' } },
  };
  await logDelivery(job, 0, 'pending', null, null);
  await getQueue(QUEUE.automationWebhook).add('webhook', job, QUEUE_OPTS);
  return deliveryId;
}

type DeliveryStatus = 'pending' | 'success' | 'failed' | 'blocked';

async function logDelivery(job: WebhookJob, attempt: number, status: DeliveryStatus, statusCode: number | null, error: string | null): Promise<void> {
  await query(
    `INSERT INTO automation_webhook_deliveries (id, network_id, webhook_id, event, payload, status, attempts, status_code, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, attempts = EXCLUDED.attempts,
       status_code = EXCLUDED.status_code, error = EXCLUDED.error`,
    [job.deliveryId, job.networkId, job.webhookId, job.event, JSON.stringify(job.payload), status, attempt, statusCode, error],
  );
}

/**
 * One delivery attempt (`attempt` is 1-based; the worker passes whether it's the last). Throws so
 * BullMQ retries a non-2xx answer or a network error; a blocked destination is final (retrying an
 * address the guard refuses can never succeed), and so is a webhook that is no longer active.
 */
export async function deliverWebhook(job: WebhookJob, attempt: number, lastAttempt: boolean): Promise<void> {
  const { rows } = await query<{ url: string; http_method: string; status: string }>(
    `SELECT url, http_method, status FROM automation_webhooks WHERE network_id = $1 AND id = $2`,
    [job.networkId, job.webhookId],
  );
  const hook = rows[0];
  if (!hook || hook.status !== 'active') {
    await logDelivery(job, attempt, 'failed', null, 'webhook is no longer active');
    return;
  }

  const method = hook.http_method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  const withBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
  let url = hook.url;
  if (!withBody) {
    try {
      const u = new URL(hook.url);
      u.searchParams.set('event', job.event);
      u.searchParams.set('delivery_id', job.deliveryId);
      url = u.toString();
    } catch {
      // Malformed URL — safeRequest refuses it below (blocked, final).
    }
  }

  try {
    const res = await safeRequest(url, {
      method,
      headers: {
        'user-agent': `${BRAND.slug}-webhooks/1.0`,
        [`x-${BRAND.slug}-event`]: job.event,
        [`x-${BRAND.slug}-delivery`]: job.deliveryId,
        ...(withBody ? { 'content-type': 'application/json' } : {}),
      },
      ...(withBody ? { body: JSON.stringify(job.payload) } : {}),
      timeoutMs: 10_000,
      deadlineMs: 15_000,
      maxBodyBytes: 1024,
    });
    if (res.status >= 200 && res.status < 300) {
      await logDelivery(job, attempt, 'success', res.status, null);
      return;
    }
    await logDelivery(job, attempt, lastAttempt ? 'failed' : 'pending', res.status, `http_${res.status}`);
    throw new Error(`webhook http ${res.status}`);
  } catch (err) {
    if (err instanceof BlockedDestinationError) {
      await logDelivery(job, attempt, 'blocked', null, err.message);
      throw new UnrecoverableError(err.message);
    }
    if ((err as Error).message?.startsWith('webhook http')) throw err; // already logged
    const reason = (err as Error).name === 'AbortError' ? 'timeout' : String((err as Error).message);
    await logDelivery(job, attempt, lastAttempt ? 'failed' : 'pending', null, reason);
    throw err;
  }
}
