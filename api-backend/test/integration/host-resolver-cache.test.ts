/**
 * The tracking host cache is case-insensitive (live DB + Redis, INTEGRATION_DB=1): a Host header in any
 * case (or with a trailing dot) shares one cache entry, so disabling the domain (invalidateHost) stops
 * it at once — a mixed-case entry used to keep resolving for up to 5 minutes.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DbHostResolver, invalidateHost } from '../../src/surfaces/tracking/host-resolver-db.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture } from '../helpers/db.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('tracking host cache (live DB + Redis)', () => {
  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
  });

  it('any case / a trailing dot resolves the same domain, and disabling it stops them all at once', async () => {
    const fx = await seedFixture(`hostc-${randomUUID().slice(0, 8)}`);
    const host = `links-${randomUUID().slice(0, 8)}.example.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    const r = new DbHostResolver();
    for (const h of [host.toUpperCase(), `${host}.`, host]) expect((await r.resolve(h))?.networkId, h).toBe(fx.networkA);

    await query(`UPDATE tracking_domains SET status = 'disabled' WHERE host = $1`, [host]);
    await invalidateHost(host);
    for (const h of [host.toUpperCase(), `${host.toUpperCase()}.`, host]) expect(await r.resolve(h), h).toBeNull();
  });
});
