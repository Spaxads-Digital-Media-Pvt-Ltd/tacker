/**
 * ClickHouse client (spec §2, §3B, §9, §10.1).
 *
 * One process-wide `createClient` from @clickhouse/client, lazily created the first
 * time a surface needs it. Caller code should never import the package directly —
 * always go through `getClickHouse()` so the singleton + lifecycle stays in this file.
 *
 * Why a singleton: the @clickhouse/client maintains its own connection pool with
 * keep-alive. Building a new client per surface would multiply connections and
 * defeat keep-alive. Surfaces that need an isolated client (rare — usually tests)
 * can call `createIsolatedClickHouseClient()` to get a fresh one and `closeClickHouse(c)`.
 *
 * Graceful degradation: `CLICKHOUSE_URL` is OPTIONAL in env. Until Phase 8 is wired,
 * the app boots without ClickHouse. Surfaces that need analytics must guard with
 * `isClickHouseEnabled()` before touching the client; calling `getClickHouse()`
 * without the URL configured throws a clear error.
 *
 * Production safety: URLs containing credentials are redacted by the pino logger's
 * `redact` paths (see lib/logger.ts). We never log the password in plain text.
 */
import {
 createClient,
 type ClickHouseClient,
 type ClickHouseClientConfigOptions,
} from '@clickhouse/client';
import { env } from '../../config/env.js';
import { logger } from '../logger.js';

let shared: ClickHouseClient | null = null;

export function isClickHouseEnabled(): boolean {
 return typeof env.CLICKHOUSE_URL === 'string' && env.CLICKHOUSE_URL.length > 0;
}

function buildConfig(): ClickHouseClientConfigOptions {
 if (!env.CLICKHOUSE_URL) {
 throw new Error(
 'ClickHouse is not configured: set CLICKHOUSE_URL in the environment. ' +
 'Guard callers with isClickHouseEnabled() if analytics is optional at runtime.',
 );
 }
 return {
 url: env.CLICKHOUSE_URL,
 database: env.CLICKHOUSE_DATABASE,
 username: env.CLICKHOUSE_USER,
 password: env.CLICKHOUSE_PASSWORD,
 request_timeout: env.CLICKHOUSE_REQUEST_TIMEOUT,
 max_open_connections: env.CLICKHOUSE_MAX_OPEN_CONNECTIONS,
 application: 'tracker-api-backend',
 // Keep connections warm — analytics writers are bursty.
 keep_alive: { enabled: true },
 };
}

export function getClickHouse(): ClickHouseClient {
 if (!shared) {
 shared = createClient(buildConfig());
 }
 return shared;
}

/**
 * Build a brand-new client with an explicit config. Caller owns the lifecycle and must
 * call `closeClickHouse(client)` when done. Used by tests and scripts that need isolation
 * from the shared singleton.
 */
export function createIsolatedClickHouseClient(
 configOverrides: Partial<ClickHouseClientConfigOptions> = {},
): ClickHouseClient {
 return createClient({ ...buildConfig(), ...configOverrides });
}

/**
 * Liveness check. Returns true if the server responds to a `SELECT 1` ping, false otherwise
 * (including when ClickHouse is not configured — surfaces that probe should treat false as
 * "degraded", not "error").
 */
export async function pingClickHouse(): Promise<boolean> {
 if (!isClickHouseEnabled()) return false;
 try {
 const result = await getClickHouse().ping();
 return result.success === true;
 } catch (err) {
 logger.error({ err }, 'clickhouse ping failed');
 return false;
 }
}

/**
 * Close the shared singleton. Idempotent — safe to call when the client was never
 * created. The @clickhouse/client `close()` flushes pending requests and releases the pool.
 */
export async function closeClickHouse(client?: ClickHouseClient): Promise<void> {
 const target = client ?? shared;
 if (target) {
 await target.close();
 if (target === shared) shared = null;
 }
}
