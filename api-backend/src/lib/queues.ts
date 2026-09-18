import { Queue, type ConnectionOptions } from 'bullmq';
import { makeQueueConnection } from '../lib/redis.js';

export const QUEUE = {
 clickPersist: 'click-persist',
 outboundPostback: 'outbound-postback',
 fraudScore: 'fraud-score',
 reconciliation: 'reconciliation',
 retention: 'retention',
 facebookCapi: 'facebook-capi',
 offerFeedSync: 'offer-feed-sync',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

const producers = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
 let q = producers.get(name);
 if (!q) {
 q = new Queue(name, { connection: makeQueueConnection() as unknown as ConnectionOptions });
 producers.set(name, q);
 }
 return q;
}
