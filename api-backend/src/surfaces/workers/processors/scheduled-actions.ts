/**
 * Scheduled actions (audit F-17a) — a repeatable job that applies every pending offer scheduled
 * action whose time has come (lib/automation/scheduled-actions.ts).
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { runDueScheduledActions } from '../../../lib/automation/scheduled-actions.js';
import { getQueue, QUEUE } from '../queues.js';

const log = surfaceLogger('workers');
const EVERY_MS = 60 * 1000; // every minute

export function startScheduledActionsWorker(): Worker {
  const worker = new Worker(
    QUEUE.scheduledActions,
    async () => {
      const result = await runDueScheduledActions();
      if (result.executed || result.failed) log.info(result, 'scheduled actions run');
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ err: err.message, jobId: job?.id }, 'scheduled actions run failed'));
  log.info('scheduled-actions worker started');
  return worker;
}

/** Schedule the run (idempotent — BullMQ dedups repeatable jobs by key). */
export async function scheduleScheduledActions(): Promise<void> {
  await getQueue(QUEUE.scheduledActions).add('run', {}, {
    repeat: { every: EVERY_MS },
    removeOnComplete: 10,
    removeOnFail: 10,
  });
}
