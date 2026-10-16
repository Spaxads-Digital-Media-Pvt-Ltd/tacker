/**
 * Support desk housekeeping (Super Admin › Support) — hourly: resolved tickets the customer didn't answer
 * within the auto-close window are closed (lib/platform/support.ts).
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { closeResolvedTickets } from '../../../lib/platform/support.js';
import { getQueue, QUEUE } from '../queues.js';

const log = surfaceLogger('workers');
const EVERY_MS = 60 * 60 * 1000;

export function startPlatformSupportWorker(): Worker {
  const worker = new Worker(
    QUEUE.platformSupport,
    async () => {
      const closed = await closeResolvedTickets();
      if (closed) log.info({ closed }, 'support tickets closed automatically');
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ err: err.message, jobId: job?.id }, 'support housekeeping failed'));
  log.info('platform-support worker started');
  return worker;
}

export async function schedulePlatformSupport(): Promise<void> {
  await getQueue(QUEUE.platformSupport).add('run', {}, { repeat: { every: EVERY_MS }, removeOnComplete: 10, removeOnFail: 10 });
}
