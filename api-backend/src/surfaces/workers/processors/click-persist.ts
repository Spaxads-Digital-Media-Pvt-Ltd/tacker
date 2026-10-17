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
import { ipqsVerdict } from '../../../lib/integrations/ipqs.js';
import { getFraudConfigCached } from '../../../lib/fraud/rules.js';
import { foldIpqsVerdict } from '../../tracking/fraud-presignals.js';
import type { ClickJob } from '../../tracking/click-job.js';
import { blankToNull } from '../../tracking/click-params.js';
import { CLICK_REJECTION_REASONS } from '../../../lib/click-rejections.js';
import { checkClick, storeVerdict, verdictFlags } from '../../../lib/integrations/tracker24.js';
import { recordClickBilling } from '../../tracking/conversions/volume-billing.js';

const REJECTIONS = new Set<string>(CLICK_REJECTION_REASONS);
/** A click /click rejected (its first flag is the reason) — never sent on, never checked or billed. */
const isRejected = (flags: string[]) => flags.length > 0 && REJECTIONS.has(flags[0]!);

const log = surfaceLogger('workers');

async function persist(job: ClickJob): Promise<void> {
 let fraudScore = job.fraudScore;
 let fraudFlags = job.fraudFlags;
 if (job.ipqs && job.ip) {
 // Cached per network + IP for a day (F-23), so the IP's later clicks are scored with it at /click.
 const ipqs = await ipqsVerdict(job.networkId, job.ip);
 if (ipqs) {
 // The same fold /click applies, so a click scored before the verdict was cached gets its weights too.
 const { weights } = await getFraudConfigCached(job.networkId);
 ({ score: fraudScore, flags: fraudFlags } = foldIpqsVerdict({ score: fraudScore, flags: fraudFlags }, ipqs, weights));
 }
 }
 // 24metrics (lib/integrations/tracker24.ts): ask about an accepted click before it is stored, so a rejection
 // lands on the row as flags; its verdict also decides its conversions (record.ts) and blocks the address.
 if (job.tracker24 && !isRejected(job.fraudFlags)) {
 const verdict = await checkClick({
 trackerId: job.tracker24.trackerId, networkId: job.networkId, clickId: job.clickId, offerId: job.offerId,
 publisherId: job.publisherId, ip: job.ip, userAgent: job.userAgent, referrer: job.referrer,
 subs: [job.sub1, job.sub2, job.sub3, job.sub4, job.sub5], sourceId: job.sourceId ?? null,
 });
 if (verdict) {
 await storeVerdict(job.networkId, job.clickId, job.ip, verdict);
 if (verdict.status === 'rejected') {
 fraudFlags = [...fraudFlags, ...verdictFlags(verdict).filter((f) => !fraudFlags.includes(f))];
 fraudScore = Math.min(100, fraudScore + 50);
 }
 }
 }
 await query(
 `INSERT INTO clicks (
 click_id, network_id, offer_id, publisher_id, created_at, ip,
 country, region, city, isp, device, os, browser, referrer, user_agent,
 sub1, sub2, sub3, sub4, sub5, is_unique, fraud_score, fraud_flags,
 resolved_payout, resolved_revenue, currency, smart_link_id, source_id, fbclid, gclid
 ) VALUES (
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
 $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30
 )
  ON CONFLICT (click_id) DO NOTHING`,
 [
 job.clickId, job.networkId, job.offerId, job.publisherId, job.ts, job.ip,
 job.country, job.region, job.city, job.isp, job.device, job.os, job.browser, job.referrer, job.userAgent,
 job.sub1, job.sub2, job.sub3, job.sub4, job.sub5, job.isUnique, fraudScore, fraudFlags,
 job.resolvedPayout, job.resolvedRevenue, job.currency, job.smartLinkId,
 // Blank → NULL again here: a job queued by an older tracking build may carry ''.
 blankToNull(job.sourceId), blankToNull(job.fbclid), blankToNull(job.gclid),
 ],
 );

 // CPC (conversions/volume-billing.ts): a billable click — unique, valid, with a partner — is booked as a paid
 // click on an offer that bills this partner per click. Idempotent on the click, so a retried job books once.
 if (job.cpc && job.publisherId && job.isUnique && fraudFlags.length === 0) {
 await recordClickBilling({
 networkId: job.networkId, clickId: job.clickId, offerId: job.offerId, publisherId: job.publisherId,
 advertiserId: job.cpc.advertiserId, payout: job.cpc.payout, revenue: job.cpc.revenue, currency: job.currency,
 country: job.country, device: job.device, ts: job.ts, manualApproval: job.cpc.manualApproval,
 subs: [job.sub1, job.sub2, job.sub3, job.sub4, job.sub5],
 });
 }

 await getAnalyticsWriter().writeClicks([
 {
 clickId: job.clickId,
 networkId: job.networkId,
 offerId: job.offerId,
 publisherId: job.publisherId ?? '',
 timestamp: job.ts,
 ip: job.ip,
 country: job.country,
 region: job.region,
 city: job.city,
 isp: job.isp,
 device: job.device,
 os: job.os,
  browser: job.browser,
 referrer: job.referrer,
 userAgent: job.userAgent,
 sub1: job.sub1,
  sub2: job.sub2,
 sub3: job.sub3,
 sub4: job.sub4,
 sub5: job.sub5,
 isUnique: job.isUnique,
 fraudScore,
 fraudFlags,
 payout: job.resolvedPayout,
 revenue: job.resolvedRevenue,
 currency: job.currency,
  smartLinkId: job.smartLinkId,
 },
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
