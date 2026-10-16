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
 domainVerify: 'domain-verify',
 scheduledActions: 'scheduled-actions',
 alertRules: 'alert-rules',
 smartSwitch: 'smartswitch',
 automationWebhook: 'automation-webhook',
 smartLinkKpi: 'smart-link-kpi',
 reportingRollup: 'reporting-rollup',
 scheduledReports: 'scheduled-reports',
 usageMeter: 'usage-meter',
 platformBilling: 'platform-billing',
 platformHealth: 'platform-health',
 platformSupport: 'platform-support',
 email: 'email',
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
