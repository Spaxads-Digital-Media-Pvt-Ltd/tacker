/**
 * Custom tracking-domain re-check (audit F-15) — a repeatable job that retries DNS TXT verification
 * for every custom domain still waiting on its record, and activates it once the record appears
 * (lib/tracking-domains/verify.ts). Misses leave the domain 'pending' for the next run.
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { recheckPendingDomains } from '../../../lib/tracking-domains/verify.js';
import { getQueue, QUEUE } from '../queues.js';

const log = surfaceLogger('workers');
const EVERY_MS = 10 * 60 * 1000; // every 10 minutes

export function startDomainVerifyWorker(): Worker {
  const worker = new Worker(
    QUEUE.domainVerify,
    async () => {
      const result = await recheckPendingDomains();
      if (result.checked) log.info(result, 'tracking domain re-check complete');
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ err: err.message, jobId: job?.id }, 'tracking domain re-check failed'));
  log.info('tracking domain verify worker started');
  return worker;
}

/** Schedule the re-check (idempotent — BullMQ dedups repeatable jobs by key). */
export async function scheduleDomainVerify(): Promise<void> {
  await getQueue(QUEUE.domainVerify).add('recheck', {}, {
    repeat: { every: EVERY_MS },
    removeOnComplete: 10,
    removeOnFail: 10,
  });
}
