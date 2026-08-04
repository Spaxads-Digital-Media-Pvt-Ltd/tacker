/**
 * Retention worker (spec §7/§11) — drains QUEUE.retention and prunes aged raw data. A repeatable
 * job triggers it daily; it can also be enqueued on demand (or run via `npm run retention`).
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { runRetention } from '../../../lib/retention/retention.js';
import { getQueue, QUEUE } from '../queues.js';

const log = surfaceLogger('workers');
const EVERY_MS = 24 * 60 * 60 * 1000; // once a day

export function startRetentionWorker(): Worker {
  const worker = new Worker(
    QUEUE.retention,
    async () => {
      const result = await runRetention();
      log.info(result, 'retention complete');
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ err: err.message, jobId: job?.id }, 'retention failed'));
  log.info('retention worker started');
  return worker;
}

/** Schedule the daily prune (idempotent — BullMQ dedups repeatable jobs by key). */
export async function scheduleRetention(): Promise<void> {
  await getQueue(QUEUE.retention).add('prune', {}, {
    repeat: { every: EVERY_MS },
    removeOnComplete: 10,
    removeOnFail: 10,
  });
}
