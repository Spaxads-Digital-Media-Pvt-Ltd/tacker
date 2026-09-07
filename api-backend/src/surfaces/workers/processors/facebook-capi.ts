/**
 * Facebook CAPI worker — fires server-side conversion events to Meta.
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { sendFacebookCapiEvent } from '../../../lib/integrations/facebook-capi.js';
import { QUEUE } from '../queues.js';
import type { FacebookCapiJob } from '../../../lib/integrations/enqueue.js';

const log = surfaceLogger('workers');

export function startFacebookCapiWorker(): Worker<FacebookCapiJob> {
  const worker = new Worker<FacebookCapiJob>(
    QUEUE.facebookCapi,
    async (job) => {
      const result = await sendFacebookCapiEvent(job.data);
      if (!result.ok && result.error !== 'not_configured') {
        throw new Error(result.error ?? 'facebook_capi_failed');
      }
    },
    { connection: makeQueueConnection() as unknown as ConnectionOptions, concurrency: 5 },
  );
  worker.on('failed', (job, err) => log.warn({ err: err.message, jobId: job?.id }, 'facebook-capi attempt failed'));
  log.info('facebook-capi worker started');
  return worker;
}
