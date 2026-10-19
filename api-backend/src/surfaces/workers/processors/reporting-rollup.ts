/**
 * Reporting rollups (audit F-20) — every minute: freeze the buckets that just became old enough,
 * re-roll dirty ones, and backfill a chunk of history (lib/reporting/rollups.ts).
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { runRollup } from '../../../lib/reporting/rollups.js';
import { getQueue, QUEUE } from '../queues.js';

const log = surfaceLogger('workers');
const EVERY_MS = 60 * 1000;

export function startReportingRollupWorker(): Worker {
  const worker = new Worker(
    QUEUE.reportingRollup,
    async () => {
      const r = await runRollup();
      if (r.frozen || r.dirty || r.backfilled) log.info(r, 'reporting rollups updated');
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ err: err.message, jobId: job?.id }, 'reporting rollup failed'));
  log.info('reporting-rollup worker started');
  return worker;
}

/** Schedule the run (idempotent — BullMQ dedups repeatable jobs by key). */
export async function scheduleReportingRollup(): Promise<void> {
  await getQueue(QUEUE.reportingRollup).add('rollup', {}, {
    repeat: { every: EVERY_MS },
    removeOnComplete: 10,
    removeOnFail: 10,
  });
}
