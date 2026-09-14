/**
 * Automated Postgres backup (production readiness — Section 3).
 *
 * Creates a compressed custom-format pg_dump, then prunes backups older than
 * BACKUP_RETENTION_DAYS. Designed to run from cron or an orchestrator (k8s CronJob).
 *
 * Env vars:
 * - DATABASE_URL — target database (required)
 * - BACKUP_DIR — directory for dump files (default: ./backups)
 * - BACKUP_RETENTION_DAYS — keep backups for this many days (default: 7)
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../config/env.js';
import { surfaceLogger } from '../logger.js';

const log = surfaceLogger('backup');
const BACKUP_DIR = resolve(process.cwd(), env.BACKUP_DIR ?? 'backups');
const RETENTION_DAYS = Number(env.BACKUP_RETENTION_DAYS ?? 7);

function timestamp(): string {
 return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function ensureDir(): void {
 if (!existsSync(BACKUP_DIR)) {
 mkdirSync(BACKUP_DIR, { recursive: true });
 }
}

function backupPath(): string {
 return resolve(BACKUP_DIR, `backup-${timestamp()}.dump`);
}

export async function runBackup(): Promise<{ path: string; sizeBytes: number }> {
 ensureDir();
 const path = backupPath();

 log.info({ path, db: env.DATABASE_URL?.replace(/\/\/.*@/, '//***@') }, 'starting postgres backup');

 try {
 execSync(
 `pg_dump --format=custom --compress=9 --no-owner --no-privileges --file="${path}" "${env.DATABASE_URL}"`,
 { stdio: ['pipe', 'pipe', 'pipe'], timeout: 0 },
 );
 } catch (err) {
 const msg = err instanceof Error ? err.message : String(err);
 log.error({ err: msg, path }, 'pg_dump failed');
 throw new Error(`backup failed: ${msg}`);
 }

 const size = statSync(path).size;
 log.info({ path, sizeBytes: size }, 'backup complete');

 return { path, sizeBytes: size };
}

export async function pruneOldBackups(): Promise<number> {
 if (!existsSync(BACKUP_DIR)) return 0;

 const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
 let pruned = 0;

 for (const file of readdirSync(BACKUP_DIR)) {
 const full = resolve(BACKUP_DIR, file);
 try {
 const st = statSync(full);
 if (st.mtimeMs < cutoff) {
 execSync(`rm "${full}"`, { stdio: 'ignore' });
 pruned++;
 log.info({ file, ageDays: Math.round((Date.now() - st.mtimeMs) / 86_400_000) }, 'pruned old backup');
 }
 } catch {
 // skip files we can't stat or delete
 }
 }

 return pruned;
}

async function main(): Promise<void> {
 try {
 const { sizeBytes } = await runBackup();
 const pruned = await pruneOldBackups();
 log.info({ sizeBytes, pruned, retentionDays: RETENTION_DAYS }, 'backup job complete');
 process.exit(0);
 } catch {
 process.exit(1);
 }
}

main();
