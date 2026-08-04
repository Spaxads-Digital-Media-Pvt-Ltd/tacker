/**
 * Outbound postback worker (spec §6 — you → publisher). Resolves the publisher's best-matching
 * postback config, fills macros, fires with a timeout, and records every attempt to postback_logs.
 * Throws on non-2xx / network error so BullMQ retries with backoff. Late/duplicate/out-of-order
 * advertiser postbacks upstream are already deduped by recordConversion, so this only fires once
 * per approved conversion.
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { query } from '../../../lib/db/pool.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { substituteMacros } from '../../tracking/macros.js';
import { postbackDeliveries } from '../../../lib/metrics.js';
import { QUEUE } from '../queues.js';
import type { OutboundPostbackJob } from '../../tracking/conversions/enqueue-postback.js';

const log = surfaceLogger('workers');
const TIMEOUT_MS = 10_000;

interface PostbackRow {
  id: string; url: string; method: 'GET' | 'POST';
}

async function fire(job: OutboundPostbackJob, attempt: number): Promise<void> {
  const { rows } = await query<PostbackRow>(
    `SELECT id, url, method FROM publisher_postbacks
      WHERE network_id = $1 AND publisher_id = $2 AND status = 'active'
        AND (offer_id = $3 OR offer_id IS NULL)
        AND (event = $4 OR event IS NULL)
      ORDER BY (offer_id IS NOT NULL) DESC, (event IS NOT NULL) DESC
      LIMIT 1`,
    [job.networkId, job.publisherId, job.offerId, job.event],
  );
  const cfg = rows[0];
  if (!cfg) {
    // Nothing configured for this publisher — not an error; record and finish.
    await logDelivery(job, '(none)', attempt, null, false, 'no_postback_configured');
    return;
  }

  const macros = {
    click_id: job.clickId, conversion_id: job.conversionId, offer_id: job.offerId,
    publisher_id: job.publisherId ?? '', event: job.event ?? '',
    payout: job.payout ?? '', currency: job.currency ?? '', txn_id: job.txnId ?? '',
    sub1: job.subs[0] ?? '', sub2: job.subs[1] ?? '', sub3: job.subs[2] ?? '',
    sub4: job.subs[3] ?? '', sub5: job.subs[4] ?? '',
  };
  const url = substituteMacros(cfg.url, macros);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: cfg.method,
      signal: ctrl.signal,
      ...(cfg.method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(macros) } : {}),
    });
    const success = res.status >= 200 && res.status < 300;
    await logDelivery(job, url, attempt, res.status, success, success ? null : `http_${res.status}`);
    if (!success) throw new Error(`postback http ${res.status}`);
  } catch (err) {
    if ((err as Error).message?.startsWith('postback http')) throw err; // already logged
    await logDelivery(job, url, attempt, null, false, (err as Error).name === 'AbortError' ? 'timeout' : String((err as Error).message));
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function logDelivery(
  job: OutboundPostbackJob, url: string, attempt: number,
  statusCode: number | null, success: boolean, error: string | null,
): Promise<void> {
  await query(
    `INSERT INTO postback_logs (network_id, conversion_id, publisher_id, url, attempt, status_code, success, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [job.networkId, job.conversionId, job.publisherId, url, attempt, statusCode, success, error],
  );
  // Delivery-health metric (spec §6): 'none' when the publisher has no postback configured, so a
  // clean no-op doesn't skew the success rate.
  postbackDeliveries.inc({ result: error === 'no_postback_configured' ? 'none' : success ? 'success' : 'failure' });
}

export function startOutboundPostbackWorker(): Worker<OutboundPostbackJob> {
  const worker = new Worker<OutboundPostbackJob>(
    QUEUE.outboundPostback,
    async (job) => fire(job.data, job.attemptsMade + 1),
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 10 },
  );
  worker.on('failed', (job, err) => log.warn({ err: err.message, jobId: job?.id }, 'outbound-postback attempt failed'));
  log.info('outbound-postback worker started');
  return worker;
}
