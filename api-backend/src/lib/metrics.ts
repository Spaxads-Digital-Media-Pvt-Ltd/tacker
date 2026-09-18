import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';
import { BRAND } from '../config/branding.js';

export const registry = new Registry();
registry.setDefaultLabels({ app: BRAND.slug });
collectDefaultMetrics({ register: registry });

export const clicksTotal = new Counter({
 name: 'tracker_clicks_total',
 help: 'Click endpoint hits by outcome',
 labelNames: ['outcome'],
 registers: [registry],
});

export const redirectLatency = new Histogram({
 name: 'tracker_click_redirect_seconds',
 help: 'Click endpoint server-side latency in seconds',
 buckets: [0.001, 0.005, 0.01, 0.02, 0.03, 0.05, 0.1, 0.25, 0.5, 1],
 registers: [registry],
});

export const postbackDeliveries = new Counter({
 name: 'tracker_postback_deliveries_total',
 help: 'Outbound postback deliveries by result',
 labelNames: ['result'],
 registers: [registry],
});

export const queueDepth = new Gauge({
 name: 'tracker_queue_depth',
 help: 'Pending jobs per queue',
 labelNames: ['queue'],
 registers: [registry],
});

export const httpDuration = new Histogram({
 name: 'tracker_http_request_seconds',
 help: 'HTTP request duration by surface/method/status',
 labelNames: ['surface', 'method', 'status'],
 buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
 registers: [registry],
});

export const poolStats = new Gauge({
 name: 'tracker_pg_pool',
 help: 'Postgres pool active/idle/waiting connections',
 labelNames: ['state'],
 registers: [registry],
});

export async function metricsText(): Promise<string> {
 return registry.metrics();
}
export const metricsContentType = registry.contentType;
