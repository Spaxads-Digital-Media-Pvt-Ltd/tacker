/**
 * Email (O11) — drains the email queue: each job is one outbox row (one recipient), sent through
 * the network's SMTP and retried with backoff (lib/email/outbox.ts).
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { deliverOutboxEmail, type EmailJob } from '../../../lib/email/outbox.js';
import { QUEUE } from '../queues.js';

const log = surfaceLogger('workers');

export function startEmailWorker(): Worker<EmailJob> {
  const worker = new Worker<EmailJob>(
    QUEUE.email,
    async (job) => {
      const attempt = job.attemptsMade + 1;
      await deliverOutboxEmail(job.data.outboxId, attempt, attempt >= (job.opts.attempts ?? 1));
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 5 },
  );
  worker.on('failed', (job, err) => log.warn({ err: err.message, jobId: job?.id }, 'email attempt failed'));
  log.info('email worker started');
  return worker;
}
