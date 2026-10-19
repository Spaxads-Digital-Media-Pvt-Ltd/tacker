/**
 * Scheduled reports (audit F-24) — every minute, run the saved reports whose schedule is due and email
 * them to their recipients (lib/reporting/saved-reports.ts).
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { runDueSavedReports } from '../../../lib/reporting/saved-reports.js';
import { getQueue, QUEUE } from '../queues.js';

const log = surfaceLogger('workers');
const EVERY_MS = 60 * 1000;

export function startScheduledReportsWorker(): Worker {
  const worker = new Worker(
    QUEUE.scheduledReports,
    async () => {
      const r = await runDueSavedReports();
      if (r.sent || r.skipped || r.failed) log.info(r, 'scheduled reports run');
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ err: err.message, jobId: job?.id }, 'scheduled reports run failed'));
  log.info('scheduled-reports worker started');
  return worker;
}

/** Schedule the run (idempotent — BullMQ dedups repeatable jobs by key). */
export async function scheduleScheduledReports(): Promise<void> {
  await getQueue(QUEUE.scheduledReports).add('run', {}, {
    repeat: { every: EVERY_MS },
    removeOnComplete: 10,
    removeOnFail: 10,
  });
}
