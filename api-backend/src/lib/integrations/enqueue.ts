/**
 * Enqueue async integration jobs (Facebook CAPI, offer feed sync).
 */
import { getQueue, QUEUE } from '../../surfaces/workers/queues.js';

export interface FacebookCapiJob {
  networkId: string;
  conversionId: string;
  eventName: string | null;
  payout: string | null;
  currency: string | null;
  clickId: string;
}

export interface OfferFeedSyncJob {
  networkId: string;
}

export async function enqueueFacebookCapi(job: FacebookCapiJob): Promise<void> {
  await getQueue(QUEUE.facebookCapi).add('capi', job, {
    attempts: 4,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 500,
    removeOnFail: 2000,
  });
}

export async function enqueueOfferFeedSync(job: OfferFeedSyncJob): Promise<void> {
  await getQueue(QUEUE.offerFeedSync).add('sync', job, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  });
}
