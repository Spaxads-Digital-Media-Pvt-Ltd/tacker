/**
 * Requested Reports — build each queued report export (lib/reporting/report-requests.ts), and every few
 * minutes sweep up requests whose job never ran or whose build was interrupted.
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { processReportRequest, sweepReportRequests } from '../../../lib/reporting/report-requests.js';
import { getQueue, QUEUE } from '../queues.js';

const log = surfaceLogger('workers');
const SWEEP_EVERY_MS = 5 * 60 * 1000;

export function startReportExportsWorker(): Worker {
  const worker = new Worker(
    QUEUE.reportExports,
    async (job) => {
      if (job.name === 'sweep') {
        const r = await sweepReportRequests();
        if (r.requeued || r.failed) log.info(r, 'report export sweep');
        return;
      }
      const id = (job.data as { id?: string }).id;
      if (!id) return;
      const outcome = await processReportRequest(id);
      log.info({ reportRequestId: id, outcome }, 'report export');
    },
    // Two at a time: an export reads the whole report, page by page.
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 2 },
  );
  worker.on('failed', (job, err) => log.error({ err: err.message, jobId: job?.id }, 'report export job failed'));
  log.info('report-exports worker started');
  return worker;
}

/** Schedule the sweep (idempotent — BullMQ dedups repeatable jobs by key). */
export async function scheduleReportExportSweep(): Promise<void> {
  await getQueue(QUEUE.reportExports).add('sweep', {}, { repeat: { every: SWEEP_EVERY_MS }, removeOnComplete: 10, removeOnFail: 10 });
}
