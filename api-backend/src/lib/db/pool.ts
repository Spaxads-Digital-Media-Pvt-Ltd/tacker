import { Pool, type PoolConfig, type QueryResultRow } from 'pg';
import { env, isProd } from '../../config/env.js';
import { logger } from '../logger.js';

const config: PoolConfig = {
 connectionString: env.DATABASE_URL,
 max: isProd ? 20 : 10,
 idleTimeoutMillis: 30_000,
 connectionTimeoutMillis: 5_000,
 application_name: 'tracker-api-backend',
};

export const pool = new Pool(config);

pool.on('error', (err) => logger.error({ err }, 'pg pool error'));

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
