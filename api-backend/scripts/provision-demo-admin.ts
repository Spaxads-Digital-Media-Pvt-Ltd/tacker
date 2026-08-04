/** One-off: provision a login for the seeded 'demo' network admin. Idempotent-ish. */
import { query, closeDb } from '../src/lib/db/pool.js';
import { provisionAdmin } from '../src/lib/provisioning.js';
import { getSupabaseAdmin } from '../src/lib/supabase.js';
import { logger } from '../src/lib/logger.js';

async function main(): Promise<void> {
  const email = 'demo-admin@tracker.test';
  const password = 'DemoPass123!';
  const net = (await query<{ id: string }>(`SELECT id FROM networks WHERE slug = 'demo'`)).rows[0];
  if (!net) throw new Error('demo network not found — run npm run seed first');
  // Always (re)stamp the admin's claims to the CURRENT demo network id so a re-seed can't
  // leave the login pointing at a stale/deleted network.

  let authUserId: string;
  try {
    authUserId = await provisionAdmin({ email, password, networkId: net.id, role: 'admin' });
  } catch {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase.auth.admin.listUsers();
    const found = data.users.find((u) => u.email?.toLowerCase() === email);
    if (!found) throw new Error('could not provision or find admin');
    await supabase.auth.admin.updateUserById(found.id, {
      app_metadata: { kind: 'admin', network_id: net.id, role: 'admin' },
    });
    authUserId = found.id;
  }

  await query(
    `INSERT INTO users (network_id, auth_user_id, email, name, role, status)
     VALUES ($1, $2, $3, 'Admin', 'admin', 'active')
     ON CONFLICT (network_id, lower(email)) DO NOTHING`,
    [net.id, authUserId, email],
  );
  // Display name for the SPA topbar (the login payload carries user_metadata.name).
  try { await getSupabaseAdmin().auth.admin.updateUserById(authUserId, { user_metadata: { name: 'Admin' } }); }
  catch { /* non-fatal */ }
  logger.info({ email, password }, 'demo admin ready');
}

main().then(() => closeDb()).then(() => process.exit(0)).catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'failed');
  void closeDb().finally(() => process.exit(1));
});
