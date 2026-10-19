/**
 * Automation webhooks (audit F-17a) — drains the delivery queue: each job is one event for one
 * webhook, sent through the SSRF guard and retried with backoff (lib/automation/webhooks.ts).
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { deliverWebhook, type WebhookJob } from '../../../lib/automation/webhooks.js';
import { QUEUE } from '../queues.js';

const log = surfaceLogger('workers');

export function startAutomationWebhookWorker(): Worker<WebhookJob> {
  const worker = new Worker<WebhookJob>(
    QUEUE.automationWebhook,
    async (job) => {
      const attempt = job.attemptsMade + 1;
      await deliverWebhook(job.data, attempt, attempt >= (job.opts.attempts ?? 1));
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 10 },
  );
  worker.on('failed', (job, err) => log.warn({ err: err.message, jobId: job?.id }, 'automation webhook attempt failed'));
  log.info('automation-webhook worker started');
  return worker;
}
