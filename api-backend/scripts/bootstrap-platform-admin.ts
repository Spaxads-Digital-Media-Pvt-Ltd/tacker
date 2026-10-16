/**
 * Create the first platform (Super Admin) login. Idempotent by email.
 * Usage: npm run bootstrap:admin -- <email> <password> [name]
 *        npm run bootstrap:admin -- <email> <new-password> --reset   (a new password for an existing one)
 *
 * Creates a platform_admins row with a local password_hash (crypto.scrypt). The person then
 * logs in via POST /platform/login to obtain an HS256-signed JWT scoped to PLATFORM_ADMIN_JWT_SECRET.
 * No Supabase Auth user is created — platform admin accounts are entirely local.
 *
 * The password must pass the same policy as sign-in (lib/auth/password-policy.ts — 12+ characters):
 * a shorter one used to be accepted here and could then never sign in.
 */
import { z } from 'zod';
import { query, closeDb } from '../src/lib/db/pool.js';
import { hashPassword } from '../src/lib/auth/platform-admin-password.js';
import { passwordSchema } from '../src/lib/auth/password-policy.js';
import { logger } from '../src/lib/logger.js';

const USAGE = 'Usage: npm run bootstrap:admin -- <email> <password> [name]   (add --reset to set a new password for an existing one)';

async function main(): Promise<void> {
 const args = process.argv.slice(2);
 const reset = args.includes('--reset');
 const [email, password, name] = args.filter((a) => a !== '--reset');
 if (!email || !password) throw new Error(USAGE);
 if (!z.string().email().safeParse(email).success) throw new Error(`"${email}" is not a valid email address.`);
 const policy = passwordSchema.safeParse(password);
 if (!policy.success) throw new Error(`${policy.error.issues[0]?.message ?? 'Password rejected.'} Sign-in refuses anything shorter, so it was not saved.`);

 const existing = await query<{ id: string }>(
 `SELECT id FROM platform_admins WHERE lower(email) = lower($1)`,
 [email],
 );
 const passwordHash = await hashPassword(password);
 if (existing.rows.length > 0) {
 if (!reset) {
 logger.info({ email }, 'platform admin already exists — nothing to do (add --reset to set a new password)');
 return;
 }
 await query(`UPDATE platform_admins SET password_hash = $2 WHERE id = $1`, [existing.rows[0]!.id, passwordHash]);
 logger.info({ email }, 'platform admin password reset');
 return;
 }
 if (reset) throw new Error(`No Super Admin with the email ${email} — run it without --reset to create one.`);

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
