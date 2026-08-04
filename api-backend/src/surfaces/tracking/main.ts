import { env } from '../../config/env.js';
import { surfaceLogger } from '../../lib/logger.js';
import { closeDb } from '../../lib/db/pool.js';
import { closeRedis } from '../../lib/redis.js';
import { initGeoIp } from '../../lib/geo/geoip.js';
import { initSentry, flushSentry } from '../../lib/observability/sentry.js';
import { setHostResolver } from '../../middleware/host-resolver.js';
import { DbHostResolver } from './host-resolver-db.js';
import { buildTrackingApp } from './app.js';

const log = surfaceLogger('tracking');

async function start(): Promise<void> {
  await initSentry('tracking'); // no-op unless SENTRY_DSN is set
  await initGeoIp(); // load the MaxMind db once (fail-open if absent)
  setHostResolver(new DbHostResolver()); // real tenant resolution (Redis-cached)

  const app = buildTrackingApp();
  await app.listen({ port: env.PORT_TRACKING, host: '0.0.0.0' });
  log.info({ port: env.PORT_TRACKING }, 'tracking listening');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    await app.close();
    await Promise.allSettled([flushSentry(), closeDb(), closeRedis()]);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

start().catch((err) => {
  log.error({ err }, 'tracking failed to start');
  process.exit(1);
});
