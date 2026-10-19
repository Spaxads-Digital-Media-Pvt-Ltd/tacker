/**
 * Dev convenience: register `localhost` + `127.0.0.1` as active/verified tracking domains for a network
 * (the seeded demo one by default) so generated tracking links work against the local tracking surface
 * (port stripped by the host resolver, so http://localhost:4002/click resolves).
 * Run: npm run dev:localhost-domain [-- <network-slug>]   (also runs with `npm run dev`)
 */
import { query, closeDb } from '../src/lib/db/pool.js';
import { logger } from '../src/lib/logger.js';

async function main(): Promise<void> {
  const slug = process.argv[2] ?? 'demo';
  const net = (await query<{ id: string }>(`SELECT id FROM networks WHERE slug = $1`, [slug])).rows[0];
  if (!net) {
    // Not a failure: a database without the seeded demo network (e.g. a fresh one) just has nothing to do.
    logger.info({ slug }, `skipped — no network "${slug}" in this database. For yours: npm run dev:localhost-domain -- <your-network-slug>`);
    return;
  }
  for (const host of ['localhost', '127.0.0.1']) {
    await query(
      `INSERT INTO tracking_domains (network_id, host, mode, status, verification_state, ssl_status, is_primary)
       VALUES ($1, $2, 'subdomain', 'active', 'verified', 'issued', false)
       ON CONFLICT (lower(host)) DO UPDATE SET status = 'active', verification_state = 'verified'`,
      [net.id, host],
    );
    logger.info({ host, slug }, 'local tracking domain ready');
  }
}

main().then(() => closeDb()).then(() => process.exit(0)).catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'failed');
  void closeDb().finally(() => process.exit(1));
});
