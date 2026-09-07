/**
 * Background workers surface (spec §2.1 #4). No public HTTP surface — just a tiny /health probe
 * so orchestrators can liveness-check the container. Drains BullMQ queues and runs scheduled
 * jobs. Phase 0 registers no processors yet; it stands the process up and reports health.
 */
import { createServer } from 'node:http';
import { env } from '../../config/env.js';
import { surfaceLogger } from '../../lib/logger.js';
import { buildHealthReport } from '../../lib/http/health.js';
import { closeDb } from '../../lib/db/pool.js';
import { closeRedis } from '../../lib/redis.js';
import { metricsText, metricsContentType, queueDepth } from '../../lib/metrics.js';
import { initSentry, flushSentry, captureError } from '../../lib/observability/sentry.js';
import { QUEUE, getQueue, type QueueName } from './queues.js';
import { startClickPersistWorker } from './processors/click-persist.js';
import { startOutboundPostbackWorker } from './processors/outbound-postback.js';
import { startFraudScanWorker, scheduleFraudScan } from './processors/fraud-scan.js';
import { startRetentionWorker, scheduleRetention } from './processors/retention.js';
import { startFacebookCapiWorker } from './processors/facebook-capi.js';
import { startOfferFeedSyncWorker, scheduleOfferFeedScan } from './processors/offer-feed-sync.js';

const log = surfaceLogger('workers');

void initSentry('workers'); // no-op unless SENTRY_DSN is set

// Phase 2: click persistence. Phase 3: outbound postbacks. Phase 6: fraud scan. Phase 8: retention.
const workers = [
  startClickPersistWorker(),
  startOutboundPostbackWorker(),
  startFraudScanWorker(),
  startRetentionWorker(),
  startFacebookCapiWorker(),
  startOfferFeedSyncWorker(),
];
void scheduleFraudScan().catch((err) => log.error({ err }, 'failed to schedule fraud scan'));
void scheduleRetention().catch((err) => log.error({ err }, 'failed to schedule retention'));
void scheduleOfferFeedScan().catch((err) => log.error({ err }, 'failed to schedule offer feed scan'));

// Report only EXHAUSTED-retry failures to Sentry so transient retries don't spam it.
for (const w of workers) {
  w.on('failed', (job, err) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      captureError(err, { queue: w.name, jobId: job.id, attempts: job.attemptsMade });
    }
  });
}

// Sample queue backlogs into the gauge so /metrics reflects live depth (spec §2/§3B). waiting +
// active + delayed is the "work not yet done" signal Prometheus alerts on.
const QUEUE_NAMES = Object.values(QUEUE) as QueueName[];
const sampleQueueDepth = async (): Promise<void> => {
  for (const name of QUEUE_NAMES) {
    try {
      const c = await getQueue(name).getJobCounts('waiting', 'active', 'delayed');
      queueDepth.set({ queue: name }, (c.waiting ?? 0) + (c.active ?? 0) + (c.delayed ?? 0));
    } catch (err) {
      log.debug({ err, name }, 'queue depth sample failed');
    }
  }
};
const depthTimer = setInterval(() => void sampleQueueDepth(), 15_000);
depthTimer.unref();

const probe = createServer((req, res) => {
  if (req.url === '/health') {
    void buildHealthReport('workers').then((report) => {
      res.writeHead(report.status === 'ok' ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify(report));
    });
    return;
  }
  if (req.url === '/metrics') {
    void sampleQueueDepth()
      .then(() => metricsText())
      .then((body) => {
        res.writeHead(200, { 'content-type': metricsContentType });
        res.end(body);
      });
    return;
  }
  res.writeHead(404).end();
});

probe.listen(env.PORT_WORKERS_HEALTH, () => {
  log.info({ port: env.PORT_WORKERS_HEALTH }, 'workers up (health probe listening)');
});

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down workers');
  clearInterval(depthTimer);
  probe.close();
  await Promise.allSettled([...workers.map((w) => w.close()), flushSentry(), closeDb(), closeRedis()]);
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
