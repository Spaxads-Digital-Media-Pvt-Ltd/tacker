/** Provision demo publisher + advertiser PORTAL logins for the seeded demo network. */
import { query, closeDb } from '../src/lib/db/pool.js';
import { provisionPortalUser } from '../src/lib/provisioning.js';
import { getSupabaseAdmin } from '../src/lib/supabase.js';
import { logger } from '../src/lib/logger.js';

async function ensurePortalLogin(
  email: string,
  password: string,
  networkId: string,
  kind: 'publisher' | 'advertiser',
  ownerId: string,
): Promise<void> {
  let authUserId: string;
  try {
    authUserId = await provisionPortalUser({ email, password, networkId, kind, ownerId });
  } catch {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase.auth.admin.listUsers();
    const found = data.users.find((u) => u.email?.toLowerCase() === email);
    if (!found) throw new Error(`could not provision ${email}`);
    await supabase.auth.admin.updateUserById(found.id, {
      app_metadata: { kind, network_id: networkId, owner_id: ownerId },
    });
    authUserId = found.id;
  }
  const table = kind === 'publisher' ? 'publishers' : 'advertisers';
  await query(`UPDATE ${table} SET auth_user_id = $1 WHERE id = $2`, [authUserId, ownerId]);
  logger.info({ email, kind }, 'portal login ready');
}

async function main(): Promise<void> {
  const net = (await query<{ id: string }>(`SELECT id FROM networks WHERE slug = 'demo'`)).rows[0];
  if (!net) throw new Error('demo network not found — run npm run seed first');

  const pub = (await query<{ id: string }>(
    `SELECT id FROM publishers WHERE network_id = $1 AND name = 'TrafficCo'`, [net.id])).rows[0];
  const adv = (await query<{ id: string }>(
    `SELECT id FROM advertisers WHERE network_id = $1 AND name = 'Acme Corp'`, [net.id])).rows[0];
  if (!pub || !adv) throw new Error('demo publisher/advertiser not found — run npm run seed');

  await ensurePortalLogin('publisher@tracker.test', 'PubPass123!', net.id, 'publisher', pub.id);
  await ensurePortalLogin('advertiser@tracker.test', 'AdvPass123!', net.id, 'advertiser', adv.id);
}

main().then(() => closeDb()).then(() => process.exit(0)).catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'failed');
  void closeDb().finally(() => process.exit(1));
});
