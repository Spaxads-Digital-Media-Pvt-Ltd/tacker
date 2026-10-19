/**
 * Smart-Link KPI rotation (audit F-17b) — a repeatable job that re-scores the KPI smart links that
 * are due and stores the weights /sl picks with (lib/smart-links/kpi.ts).
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { rescoreKpiSmartLinks } from '../../../lib/smart-links/kpi.js';
import { getQueue, QUEUE } from '../queues.js';

const log = surfaceLogger('workers');
const EVERY_MS = 10 * 60 * 1000; // checks every 10 minutes which links are due (per-link frequency in hours)

export function startSmartLinkKpiWorker(): Worker {
  const worker = new Worker(
    QUEUE.smartLinkKpi,
    async () => {
      const result = await rescoreKpiSmartLinks();
      if (result.links) log.info(result, 'smart link KPI weights updated');
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ err: err.message, jobId: job?.id }, 'smart link KPI scoring failed'));
  log.info('smart-link-kpi worker started');
  return worker;
}

/** Schedule the re-scoring (idempotent — BullMQ dedups repeatable jobs by key). */
export async function scheduleSmartLinkKpi(): Promise<void> {
  await getQueue(QUEUE.smartLinkKpi).add('rescore', {}, {
    repeat: { every: EVERY_MS },
    removeOnComplete: 10,
    removeOnFail: 10,
  });
}
