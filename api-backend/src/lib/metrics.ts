/**
 * Prometheus metrics (spec §2 observability, §3B budgets). One shared registry; each surface
 * exposes it at GET /metrics for Prometheus to scrape and Grafana to chart. Tracks the KPIs the
 * spec calls out: click throughput, redirect latency p50/p95/p99, postback success rate, queue
 * depth. Latency budget regressions are visible here (spec §3B).
 */
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';
import { BRAND } from '../config/branding.js';

export const registry = new Registry();
registry.setDefaultLabels({ app: BRAND.slug });
collectDefaultMetrics({ register: registry });

/** Click hot-path throughput, split by outcome (redirect / divert / error). */
export const clicksTotal = new Counter({
  name: 'tracker_clicks_total',
  help: 'Click endpoint hits by outcome',
  labelNames: ['outcome'],
  registers: [registry],
});

/** Server-side redirect latency (the §5 hot-path budget). Buckets tuned to a <30ms p95 target. */
export const redirectLatency = new Histogram({
  name: 'tracker_click_redirect_seconds',
  help: 'Click endpoint server-side latency in seconds',
  buckets: [0.001, 0.005, 0.01, 0.02, 0.03, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
});

/** Outbound postback deliveries by result (success/failure) — spec §6 delivery health. */
export const postbackDeliveries = new Counter({
  name: 'tracker_postback_deliveries_total',
  help: 'Outbound postback deliveries by result',
  labelNames: ['result'],
  registers: [registry],
});

/** BullMQ queue depth, sampled by the workers surface. */
export const queueDepth = new Gauge({
  name: 'tracker_queue_depth',
  help: 'Pending jobs per queue',
  labelNames: ['queue'],
  registers: [registry],
});

/** Generic HTTP request duration for the Express surfaces. */
export const httpDuration = new Histogram({
  name: 'tracker_http_request_seconds',
  help: 'HTTP request duration by surface/method/status',
  labelNames: ['surface', 'method', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

export async function metricsText(): Promise<string> {
  return registry.metrics();
}
export const metricsContentType = registry.contentType;
