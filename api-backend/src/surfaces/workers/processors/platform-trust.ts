/**
 * Trust & safety scan (Super Admin › Trust & safety) — hourly: the addresses sending flagged clicks to more
 * than one network, and the platform's 24-hour rejection reasons (lib/platform/trust.ts scanTrust).
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { scanTrust } from '../../../lib/platform/trust.js';
import { getQueue, QUEUE } from '../queues.js';

const log = surfaceLogger('workers');
const EVERY_MS = 60 * 60 * 1000;

export function startPlatformTrustWorker(): Worker {
  const worker = new Worker(
    QUEUE.platformTrust,
    async () => {
      const scan = await scanTrust();
      if (scan.suspiciousIps) log.info({ suspiciousIps: scan.suspiciousIps, flaggedClicks: scan.flaggedClicks }, 'trust scan found suspicious addresses');
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ err: err.message, jobId: job?.id }, 'trust scan failed'));
  log.info('platform-trust worker started');
  return worker;
}

export async function schedulePlatformTrust(): Promise<void> {
  await getQueue(QUEUE.platformTrust).add('run', {}, { repeat: { every: EVERY_MS }, removeOnComplete: 10, removeOnFail: 10 });
}
