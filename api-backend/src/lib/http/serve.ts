/**
 * Uniform HTTP listen + graceful shutdown for Express surfaces. Ensures pools/redis/CH close
 * cleanly so no connection leaks between deploys.
 */
import type { Express } from 'express';
import type { Server } from 'node:http';
import { surfaceLogger } from '../logger.js';
import { closeDb } from '../db/pool.js';
import { closeRedis } from '../redis.js';
import { closeClickHouse, isClickHouseEnabled } from '../clickhouse/client.js';
import { initSentry, flushSentry } from '../observability/sentry.js';

export function serve(app: Express, port: number, surface: string): Server {
 const log = surfaceLogger(surface);
 void initSentry(surface); // no-op unless SENTRY_DSN is set
 const server = app.listen(port, () => log.info({ port }, `${surface} listening`));

 const shutdown = (signal: string) => {
 log.info({ signal }, 'shutting down');
 server.close(async () => {
 const closers: Array<Promise<unknown>> = [flushSentry(), closeDb(), closeRedis()];
 if (isClickHouseEnabled()) {
 // closeClickHouse() is idempotent — safe to call even if the singleton was never created.
 closers.push(closeClickHouse().catch((err) => log.error({ err }, 'clickhouse close failed')));
 }
 await Promise.allSettled(closers);
 process.exit(0);
 });
 // Force-exit if graceful close hangs.
 setTimeout(() => process.exit(1), 10_000).unref();
 };

 process.on('SIGTERM', () => shutdown('SIGTERM'));
 process.on('SIGINT', () => shutdown('SIGINT'));
 return server;
}
