/**
 * SmartSwitch (D8) — a repeatable job that evaluates every active SmartSwitch rule per partner × offer
 * and applies its action where the conditions hold (lib/automation/smartswitch.ts).
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { evaluateSmartSwitchRules } from '../../../lib/automation/smartswitch.js';
import { getQueue, QUEUE } from '../queues.js';

const log = surfaceLogger('workers');
const EVERY_MS = 5 * 60 * 1000; // every 5 minutes

export function startSmartSwitchWorker(): Worker {
  const worker = new Worker(
    QUEUE.smartSwitch,
    async () => {
      const result = await evaluateSmartSwitchRules();
      if (result.rules) log.info(result, 'smartswitch rules evaluated');
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.error({ err: err.message, jobId: job?.id }, 'smartswitch evaluation failed'));
  log.info('smartswitch worker started');
  return worker;
}

/** Schedule the evaluation (idempotent — BullMQ dedups repeatable jobs by key). */
export async function scheduleSmartSwitch(): Promise<void> {
  await getQueue(QUEUE.smartSwitch).add('evaluate', {}, {
    repeat: { every: EVERY_MS },
    removeOnComplete: 10,
    removeOnFail: 10,
  });
}
