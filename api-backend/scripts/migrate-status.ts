/**
 * `npm run migrate:status` — show applied vs pending node-pg-migrate migrations.
 *
 * Reads the migration files from the configured directory and cross-references them against
 * the `pgmigrations` table. Outputs a simple status table so pre-deploy validation is
 * visible before applying migrations.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { query } from '../src/lib/db/pool.js';

const MIGRATIONS_DIR = 'migrations';

async function main(): Promise<void> {
 // Load applied migrations from the database
 const { rows: appliedRows } = await query<{ name: string }>(
 "SELECT name FROM pgmigrations ORDER BY name"
 );
 const applied = new Set(appliedRows.map((r) => r.name.replace(/\.sql$/, '')));

 // List migration files on disk
 const files = (await readdir(join(process.cwd(), MIGRATIONS_DIR)))
 .filter((f) => f.endsWith('.sql'))
 .sort();

 let pendingCount = 0;
 let appliedCount = 0;

 console.log('\nMigration status:\n');
 console.log(` Status Migration`);
 console.log(` -------- ------------------------------`);

 for (const file of files) {
 const name = file.replace(/\.sql$/, '');
 if (applied.has(name)) {
 console.log(` applied ${name}`);
 appliedCount++;
 } else {
 console.log(` pending ${name}`);
 pendingCount++;
 }
 }

 console.log(`\n${appliedCount} applied, ${pendingCount} pending out of ${files.length} total\n`);

 if (pendingCount > 0) {
 console.log('Run `npm run migrate` to apply pending migrations.');
 }
}

main().catch((err) => {
 console.error('migrate:status failed:', err);
 process.exit(1);
});
