/**
 * Create the first platform (Super Admin) login. Idempotent by email.
 * Usage: npm run bootstrap:admin -- <email> <password> [name]
 *
 * Creates a platform_admins row with a local password_hash (crypto.scrypt). The person then
 * logs in via POST /platform/login to obtain an HS256-signed JWT scoped to PLATFORM_ADMIN_JWT_SECRET.
 * No Supabase Auth user is created — platform admin accounts are entirely local.
 */
import { query, closeDb } from '../src/lib/db/pool.js';
import { hashPassword } from '../src/lib/auth/platform-admin-password.js';
import { logger } from '../src/lib/logger.js';

async function main(): Promise<void> {
 const [email, password, name] = process.argv.slice(2);
 if (!email || !password) {
 throw new Error('Usage: npm run bootstrap:admin -- <email> <password> [name]');
 }

 const existing = await query<{ id: string }>(
 `SELECT id FROM platform_admins WHERE lower(email) = lower($1)`,
 [email],
 );
 if (existing.rows.length > 0) {
 logger.info({ email }, 'platform admin already exists — nothing to do');
 return;
 }

 const passwordHash = await hashPassword(password);

 await query(
 `INSERT INTO platform_admins (email, name, status, password_hash, auth_provider)
 VALUES ($1, $2, 'active', $3, 'local')`,
 [email, name ?? null, passwordHash],
 );
 logger.info({ email }, 'platform admin created (local auth)');
}

main()
 .then(() => closeDb())
 .then(() => process.exit(0))
 .catch((err) => {
 logger.error({ err: err instanceof Error ? err.message : err }, 'bootstrap failed');
 void closeDb().finally(() => process.exit(1));
 });
