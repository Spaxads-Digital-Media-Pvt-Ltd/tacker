/**
 * The hourly advertiser digests (lib/email/advertiser-digest.ts) — checked every 15 minutes; each
 * network-hour is sent once.
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { sendAdvertiserDigests } from '../../../lib/email/advertiser-digest.js';
import { getQueue, QUEUE } from '../queues.js';

const log = surfaceLogger('workers');
const EVERY_MS = 15 * 60 * 1000;

export function startAdvertiserDigestWorker(): Worker {
  const worker = new Worker(
    QUEUE.advertiserDigest,
    async () => {
      const r = await sendAdvertiserDigests();
      if (r.postback || r.conversion) log.info(r, 'advertiser digests sent');
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ err: err.message, jobId: job?.id }, 'advertiser digest run failed'));
  log.info('advertiser-digest worker started');
  return worker;
}

export async function scheduleAdvertiserDigest(): Promise<void> {
  await getQueue(QUEUE.advertiserDigest).add('run', {}, { repeat: { every: EVERY_MS }, removeOnComplete: 10, removeOnFail: 10 });
}
