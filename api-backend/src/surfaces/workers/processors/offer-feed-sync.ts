/**
 * Offer feed sync worker — pulls remote feeds and upserts offers.
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { syncOfferFeed, listNetworksDueForFeedSync } from '../../../lib/integrations/offer-feed-sync.js';
import { getQueue, QUEUE } from '../queues.js';
import type { OfferFeedSyncJob } from '../../../lib/integrations/enqueue.js';

const log = surfaceLogger('workers');
const EVERY_MS = 15 * 60 * 1000;

export function startOfferFeedSyncWorker(): Worker<OfferFeedSyncJob | { scan: true }> {
  const worker = new Worker<OfferFeedSyncJob | { scan: true }>(
    QUEUE.offerFeedSync,
    async (job) => {
      if ('scan' in job.data && job.data.scan) {
        const networkIds = await listNetworksDueForFeedSync();
        for (const networkId of networkIds) {
          await getQueue(QUEUE.offerFeedSync).add('sync', { networkId }, { removeOnComplete: 200, removeOnFail: 500 });
        }
        log.info({ due: networkIds.length }, 'offer feed scan enqueued');
        return;
      }
      const { networkId } = job.data as OfferFeedSyncJob;
      const result = await syncOfferFeed(networkId);
      log.info({ networkId, ...result }, 'offer feed sync complete');
      if (result.error && result.pulled === 0) throw new Error(result.error);
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 2 },
  );
  worker.on('failed', (job, err) => log.warn({ err: err.message, jobId: job?.id }, 'offer-feed-sync attempt failed'));
  log.info('offer-feed-sync worker started');
  return worker;
}

export async function scheduleOfferFeedScan(): Promise<void> {
  await getQueue(QUEUE.offerFeedSync).add('scan', { scan: true }, {
    repeat: { every: EVERY_MS },
    removeOnComplete: 50,
    removeOnFail: 50,
  });
}
