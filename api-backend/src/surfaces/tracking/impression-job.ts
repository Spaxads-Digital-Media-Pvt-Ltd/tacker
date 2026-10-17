/**
 * Impression persistence job — /impression ENQUEUES it and answers at once; the impression-persist worker writes
 * the row (and counts it for CPM billing). Same shape as a click job: no synchronous Postgres on the request.
 */
import { getQueue, QUEUE } from '../workers/queues.js';

export interface ImpressionJob {
  impressionId: string;
  networkId: string;
  offerId: string;
  publisherId: string | null;
  ts: string; // ISO timestamp
  ip: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  device: string | null;
  os: string | null;
  browser: string | null;
  referrer: string | null;
  userAgent: string | null;
  sub1: string | null;
  sub2: string | null;
  sub3: string | null;
  sub4: string | null;
  sub5: string | null;
  sourceId: string | null;
  creativeId: string | null;
  isUnique: boolean;
  fraudScore: number;
  fraudFlags: string[];
  resolvedPayout: string | null;
  resolvedRevenue: string | null;
  currency: string | null;
  /** The offer bills this partner per 1000 impressions (payout and / or revenue — null = that side isn't):
   * the worker counts a valid impression for the impression-billing worker to book. */
  cpm?: { payout: string | null; revenue: string | null; advertiserId: string } | null;
}

export async function enqueueImpression(job: ImpressionJob): Promise<void> {
  await getQueue(QUEUE.impressionPersist).add('impression', job, {
    removeOnComplete: 1000,
    removeOnFail: 5000,
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
  });
}
