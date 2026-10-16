/**
 * Customer health (Super Admin › Customer success) — every 6 hours: each network's health score, its daily
 * history and onboarding milestones; a network that falls to "at risk" gets a check-in task for its account
 * manager (lib/platform/health.ts). Also keeps the history to about a year.
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { computeHealth, pruneHealthHistory } from '../../../lib/platform/health.js';
import { getQueue, QUEUE } from '../queues.js';

const log = surfaceLogger('workers');
const EVERY_MS = 6 * 60 * 60 * 1000;

export function startPlatformHealthWorker(): Worker {
  const worker = new Worker(
    QUEUE.platformHealth,
    async () => {
      const r = await computeHealth();
      const pruned = await pruneHealthHistory();
      log.info({ ...r, pruned }, 'customer health computed');
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ err: err.message, jobId: job?.id }, 'customer health run failed'));
  log.info('platform-health worker started');
  return worker;
}

/** Schedule the run (idempotent — BullMQ dedups repeatable jobs by key); one right away too. */
export async function schedulePlatformHealth(): Promise<void> {
  const q = getQueue(QUEUE.platformHealth);
  await q.add('run', {}, { repeat: { every: EVERY_MS }, removeOnComplete: 10, removeOnFail: 10 });
  await q.add('run-now', {}, { jobId: `health-boot-${new Date().toISOString().slice(0, 13)}`, removeOnComplete: 10, removeOnFail: 10 });
}
