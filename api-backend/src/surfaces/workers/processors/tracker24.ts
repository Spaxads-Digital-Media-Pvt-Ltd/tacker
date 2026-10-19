/**
 * 24metrics conversion reports — sends each approved conversion of a 24metrics-checked click to 24metrics
 * (lib/integrations/tracker24.ts), retried with backoff when their gateway doesn't answer.
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { sendConversionReport, type Tracker24Conversion } from '../../../lib/integrations/tracker24.js';
import { QUEUE } from '../queues.js';

const log = surfaceLogger('workers');

export function startTracker24Worker(): Worker<Tracker24Conversion> {
  const worker = new Worker<Tracker24Conversion>(QUEUE.tracker24, async (job) => sendConversionReport(job.data), {
    connection: makeQueueConnection() as unknown as ConnectionOptions,
    concurrency: 4,
  });
  worker.on('failed', (job, err) => log.warn({ err: err.message, jobId: job?.id }, '24metrics conversion report failed'));
  log.info('tracker24 worker started');
  return worker;
}
