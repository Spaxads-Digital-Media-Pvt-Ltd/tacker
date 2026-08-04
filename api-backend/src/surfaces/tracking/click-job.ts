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
}

export async function enqueueClick(job: ClickJob): Promise<void> {
  await getQueue(QUEUE.clickPersist).add('click', job, {
    removeOnComplete: 1000,
    removeOnFail: 5000,
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
  });
}
