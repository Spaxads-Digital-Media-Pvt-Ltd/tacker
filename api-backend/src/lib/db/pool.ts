/**
 * Postgres connection pool (spec §2). Thin `pg` layer — NO ORM on the hot path (spec §2).
 * DATABASE_URL points at the Compose Postgres in local dev, or the Supabase POOLER endpoint
 * (tuned for concurrency — spec §3B) in staging/prod.
 *
 * IMPORTANT: application code should almost never import `pool` directly. Go through
 * `ScopedDb` (./scoped-db) so every query carries tenant (+ owner) scope by construction.
 */
import { Pool, type PoolConfig, type QueryResultRow } from 'pg';
import { env, isProd } from '../../config/env.js';
import { logger } from '../logger.js';

const config: PoolConfig = {
  connectionString: env.DATABASE_URL,
  // Conservative defaults; tune per-surface at deploy (hot path vs. admin) — spec §3B.
  max: isProd ? 20 : 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'tracker-api-backend',
};

export const pool = new Pool(config);

pool.on('error', (err) => logger.error({ err }, 'pg pool error'));

/**
 * Low-level query. Prefer ScopedDb. Exposed for migrations-adjacent tooling, health checks,
 * and the internal implementation of ScopedDb.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: readonly unknown[],
): Promise<{ rows: T[]; rowCount: number }> {
  const res = await pool.query<T>(text, params ? [...params] : undefined);
  return { rows: res.rows, rowCount: res.rowCount ?? 0 };
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
