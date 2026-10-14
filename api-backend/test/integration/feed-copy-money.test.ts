/**
 * Offer feed + copies + exact money (O7, O9) — live DB, the feed's HTTP fetch mocked.
 *
 * O9: feed amounts are parsed exactly (the JSON number's own text, exponent notation too) and rounded
 * half-up to 4 dp; an offer whose amount isn't a usable decimal is SKIPPED and reported — never
 * imported with a made-up 0. A re-sync keeps the offer's own settings (it used to replace metadata).
 * The public API's margin is exact (it used to be JS floats: 0.3 − 0.1 − 0.2 came out "-0.0000").
 * O7: a copied offer is independent — it doesn't inherit the feed link, so the next sync updates the
 * original and leaves the copy alone.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

const feed = vi.hoisted(() => ({ body: '[]' }));
vi.mock('../../src/lib/net/safe-http.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/net/safe-http.js')>();
  return { ...actual, safeRequest: async () => ({ status: 200, body: feed.body }) };
});

import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { buildPublicApiApp } from '../../src/surfaces/public-api/app.js';
import { syncOfferFeed } from '../../src/lib/integrations/offer-feed-sync.js';
import { loadIntegrations, saveIntegrations } from '../../src/lib/integrations/settings.js';
import { generateApiKey, AUDIENCE_SCOPES } from '../../src/lib/apikeys/keys.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('offer feed, copies and exact money (live DB, mocked feed)', () => {
  let dash: Express;
  let fx: Fixture;
  let admin: Record<string, string>;
  const tag = randomUUID().slice(0, 6);
  const offerByFeedId = async (feedId: string) => (await query<{ id: string; default_payout: string; default_revenue: string; metadata: Record<string, unknown> }>(
    `SELECT id, default_payout::text, default_revenue::text, metadata FROM offers WHERE network_id = $1 AND metadata->>'feedExternalId' = $2`, [fx.networkA, feedId])).rows;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`feed-${tag}`);
    dash = buildDashboardApp();
    admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
    await saveIntegrations(fx.networkA, { offerFeedUrl: 'https://feeds.example.com/offers.json', offerFeedAdvertiserId: fx.advA });
  });
  beforeEach(() => { feed.body = '[]'; });

  it('amounts are exact (source text, exponents); a bad amount skips that offer and is reported', async () => {
    // Written as raw JSON on purpose: these numbers lose digits once parsed into a double.
    feed.body = `[
      {"id":"${tag}-a","name":"A","url":"https://a.example.com/?c={click_id}","payout":12.34567890123456789,"revenue":"20.00005"},
      {"id":"${tag}-b","name":"B","url":"https://b.example.com/","payout":1.5e-3,"revenue":7},
      {"id":"${tag}-c","name":"C","url":"https://c.example.com/","payout":"abc","revenue":"9"},
      {"id":"${tag}-d","name":"D","url":"https://d.example.com/","payout":"1,000.00","revenue":"9"}
    ]`;
    const result = await syncOfferFeed(fx.networkA);
    expect(result).toMatchObject({ pulled: 4, created: 2, updated: 0 });
    expect(result.skipped?.map((s) => s.id)).toEqual([`${tag}-c`, `${tag}-d`]);
    expect((await offerByFeedId(`${tag}-a`))[0]).toMatchObject({ default_payout: '12.3457', default_revenue: '20.0001' });
    expect((await offerByFeedId(`${tag}-b`))[0]).toMatchObject({ default_payout: '0.0015', default_revenue: '7.0000' });
    expect(await offerByFeedId(`${tag}-c`)).toEqual([]); // never imported with a made-up 0
    expect((await loadIntegrations(fx.networkA)).offerFeedLastSyncError).toMatch(/2 offer\(s\) skipped/);
  });

  it("a re-sync keeps the offer's own settings; a copy is independent of the feed", async () => {
    feed.body = JSON.stringify([{ id: `${tag}-e`, name: 'E', url: 'https://e.example.com/', payout: '5', revenue: '9' }]);
    await syncOfferFeed(fx.networkA);
    const [original] = await offerByFeedId(`${tag}-e`);
    // Set in the dashboard: a description (offer metadata).
    expect((await request(dash).patch(`/api/offers/${original!.id}`).set(admin).send({ description: 'Hand-written terms' })).status).toBe(200);

    const copy = await request(dash).post(`/api/offers/${original!.id}/duplicate`).set(admin).send({});
    expect(copy.status).toBe(201);
    const copyMeta = (await query<{ metadata: Record<string, unknown> }>('SELECT metadata FROM offers WHERE id = $1', [copy.body.data.id])).rows[0]!.metadata;
    expect(copyMeta).toMatchObject({ description: 'Hand-written terms' });
    expect(copyMeta['feedExternalId']).toBeUndefined();
    expect(copyMeta['feedSource']).toBeUndefined();

    feed.body = JSON.stringify([{ id: `${tag}-e`, name: 'E v2', url: 'https://e.example.com/', payout: '6.5', revenue: '9' }]);
    expect(await syncOfferFeed(fx.networkA)).toMatchObject({ created: 0, updated: 1 });
    const [after] = await offerByFeedId(`${tag}-e`);
    expect(after!.id).toBe(original!.id); // the original was updated, not the copy
    expect(after).toMatchObject({ default_payout: '6.5000' });
    expect(after!.metadata).toMatchObject({ description: 'Hand-written terms', feedExternalId: `${tag}-e`, feedSource: 'offer_feed' });
    const copyRow = (await query<{ name: string; default_payout: string }>('SELECT name, default_payout::text FROM offers WHERE id = $1', [copy.body.data.id])).rows[0]!;
    expect(copyRow).toEqual({ name: 'E (copy)', default_payout: '5.0000' });
  });

  it('the public API margin is exact', async () => {
    const key = generateApiKey('network');
    await query(`INSERT INTO api_keys (network_id, audience, owner_id, key_prefix, key_hash, scopes, status, rate_limit_tier)
                 VALUES ($1, 'network', $1, $2, $3, $4, 'active', 'default')`, [fx.networkB, key.prefix, key.keyHash, AUDIENCE_SCOPES.network]);
    // 52 big conversions: the totals reach 12 integer digits, where JS floats lose the 4th decimal —
    // the old (Number(revenue) − Number(payout)).toFixed(4) said …093.7061; the exact margin is …093.7060.
    for (let i = 0; i < 52; i++) {
      await query(`INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, status, payout, revenue, currency, source)
                   VALUES ($1, $2, $3, $4, $5, 'approved', '712.4723', '9542163175.8128', 'USD', 'postback')`,
        [`m-${randomUUID()}`, fx.networkB, `c-${randomUUID().slice(0, 8)}`, fx.offerA, fx.pubB1]);
    }
    const res = await request(buildPublicApiApp()).get('/api/v1/network/reports/summary').set('x-api-key', key.fullKey);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ payout: '37048.5596', revenue: '496192485142.2656', margin: '496192448093.7060' });
  });
});
