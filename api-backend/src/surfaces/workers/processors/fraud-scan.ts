/**
 * Fraud-scan worker (spec §10) — drains QUEUE.fraudScore and runs the async fraud scan across
 * networks. A repeatable job triggers it on an interval; it can also be enqueued on demand.
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { runFraudScan } from '../../../lib/fraud/scan.js';
import { getQueue, QUEUE } from '../queues.js';

const log = surfaceLogger('workers');
const EVERY_MS = 5 * 60 * 1000; // scan every 5 minutes

export function startFraudScanWorker(): Worker {
  const worker = new Worker(
    QUEUE.fraudScore,
    async () => {
      const result = await runFraudScan();
      log.info(result, 'fraud scan complete');
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ err: err.message, jobId: job?.id }, 'fraud scan failed'));
  log.info('fraud-scan worker started');
  return worker;
}

/** Schedule the recurring scan (idempotent — BullMQ dedups repeatable jobs by key). */
export async function scheduleFraudScan(): Promise<void> {
  await getQueue(QUEUE.fraudScore).add('scan', {}, {
    repeat: { every: EVERY_MS },
    removeOnComplete: 50,
    removeOnFail: 50,
  });
}
