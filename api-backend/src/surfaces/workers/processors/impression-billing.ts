/**
 * CPM bookings — every minute: book the billable impressions counted since each offer / partner row's last
 * booking as one conversion (tracking/conversions/volume-billing.ts bookImpressions).
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { bookImpressions } from '../../tracking/conversions/volume-billing.js';
import { getQueue, QUEUE } from '../queues.js';

const log = surfaceLogger('workers');
const EVERY_MS = 60 * 1000;

export function startImpressionBillingWorker(): Worker {
  const worker = new Worker(
    QUEUE.impressionBilling,
    async () => {
      const r = await bookImpressions();
      if (r.booked) log.info(r, 'impressions booked');
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ err: err.message, jobId: job?.id }, 'impression booking failed'));
  log.info('impression-billing worker started');
  return worker;
}

/** Schedule the run (idempotent — BullMQ dedups repeatable jobs by key). */
export async function scheduleImpressionBilling(): Promise<void> {
  await getQueue(QUEUE.impressionBilling).add('book', {}, {
    repeat: { every: EVERY_MS },
    removeOnComplete: 10,
    removeOnFail: 10,
  });
}
