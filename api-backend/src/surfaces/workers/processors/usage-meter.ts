/**
 * Plan metering (audit F-26) — every hour, count each active network's clicks / conversions / events
 * into usage_records and raise the near / reached plan-limit alerts (lib/usage/meter.ts).
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { runUsageMeter } from '../../../lib/usage/meter.js';
import { getQueue, QUEUE } from '../queues.js';

const log = surfaceLogger('workers');
const EVERY_MS = 60 * 60 * 1000;

export function startUsageMeterWorker(): Worker {
  const worker = new Worker(
    QUEUE.usageMeter,
    async () => {
      const r = await runUsageMeter();
      log.info(r, 'usage meter run');
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ err: err.message, jobId: job?.id }, 'usage meter run failed'));
  log.info('usage-meter worker started');
  return worker;
}

/** Schedule the run (idempotent — BullMQ dedups repeatable jobs by key). */
export async function scheduleUsageMeter(): Promise<void> {
  await getQueue(QUEUE.usageMeter).add('run', {}, {
    repeat: { every: EVERY_MS },
    removeOnComplete: 10,
    removeOnFail: 10,
  });
}
