/**
 * The default link domain through the API (INTEGRATION_DB=1): GET /api/tracking-domains marks it (`isDefault`) and
 * the offer links use it — never a disabled primary; the network's subdomain on the platform's tracking domain
 * (where the tracking server is live) beats other domains, and an active primary beats everything. (localhost /
 * 127.0.0.1 coming last is the pure ranking's test — test/offers/default-host.test.ts: those hosts are global rows.)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { liveHostFor } from '../../src/lib/tracking-domains/default-host.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('the default tracking domain (live DB)', () => {
  let fx: Fixture;
  let dash: Express;
  let admin: Record<string, string>;
  const tag = randomUUID().slice(0, 8);
  const addDomain = (host: string, over: { status?: string; primary?: boolean; mode?: string } = {}) => query(
    `INSERT INTO tracking_domains (network_id, host, mode, status, verification_state, is_primary) VALUES ($1, $2, $3, $4, 'verified', $5)`,
    [fx.networkA, host, over.mode ?? 'custom', over.status ?? 'active', over.primary ?? false]);
  const defaults = async () => ((await request(dash).get('/api/tracking-domains?limit=100').set(admin)).body.data as { host: string; isDefault: boolean }[])
    .filter((x) => x.isDefault).map((x) => x.host);
  const offerLink = async () => (await request(dash).get(`/api/offers/${fx.offerA}/links`).set(admin)).body.data.trackingUrl as string | null;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`tdd-${tag}`);
    dash = buildDashboardApp();
    admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
  });

  it('skips a disabled primary; the live domain, then an active primary, win; the offer links follow', async () => {
    await addDomain(`old-${tag}.example.org`, { primary: true, status: 'disabled', mode: 'subdomain' });
    expect(await defaults()).toEqual([]);
    expect(await offerLink()).toBeNull();

    await addDomain(`go-${tag}.example.com`);
    expect(await defaults()).toEqual([`go-${tag}.example.com`]);
    expect(await offerLink()).toBe(`https://go-${tag}.example.com/click?offer_id=${fx.offerA}`);

    const slug = (await query<{ slug: string }>('SELECT slug FROM networks WHERE id = $1', [fx.networkA])).rows[0]!.slug;
    const live = liveHostFor(slug)!;
    await addDomain(live, { mode: 'subdomain' });
    expect(await defaults()).toEqual([live]);
    expect(await offerLink()).toBe(`https://${live}/click?offer_id=${fx.offerA}`);

    const primary = `promo-${tag}.example.com`;
    await query('UPDATE tracking_domains SET is_primary = false WHERE network_id = $1', [fx.networkA]);
    await addDomain(primary, { primary: true });
    expect(await defaults()).toEqual([primary]);
    expect(await offerLink()).toBe(`https://${primary}/click?offer_id=${fx.offerA}`);
  });
});
