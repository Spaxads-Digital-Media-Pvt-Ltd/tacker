/**
 * Click-persist worker (spec §5 — drains the click queue, writes to Postgres + the analytics
 * store, OFF the hot path). Idempotent on click_id (ON CONFLICT DO NOTHING) so a retried job never
 * double-inserts. Also mirrors the event to the AnalyticsWriter interface (ClickHouse slots in
 * here at Phase 8 with no caller change).
 */
import { Worker, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../../lib/redis.js';
import { query } from '../../../lib/db/pool.js';
import { surfaceLogger } from '../../../lib/logger.js';
import { getAnalyticsWriter } from '../../../lib/analytics/writer.js';
import { QUEUE } from '../queues.js';
import type { ClickJob } from '../../tracking/click-job.js';

const log = surfaceLogger('workers');

async function persist(job: ClickJob): Promise<void> {
  await query(
    `INSERT INTO clicks (
       click_id, network_id, offer_id, publisher_id, created_at, ip,
       country, region, city, isp, device, os, browser, referrer, user_agent,
       sub1, sub2, sub3, sub4, sub5, is_unique, fraud_score, fraud_flags,
       resolved_payout, resolved_revenue, currency, smart_link_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
       $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
     )
     ON CONFLICT (click_id) DO NOTHING`,
    [
      job.clickId, job.networkId, job.offerId, job.publisherId, job.ts, job.ip,
      job.country, job.region, job.city, job.isp, job.device, job.os, job.browser, job.referrer, job.userAgent,
      job.sub1, job.sub2, job.sub3, job.sub4, job.sub5, job.isUnique, job.fraudScore, job.fraudFlags,
      job.resolvedPayout, job.resolvedRevenue, job.currency, job.smartLinkId,
    ],
  );

  await getAnalyticsWriter().writeClicks([
    { clickId: job.clickId, networkId: job.networkId, offerId: job.offerId, publisherId: job.publisherId ?? '', timestamp: job.ts },
  ]);
}

export function startClickPersistWorker(): Worker<ClickJob> {
  const worker = new Worker<ClickJob>(QUEUE.clickPersist, async (job) => persist(job.data), {
    connection: makeQueueConnection() as unknown as ConnectionOptions,
    concurrency: 8,
  });
  worker.on('failed', (job, err) => log.error({ err, jobId: job?.id }, 'click-persist failed'));
  log.info('click-persist worker started');
  return worker;
}
