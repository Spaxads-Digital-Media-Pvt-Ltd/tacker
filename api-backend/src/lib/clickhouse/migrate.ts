/**
 * ClickHouse schema migration runner.
 *
 * Reads every *.sql file from <repoRoot>/clickhouse/migrations/ in lexicographic order and
 * executes it against the ClickHouse instance via getClickHouse(). DDL is idempotent
 * (IF NOT EXISTS) so re-running after a partial failure is safe.
 *
 * CLI entry: src/lib/clickhouse/cli-migrate.ts
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getClickHouse, isClickHouseEnabled, pingClickHouse } from './client.js';
import { logger } from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function migrationsDir(): string {
 return resolve(__dirname, '..', '..', '..', 'clickhouse', 'migrations');
}

export async function runMigrations(): Promise<void> {
 if (!isClickHouseEnabled()) {
 throw new Error('ClickHouse is not configured (CLICKHOUSE_URL unset).');
 }

 const ok = await pingClickHouse();
 if (!ok) {
 throw new Error('ClickHouse ping failed — cannot run migrations.');
 }

 const dir = migrationsDir();
 const entries = await readdir(dir);
 const files = entries.filter((f) => f.endsWith('.sql')).sort((a, b) => a.localeCompare(b));

 if (files.length === 0) {
 logger.info('[ch-migrate] No migrations to run.');
 return;
 }

 const client = getClickHouse();

 for (const file of files) {
 const sql = await readFile(join(dir, file), 'utf-8');
 const trimmed = sql.trim();
 if (!trimmed) continue;

 logger.info({ file, bytes: trimmed.length }, '[ch-migrate] applying migration');
 try {
 await client.command({ query: trimmed });
 logger.info({ file }, '[ch-migrate] applied');
 } catch (err) {
 logger.error({ err, file }, '[ch-migrate] failed');
 throw err;
 }
 }

 logger.info({ count: files.length }, '[ch-migrate] complete');
}
