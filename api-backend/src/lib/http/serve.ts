/**
 * Uniform HTTP listen + graceful shutdown for Express surfaces. Ensures pools/redis close
 * cleanly so no connection leaks between deploys.
 */
import type { Express } from 'express';
import type { Server } from 'node:http';
import { surfaceLogger } from '../logger.js';
import { closeDb } from '../db/pool.js';
import { closeRedis } from '../redis.js';
import { initSentry, flushSentry } from '../observability/sentry.js';

export function serve(app: Express, port: number, surface: string): Server {
  const log = surfaceLogger(surface);
  void initSentry(surface); // no-op unless SENTRY_DSN is set
  const server = app.listen(port, () => log.info({ port }, `${surface} listening`));

  const shutdown = (signal: string) => {
    log.info({ signal }, 'shutting down');
    server.close(async () => {
      await Promise.allSettled([flushSentry(), closeDb(), closeRedis()]);
      process.exit(0);
    });
    // Force-exit if graceful close hangs.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}
