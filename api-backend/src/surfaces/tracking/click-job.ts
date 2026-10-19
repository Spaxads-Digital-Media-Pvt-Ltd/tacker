/**
 * Click persistence job (spec §5 step 8). The hot path ENQUEUES this and returns immediately; the
 * click-persist worker batch-writes it to Postgres. No synchronous DB write on the click path
 * (non-negotiable #1).
 */
import { getQueue, QUEUE } from '../workers/queues.js';

export interface ClickJob {
  clickId: string;
  networkId: string;
  offerId: string;
  publisherId: string | null;
  ts: string; // ISO timestamp
  ip: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  device: string | null;
  os: string | null;
  browser: string | null;
  referrer: string | null;
  userAgent: string | null;
  sub1: string | null;
  sub2: string | null;
  sub3: string | null;
  sub4: string | null;
  sub5: string | null;
  isUnique: boolean;
  fraudScore: number;
  fraudFlags: string[];
  resolvedPayout: string | null;
  resolvedRevenue: string | null;
  currency: string | null;
  smartLinkId: string | null;
  /** Click-URL values (?source_id|source|src, ?fbclid, ?gclid). Optional: a job queued by an older
   *  tracking build has none and persists NULL. */
  sourceId?: string | null;
  fbclid?: string | null;
  gclid?: string | null;
  /** Offer has IPQualityScore enrichment on — the click-persist worker looks the IP up (async). */
  ipqs?: boolean;
  /** The offer bills this partner per click (payout and / or revenue — null = that side isn't): the
   * click-persist worker books a billable click as a paid click (conversions/volume-billing.ts). */
  cpc?: { payout: string | null; revenue: string | null; advertiserId: string; manualApproval: boolean } | null;
  /** The offer has 24metrics on: the click-persist worker asks 24metrics about the click first (lib/integrations/tracker24.ts). */
  tracker24?: { trackerId: string } | null;
}

export async function enqueueClick(job: ClickJob): Promise<void> {
  await getQueue(QUEUE.clickPersist).add('click', job, {
    removeOnComplete: 1000,
    removeOnFail: 5000,
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
  });
}
