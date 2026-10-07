/**
 * Advertiser Details → Offers → "+ Offer". The tab had no create action, which blocked Advertiser
 * Events (every event belongs to an offer). The fix opens the existing Add Offer flow with the
 * advertiser preselected, so it relies on POST /api/offers. This pins the server-side half:
 * an advertiser with zero offers gets an offer, it is listed and fetchable with that advertiser,
 * it is immediately usable as an event's "Associated to", and no other network's advertiser can be
 * used, whatever advertiserId the browser sends.
 *
 * Runs only when INTEGRATION_DB=1 (requires a live Postgres with migrations applied).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, resetDb, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const run = process.env.INTEGRATION_DB === '1';
const d = run ? describe : describe.skip;

d('Advertiser with zero offers → create offer → usable for events', () => {
  let app: Express;
  let fx: Fixture;
  let advZero: string;
  let adminA: string;
  let adminB: string;
  let offerId = '';
  const offerBody = (advertiserId: string, name: string) => ({
    advertiserId, name, destinationUrl: 'https://example.com/?c={click_id}', currency: 'EUR', defaultPayout: '1', defaultRevenue: '2',
  });

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    await resetDb();
    fx = await seedFixture();
    advZero = (await query<{ id: string }>(`INSERT INTO advertisers (network_id, name) VALUES ($1, 'Adv Zero') RETURNING id`, [fx.networkA])).rows[0]!.id;
    app = buildDashboardApp();
    adminA = operatorToken({ userId: 'u-admin-a', networkId: fx.networkA, role: 'admin' });
    adminB = operatorToken({ userId: 'u-admin-b', networkId: fx.networkB, role: 'admin' });
  });

  it('starts with no offers and no events', async () => {
    const offers = await request(app).get('/api/offers').set(bearer(adminA));
    expect(offers.body.data.filter((o: { advertiserId: string }) => o.advertiserId === advZero)).toHaveLength(0);
    expect((await request(app).get(`/api/advertisers/${advZero}/events`).set(bearer(adminA))).body.data).toHaveLength(0);
  });

  it('POST /api/offers with the preselected advertiser → 201, owned by that advertiser', async () => {
    const res = await request(app).post('/api/offers').set(bearer(adminA)).send(offerBody(advZero, 'First offer'));
    expect(res.status).toBe(201);
    expect(res.body.data.advertiserId).toBe(advZero);
    offerId = res.body.data.id;
    const row = (await query(`SELECT network_id, advertiser_id FROM offers WHERE id = $1`, [offerId])).rows[0];
    expect(row).toEqual({ network_id: fx.networkA, advertiser_id: advZero });
  });

  it('is listed for that advertiser and survives a fresh GET', async () => {
    const list = await request(app).get('/api/offers').set(bearer(adminA));
    expect(list.body.data.filter((o: { advertiserId: string }) => o.advertiserId === advZero).map((o: { id: string }) => o.id)).toEqual([offerId]);
    const one = await request(app).get(`/api/offers/${offerId}`).set(bearer(adminA));
    expect(one.status).toBe(200);
    expect(one.body.data.advertiserId).toBe(advZero);
  });

  it('can immediately be used as an event\'s "Associated to"', async () => {
    const ev = await request(app).post(`/api/advertisers/${advZero}/events`).set(bearer(adminA)).send({ offerId, name: 'Signup', eventName: 'signup' });
    expect(ev.status).toBe(201);
    expect(ev.body.data).toMatchObject({ offerId, offerName: 'First offer', currency: 'EUR' });
  });

  it('cannot create an offer for another network\'s advertiser (browser-supplied id is checked)', async () => {
    const a = await request(app).post('/api/offers').set(bearer(adminA)).send(offerBody(fx.advB, 'Cross A→B'));
    expect(a.status).toBe(400);
    const b = await request(app).post('/api/offers').set(bearer(adminB)).send(offerBody(advZero, 'Cross B→A'));
    expect(b.status).toBe(400);
    const n = (await query(`SELECT count(*)::int n FROM offers WHERE name LIKE 'Cross %'`)).rows[0]!.n;
    expect(n).toBe(0);
  });

  it('another network neither sees the offer nor can use it for events', async () => {
    expect((await request(app).get(`/api/offers/${offerId}`).set(bearer(adminB))).status).toBe(404);
    expect((await request(app).post(`/api/advertisers/${fx.advB}/events`).set(bearer(adminB)).send({ offerId, name: 'x' })).status).toBe(400);
  });

  it('read_only cannot create an offer', async () => {
    const ro = operatorToken({ userId: 'u-ro', networkId: fx.networkA, role: 'read_only' });
    expect((await request(app).post('/api/offers').set(bearer(ro)).send(offerBody(advZero, 'RO'))).status).toBe(403);
  });
});
