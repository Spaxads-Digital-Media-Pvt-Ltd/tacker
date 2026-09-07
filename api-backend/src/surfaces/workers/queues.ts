/**
 * Queue registry (spec §2 BullMQ, §5/§6 async work). Names are declared here so producers and
 * consumers agree. Processors are added per phase; Phase 0 only declares the topology.
 */
import { Queue, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../../lib/redis.js';

export const QUEUE = {
  /** Async persistence of click events off the hot path (spec §5 step 8, Phase 2). */
  clickPersist: 'click-persist',
  /** Outbound postbacks to publishers with retries/backoff (spec §6, Phase 3). */
  outboundPostback: 'outbound-postback',
  /** Async fraud scoring (spec §10, Phase 6). */
  fraudScore: 'fraud-score',
  /** Scheduled reconciliation of ledger vs payouts (spec §8, Phase 4). */
  reconciliation: 'reconciliation',
  /** Scheduled data retention / pruning of raw clicks & logs (spec §7/§11, Phase 8). */
  retention: 'retention',
  /** Facebook Conversions API — server-side events on approved conversions. */
  facebookCapi: 'facebook-capi',
  /** Offer feed pull — remote JSON feeds into offers table. */
  offerFeedSync: 'offer-feed-sync',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

/** Lazily-created producers sharing one connection. */
const producers = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let q = producers.get(name);
  if (!q) {
    // Cast: BullMQ bundles its own ioredis copy, so a live ioredis instance is nominally a
    // different type though runtime-compatible. Passing our shared-config connection is correct.
    q = new Queue(name, { connection: makeQueueConnection() as unknown as ConnectionOptions });
    producers.set(name, q);
  }
  return q;
}
