/**
 * Platform billing (Super Admin) — every 15 minutes: trials that ended, renewals (invoiced), overdue
 * flags and suspensions for unpaid invoices (lib/billing/engine.ts).
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { runBilling } from '../../../lib/billing/engine.js';
import { getQueue, QUEUE } from '../queues.js';

const log = surfaceLogger('workers');
const EVERY_MS = 15 * 60 * 1000;

export function startPlatformBillingWorker(): Worker {
  const worker = new Worker(
    QUEUE.platformBilling,
    async () => {
      const r = await runBilling();
      log.info(r, 'platform billing run');
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ err: err.message, jobId: job?.id }, 'platform billing run failed'));
  log.info('platform-billing worker started');
  return worker;
}

/** Schedule the run (idempotent — BullMQ dedups repeatable jobs by key). */
export async function schedulePlatformBilling(): Promise<void> {
  await getQueue(QUEUE.platformBilling).add('run', {}, {
    repeat: { every: EVERY_MS },
    removeOnComplete: 10,
    removeOnFail: 10,
  });
}
