/**
 * Impression-persist worker — drains the impression queue (tracking/impression.ts), writes each impression
 * (accepted or rejected) and, for an offer billed per 1000 impressions, counts the billable ones for the
 * impression-billing worker (tracking/conversions/volume-billing.ts). Idempotent: the row and its count are
 * written in one transaction, so a retried job inserts nothing twice (ON CONFLICT on the impression id) and an
 * impression is counted exactly once.
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { withTransaction } from '../../../lib/db/pool.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { QUEUE } from '../queues.js';
import type { ImpressionJob } from '../../tracking/impression-job.js';
import { countImpression } from '../../tracking/conversions/volume-billing.js';
import { blankToNull } from '../../tracking/click-params.js';

const log = surfaceLogger('workers');

export async function persistImpression(job: ImpressionJob): Promise<void> {
  await withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO impressions (
         impression_id, network_id, offer_id, publisher_id, created_at, ip, country, region, city, isp, device, os, browser,
         referrer, user_agent, sub1, sub2, sub3, sub4, sub5, source_id, creative_id, is_unique, fraud_score, fraud_flags,
         resolved_payout, resolved_revenue, currency
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
       ON CONFLICT (impression_id) DO NOTHING`,
      [
        job.impressionId, job.networkId, job.offerId, job.publisherId, job.ts, job.ip, job.country, job.region, job.city, job.isp,
        job.device, job.os, job.browser, job.referrer, job.userAgent, job.sub1, job.sub2, job.sub3, job.sub4, job.sub5,
        blankToNull(job.sourceId), blankToNull(job.creativeId), job.isUnique, job.fraudScore, job.fraudFlags,
        job.resolvedPayout, job.resolvedRevenue, job.currency,
      ],
    );
    // Billable: a new, valid (unflagged) impression with a partner, on an offer billed per impression.
    if ((res.rowCount ?? 0) > 0 && job.cpm && job.publisherId && job.fraudFlags.length === 0) await countImpression(job, client);
  });
}

export function startImpressionPersistWorker(): Worker<ImpressionJob> {
  const worker = new Worker<ImpressionJob>(QUEUE.impressionPersist, async (job) => persistImpression(job.data), {
    connection: makeQueueConnection() as unknown as ConnectionOptions,
    concurrency: 8,
  });
  worker.on('failed', (job, err) => log.error({ err, jobId: job?.id }, 'impression-persist failed'));
  log.info('impression-persist worker started');
  return worker;
}
