/**
 * Automation alert rules (audit F-17a) — a repeatable job that evaluates every active rule and alerts
 * on the ones whose conditions started to hold (lib/automation/alert-rules.ts).
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { evaluateAlertRules } from '../../../lib/automation/alert-rules.js';
import { getQueue, QUEUE } from '../queues.js';

const log = surfaceLogger('workers');
const EVERY_MS = 5 * 60 * 1000; // every 5 minutes

export function startAlertRulesWorker(): Worker {
  const worker = new Worker(
    QUEUE.alertRules,
    async () => {
      const result = await evaluateAlertRules();
      if (result.rules) log.info(result, 'alert rules evaluated');
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ err: err.message, jobId: job?.id }, 'alert rules evaluation failed'));
  log.info('alert-rules worker started');
  return worker;
}

/** Schedule the evaluation (idempotent — BullMQ dedups repeatable jobs by key). */
export async function scheduleAlertRules(): Promise<void> {
  await getQueue(QUEUE.alertRules).add('evaluate', {}, {
    repeat: { every: EVERY_MS },
    removeOnComplete: 10,
    removeOnFail: 10,
  });
}
