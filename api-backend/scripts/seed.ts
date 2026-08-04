/**
 * Dev seed (spec §1 "seed/test data"). Creates one demo network with an admin user, an
 * advertiser, two publishers, an active offer with a geo rule + a publisher access grant, and a
 * subdomain tracking domain. Idempotent by network slug. NOT for production.
 *
 * Run: npm run seed   (requires DATABASE_URL to a migrated DB)
 */
import { pool, query, closeDb } from '../src/lib/db/pool.js';
import { logger } from '../src/lib/logger.js';
import { env } from '../src/config/env.js';

const SLUG = 'demo';
// Fixed id so re-seeds keep the same network and provisioned logins' claims stay valid.
const DEMO_NETWORK_ID = '00000000-0000-4000-8000-000000000001';

async function main(): Promise<void> {
  const existing = await query<{ id: string }>(`SELECT id FROM networks WHERE slug = $1`, [SLUG]);
  if (existing.rows.length > 0) {
    logger.info({ slug: SLUG }, 'demo network already seeded — nothing to do');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const net = (await client.query<{ id: string }>(
      `INSERT INTO networks (id, name, slug, default_currency) VALUES ($1, 'Demo Network', $2, 'USD') RETURNING id`,
      [DEMO_NETWORK_ID, SLUG],
    )).rows[0]!;

    await client.query(
      `INSERT INTO users (network_id, email, name, role, status) VALUES ($1, 'owner@demo.test', 'Demo Owner', 'admin', 'active')`,
      [net.id],
    );

    const adv = (await client.query<{ id: string }>(
      `INSERT INTO advertisers (network_id, name, status, default_currency) VALUES ($1, 'Acme Corp', 'active', 'USD') RETURNING id`,
      [net.id],
    )).rows[0]!;

    const pub1 = (await client.query<{ id: string }>(
      `INSERT INTO publishers (network_id, name, status) VALUES ($1, 'TrafficCo', 'active') RETURNING id`,
      [net.id],
    )).rows[0]!;
    await client.query(
      `INSERT INTO publishers (network_id, name, status) VALUES ($1, 'MediaBuyers', 'pending')`,
      [net.id],
    );

    const offer = (await client.query<{ id: string }>(
      `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, payout_model,
         default_payout, default_revenue, currency, daily_conversion_cap)
       VALUES ($1, $2, 'Acme US CPA', 'active', 'https://acme.test/lp?cid={click_id}', 'CPA',
         5.0000, 8.0000, 'USD', 200) RETURNING id`,
      [net.id, adv.id],
    )).rows[0]!;

    await client.query(
      `INSERT INTO offer_geo_rules (network_id, offer_id, country, action) VALUES ($1, $2, 'US', 'allow')`,
      [net.id, offer.id],
    );
    await client.query(
      `INSERT INTO offer_publisher_access (network_id, offer_id, publisher_id, access, approval_status)
       VALUES ($1, $2, $3, 'allow', 'approved')`,
      [net.id, offer.id, pub1.id],
    );

    await client.query(
      `INSERT INTO tracking_domains (network_id, host, mode, status, verification_state, ssl_status, is_primary)
       VALUES ($1, $2, 'subdomain', 'active', 'verified', 'issued', true)`,
      [net.id, `${SLUG}.${env.TRACKING_BASE_DOMAIN}`],
    );

    await client.query('COMMIT');
    logger.info({ networkId: net.id }, 'seeded demo network');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'seed failed');
    void closeDb().finally(() => process.exit(1));
  });
