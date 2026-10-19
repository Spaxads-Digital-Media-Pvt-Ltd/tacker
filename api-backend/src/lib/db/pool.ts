import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg';
import { env, isProd } from '../../config/env.js';
import { logger } from '../logger.js';

/** A Supabase session pooler (Supavisor, port 5432) caps clients for the whole project (default pool_size 15). */
export const isSessionPooler = (url: string): boolean => {
 try {
 const u = new URL(url);
 return /\.pooler\.supabase\.com$/.test(u.hostname) && (u.port === '' || u.port === '5432');
 } catch {
 return false;
 }
};

/**
 * Connections per process: DB_POOL_MAX, else 3 on a Supabase session pooler (5 processes × 3 = its 15
 * clients — more and jobs fail with EMAXCONNSESSION), else 20 in production / 10 otherwise.
 */
export const poolMax = (url: string, explicit: number | undefined, prod: boolean): number =>
 explicit ?? (isSessionPooler(url) ? 3 : prod ? 20 : 10);

const sessionPooler = isSessionPooler(env.DATABASE_URL);
const config: PoolConfig = {
 connectionString: env.DATABASE_URL,
 max: poolMax(env.DATABASE_URL, env.DB_POOL_MAX, isProd),
 // On the session pooler an idle connection still holds one of its few clients: give it back sooner.
 idleTimeoutMillis: sessionPooler ? 10_000 : 30_000,
 connectionTimeoutMillis: sessionPooler ? 15_000 : 5_000,
 application_name: 'tracker-api-backend',
};

export const pool = new Pool(config);

pool.on('error', (err) => logger.error({ err }, 'pg pool error'));

// Report day/hour buckets are computed with an explicit zone — date_trunc(..., 'UTC') in the SQL —
// rather than a per-session SET TIME ZONE, which transaction-mode poolers (Supavisor/PgBouncer)
// don't preserve across queries.

export async function getPoolStats(): Promise<{ total: number; idle: number; waiting: number }> {
 return {
 total: pool.totalCount,
 idle: pool.idleCount,
 waiting: pool.waitingCount,
 };
}

export async function query<T extends QueryResultRow = QueryResultRow>(
 text: string,
 params?: readonly unknown[],
): Promise<{ rows: T[]; rowCount: number }> {
 const res = await pool.query<T>(text, params ? [...params] : undefined);
 return { rows: res.rows, rowCount: res.rowCount ?? 0 };
}

/** Runs `fn` in one transaction on one pooled connection: committed when it resolves, rolled back when it throws. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
 const client = await pool.connect();
 try {
 await client.query('BEGIN');
 const out = await fn(client);
 await client.query('COMMIT');
 return out;
 } catch (err) {
 await client.query('ROLLBACK').catch(() => undefined);
 throw err;
 } finally {
 client.release();
 }
}

export async function pingDb(): Promise<boolean> {
 try {
 await pool.query('SELECT 1');
 return true;
 } catch (err) {
 logger.error({ err }, 'db ping failed');
 return false;
 }
}

export async function closeDb(): Promise<void> {
 await pool.end();
}
