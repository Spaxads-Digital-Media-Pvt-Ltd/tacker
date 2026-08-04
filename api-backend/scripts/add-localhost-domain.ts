/**
 * Dev convenience: register `localhost` + `127.0.0.1` as active/verified tracking domains for the
 * demo network so generated tracking links work against the local tracking surface (port stripped
 * by the host resolver, so http://localhost:4002/click resolves). Run: npm run dev:localhost-domain
 */
import { query, closeDb } from '../src/lib/db/pool.js';
import { logger } from '../src/lib/logger.js';

async function main(): Promise<void> {
  const net = (await query<{ id: string }>(`SELECT id FROM networks WHERE slug = 'demo'`)).rows[0];
  if (!net) throw new Error('demo network not found — run npm run seed first');
  for (const host of ['localhost', '127.0.0.1']) {
    await query(
      `INSERT INTO tracking_domains (network_id, host, mode, status, verification_state, ssl_status, is_primary)
       VALUES ($1, $2, 'subdomain', 'active', 'verified', 'issued', false)
       ON CONFLICT (lower(host)) DO UPDATE SET status = 'active', verification_state = 'verified'`,
      [net.id, host],
    );
    logger.info({ host }, 'local tracking domain ready');
  }
}

main().then(() => closeDb()).then(() => process.exit(0)).catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'failed');
  void closeDb().finally(() => process.exit(1));
});
