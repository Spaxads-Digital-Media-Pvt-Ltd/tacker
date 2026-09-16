/** Test DB helpers: connectivity probe, reset, and a two-network fixture for isolation tests. */
import { pool, query } from '../../src/lib/db/pool.js';

let suffixSeq = 0;
function nextSuffix(): string {
  suffixSeq++;
  return String(suffixSeq);
}

export async function canConnect(): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch {
      if (attempt < 4) await new Promise((r) => setTimeout(r, 250));
    }
  }
  return false;
}

const TABLES = [
  'offer_publisher_access',
  'offer_geo_rules',
  'offers',
  'tracking_domains',
  'publishers',
  'advertisers',
  'audit_log',
  'users',
  'networks',
  // Ledger tables — appended by ledger test (spec §8). resetDb must clear idempotency keys
  // so that writeConversionLedger can insert fresh entries on every test run.
  'payout_batches',
  'payouts',
  'ledger_entries',
];

function assertDestructiveAllowed(): void {
  let dbName = '';
  try {
    dbName = new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, '');
  } catch {
    /* ignore */
  }
  if (!/test/i.test(dbName) && process.env.ALLOW_DESTRUCTIVE_TESTS !== '1') {
    throw new Error(
      `Refusing to TRUNCATE non-test database "${dbName}". Point DATABASE_URL at a dedicated ` +
        `test database (name containing "test") or set ALLOW_DESTRUCTIVE_TESTS=1 to override.`,
    );
  }
}

export async function resetDb(): Promise<void> {
  assertDestructiveAllowed();
  await query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

export interface Fixture {
  networkA: string;
  networkB: string;
  advA: string;
  advB: string;
  pubA1: string;
  pubA2: string;
  pubB1: string;
  offerA: string;
}

async function insertReturningId(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await query<{ id: string }>(sql, params);
  return rows[0]!.id;
}

export async function seedFixture(suffix?: string): Promise<Fixture> {
  const sfx = suffix ?? 's' + String(nextSuffix());
  const networkA = await insertReturningId(
    `INSERT INTO networks (name, slug) VALUES ($1, $2) RETURNING id`,
    ['Net A ' + sfx, 'net-a-' + sfx]);
  const networkB = await insertReturningId(
    `INSERT INTO networks (name, slug) VALUES ($1, $2) RETURNING id`,
    ['Net B ' + sfx, 'net-b-' + sfx]);

  const advA = await insertReturningId(
    `INSERT INTO advertisers (network_id, name) VALUES ($1, $2) RETURNING id`,
    [networkA, 'Adv A']);
  const advB = await insertReturningId(
    `INSERT INTO advertisers (network_id, name) VALUES ($1, $2) RETURNING id`,
    [networkB, 'Adv B']);

  const pubA1 = await insertReturningId(
    `INSERT INTO publishers (network_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
    [networkA, 'Pub A1']);
  const pubA2 = await insertReturningId(
    `INSERT INTO publishers (network_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
    [networkA, 'Pub A2']);
  const pubB1 = await insertReturningId(
    `INSERT INTO publishers (network_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
    [networkB, 'Pub B1']);

  const offerA = await insertReturningId(
    `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, default_payout, default_revenue)
     VALUES ($1, $2, $3, 'active', 'https://example.com/{click_id}', 5.0000, 8.0000) RETURNING id`,
    [networkA, advA, 'Offer A ' + sfx]);

  await query(
    `INSERT INTO offer_publisher_access (network_id, offer_id, publisher_id, access, approval_status)
     VALUES ($1, $2, $3, 'allow', 'approved')`,
    [networkA, offerA, pubA1]);

  return { networkA, networkB, advA, advB, pubA1, pubA2, pubB1, offerA };
}
