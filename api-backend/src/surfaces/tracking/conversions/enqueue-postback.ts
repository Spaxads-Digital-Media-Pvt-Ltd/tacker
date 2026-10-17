/**
 * Enqueue an outbound postback (you → publisher) for a confirmed conversion (spec §6). The worker
 * resolves the publisher's postback URL, fills macros, fires with retries/backoff/timeout, and
 * logs delivery. Retries/backoff are configured here on the job.
 */
import { getQueue, QUEUE } from '../../workers/queues.js';

export interface OutboundPostbackJob {
  networkId: string;
  conversionId: string;
  offerId: string;
  publisherId: string | null;
  clickId: string;
  event: string | null;
  payout: string | null;
  currency: string | null;
  txnId: string | null;
  subs: (string | null)[];
  /** 'cpc' — a paid click on a CPC offer (conversions/volume-billing.ts): fires the partner's CPC-level postbacks
   * (Partners › Postbacks, level "CPC") instead of their conversion postbacks. Absent = a conversion. */
  level?: 'conversion' | 'cpc';
}

export async function enqueueOutboundPostback(job: OutboundPostbackJob): Promise<void> {
  if (!job.publisherId) return; // nothing to notify
  await getQueue(QUEUE.outboundPostback).add('postback', job, {
    attempts: 6,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}
