/**
 * 24metrics (Clickshield) — Attribution › "24metrics Tracker", with the tracker ID 24metrics gives the
 * integration (their integration ID). It uses the endpoints of 24metrics' own JavaScript SDK
 * (github.com/24metrics/js-integration-examples): `https://<tracker id>.gateway.go2link.co/c` for clicks and
 * `/api/event-tx` for conversions. TRACKER24_GATEWAY_URL ({id} = the tracker ID) points elsewhere — a
 * stand-in server when testing.
 *
 * Every click of the offer is checked from the click-persist worker — the visitor's redirect never waits:
 *   GET <gateway>/c?no_redirect=true&offer=…&publisher=…&sub_id…&external_transaction_id=<our click id>
 *       &ip=<visitor>&ua=<visitor user agent>&referer=…   →   { data: { status: approved|rejected, reason, transaction_id } }
 * A REJECTED click is flagged '24metrics' (and '24metrics:<reason>'), its conversions are held as pending
 * ('24metrics_flagged') for review, and the address is blocked for a day: its next clicks on any of the
 * network's offers with 24metrics on are rejected at /click ('24metrics_blocked', one Redis read). An APPROVED
 * click's conversions are reported to 24metrics with its transaction id, for their conversion checks.
 * Fails open: a timeout, an error or an answer it can't read leaves the click as it is.
 */
import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { getRedis } from '../redis.js';
import { logger } from '../logger.js';
import { safeRequest } from '../net/safe-http.js';
import { getQueue, QUEUE } from '../queues.js';

export const TRACKER24_FLAG = '24metrics';
const TRACKER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/;
const VERDICT_TTL_S = 7 * 86_400; // as long as a click is kept for attribution in Redis
const IP_BLOCK_TTL_S = 86_400;

export interface Tracker24Verdict { status: 'approved' | 'rejected'; reason: string | null; transactionId: string | null }

export const validTrackerId = (id: string | null | undefined): id is string => typeof id === 'string' && TRACKER_ID_RE.test(id);

/** The gateway base for a tracker ID, or null when the ID can't be a host name label. */
export function gatewayBase(trackerId: string): string | null {
  return validTrackerId(trackerId) ? env.TRACKER24_GATEWAY_URL.replace('{id}', trackerId).replace(/\/+$/, '') : null;
}

const ipHash = (ip: string) => createHash('sha1').update(ip).digest('hex').slice(0, 16);
const verdictKey = (networkId: string, clickId: string) => `t24:${networkId}:${clickId}`;
const ipKey = (networkId: string, ip: string) => `t24ip:${networkId}:${ipHash(ip)}`;

export interface Tracker24Click {
  trackerId: string; networkId: string; clickId: string; offerId: string; publisherId: string | null;
  ip: string | null; userAgent: string | null; referrer: string | null; subs: (string | null)[]; sourceId: string | null;
}

/** Ask 24metrics about a click (null = no answer: fail open). */
export async function checkClick(c: Tracker24Click): Promise<Tracker24Verdict | null> {
  const base = gatewayBase(c.trackerId);
  if (!base) return null;
  const p = new URLSearchParams({ no_redirect: 'true', offer: c.offerId, external_transaction_id: c.clickId });
  if (c.publisherId) p.set('publisher', c.publisherId);
  c.subs.forEach((s, i) => { if (s) p.set(i === 0 ? 'sub_id' : `sub_id${i + 1}`, s); });
  if (c.sourceId) p.set('sub_id6', c.sourceId);
  if (c.ip) p.set('ip', c.ip);
  if (c.userAgent) p.set('ua', c.userAgent);
  if (c.referrer) p.set('referer', c.referrer);
  try {
    const res = await safeRequest(`${base}/c?${p.toString()}`, { method: 'GET', timeoutMs: 2000, deadlineMs: 2500, maxBodyBytes: 16_384 });
    if (res.status < 200 || res.status >= 300) return null;
    const body = JSON.parse(res.body) as { data?: { status?: unknown; reason?: unknown; transaction_id?: unknown } };
    const d = body.data;
    if (d?.status !== 'approved' && d?.status !== 'rejected') return null;
    return {
      status: d.status,
      reason: typeof d.reason === 'string' && d.reason.trim() ? d.reason.trim().slice(0, 100) : null,
      transactionId: typeof d.transaction_id === 'string' && d.transaction_id ? d.transaction_id.slice(0, 200) : null,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message, clickId: c.clickId }, '24metrics click check failed — click kept as is');
    return null;
  }
}

/** The flags a verdict adds to the click. */
export const verdictFlags = (v: Tracker24Verdict): string[] =>
  v.status === 'rejected' ? [TRACKER24_FLAG, ...(v.reason ? [`${TRACKER24_FLAG}:${v.reason}`] : [])] : [];

/** Keep the verdict for the click's conversions, and block a rejected click's address for a day. */
export async function storeVerdict(networkId: string, clickId: string, ip: string | null, v: Tracker24Verdict): Promise<void> {
  const multi = getRedis().multi().set(verdictKey(networkId, clickId), JSON.stringify(v), 'EX', VERDICT_TTL_S);
  if (v.status === 'rejected' && ip) multi.set(ipKey(networkId, ip), v.reason ?? 'rejected', 'EX', IP_BLOCK_TTL_S);
  await multi.exec();
}

export async function getVerdict(networkId: string, clickId: string): Promise<Tracker24Verdict | null> {
  try {
    const raw = await getRedis().get(verdictKey(networkId, clickId));
    return raw ? (JSON.parse(raw) as Tracker24Verdict) : null;
  } catch {
    return null;
  }
}

/** Did 24metrics reject a click from this address in the last day? (/click, offers with 24metrics on.) */
export async function isAddressBlocked(networkId: string, ip: string): Promise<boolean> {
  try {
    return (await getRedis().exists(ipKey(networkId, ip))) === 1;
  } catch {
    return false; // fail open
  }
}

export interface Tracker24Conversion {
  trackerId: string; transactionId: string; offerId: string; publisherId: string | null;
  event: string | null; payout: string | null; revenue: string | null; conversionId: string;
}

/** Report an approved conversion of a 24metrics-checked click (queued; the tracker24 worker sends it). */
export async function enqueueConversionReport(c: Tracker24Conversion): Promise<void> {
  await getQueue(QUEUE.tracker24).add('conversion', c, {
    jobId: `t24conv-${c.conversionId}`, attempts: 5, // one report per conversion (BullMQ ids can't contain ':') backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 1000, removeOnFail: 5000,
  });
}

/** Send one conversion report (throws on failure, so the queue retries). */
export async function sendConversionReport(c: Tracker24Conversion): Promise<void> {
  const base = gatewayBase(c.trackerId);
  if (!base) return;
  const p = new URLSearchParams({ transaction_id: c.transactionId, use_current_time: 'true', offer: c.offerId });
  if (c.publisherId) p.set('publisher', c.publisherId);
  if (c.event) p.set('event', c.event);
  if (c.payout) p.set('payout', c.payout);
  if (c.revenue) p.set('revenue', c.revenue);
  const res = await safeRequest(`${base}/api/event-tx?${p.toString()}`, { method: 'GET', timeoutMs: 5000, deadlineMs: 8000, maxBodyBytes: 4096 });
  if (res.status < 200 || res.status >= 300) throw new Error(`24metrics conversion report → HTTP ${res.status}`);
}
