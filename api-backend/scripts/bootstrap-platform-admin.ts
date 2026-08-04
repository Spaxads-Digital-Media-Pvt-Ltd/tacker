/**
 * Create the first platform (Super Admin) login. Idempotent by email.
 * Usage: npm run bootstrap:admin -- <email> <password> [name]
 *
 * Creates a Supabase Auth user with app_metadata.kind='platform_admin' and a linked
 * platform_admins row. The person then logs in through Supabase Auth to get a JWT the
 * platform surface accepts.
 */
import { query, closeDb } from '../src/lib/db/pool.js';
import { provisionPlatformAdmin } from '../src/lib/provisioning.js';
import { getSupabaseAdmin } from '../src/lib/supabase.js';
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

  // Reuse an existing Auth user if one already has this email; else provision a new one.
  let authUserId: string;
  try {
    authUserId = await provisionPlatformAdmin({ email, password });
  } catch (err) {
    // If the auth user already exists, look it up and stamp the claim instead of failing.
    const supabase = getSupabaseAdmin();
    const { data } = await supabase.auth.admin.listUsers();
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!found) throw err;
    await supabase.auth.admin.updateUserById(found.id, { app_metadata: { kind: 'platform_admin' } });
    authUserId = found.id;
  }

  await query(
    `INSERT INTO platform_admins (auth_user_id, email, name, status) VALUES ($1, $2, $3, 'active')`,
    [authUserId, email, name ?? null],
  );
  logger.info({ email, authUserId }, 'platform admin created');
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : err }, 'bootstrap failed');
    void closeDb().finally(() => process.exit(1));
  });
