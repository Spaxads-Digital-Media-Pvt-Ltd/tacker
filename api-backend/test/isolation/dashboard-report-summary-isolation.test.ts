/**
 * Tenant isolation of the dashboard report summary (GET /api/reports/dashboard — today/yesterday/
 * month/lastMonth totals + today's hourly series) and the 24h tile summary (GET /api/reports/summary).
 * Each network must see only its own clicks/conversions/money; the network comes from the token,
 * so query-string attempts to pick another network are ignored.
 *
 * Runs only when INTEGRATION_DB=1 (requires a live Postgres with migrations applied).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, resetDb, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const run = process.env.INTEGRATION_DB === '1';
const d = run ? describe : describe.skip;

d('Dashboard report summary — tenant isolation', () => {
  let app: Express;
  let fx: Fixture;
  let offerB: string;
  let adminA: string;
  let adminB: string;

  async function seed(networkId: string, offerId: string, publisherId: string, advertiserId: string, clicks: number, convs: { payout: string; revenue: string }[]) {
    for (let i = 0; i < clicks; i++) {
      await query(
        `INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at)
         VALUES ($1, $2, $3, $4, now())`,
        [randomUUID().replace(/-/g, ''), networkId, offerId, publisherId]);
    }
    for (const c of convs) {
      const id = randomUUID();
      await query(
        `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id, payout, revenue, currency, status, source, transaction_id, raw_params)
         VALUES ($1, $2, $1, $3, $4, $5, $6, $7, 'USD', 'approved', 'postback', $1, '{}')`,
        [id, networkId, offerId, publisherId, advertiserId, c.payout, c.revenue]);
    }
  }

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    await resetDb();
    fx = await seedFixture();
    offerB = (await query<{ id: string }>(
      `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url) VALUES ($1, $2, 'Offer B', 'active', 'https://example.com') RETURNING id`,
      [fx.networkB, fx.advB])).rows[0]!.id;
    // Network A: 3 clicks, 2 approved conversions (payout 1+2, revenue 5+5).
    await seed(fx.networkA, fx.offerA, fx.pubA1, fx.advA, 3, [{ payout: '1', revenue: '5' }, { payout: '2', revenue: '5' }]);
    // Network B: 7 clicks, 1 approved conversion (payout 40, revenue 100) — must never leak into A.
    await seed(fx.networkB, offerB, fx.pubB1, fx.advB, 7, [{ payout: '40', revenue: '100' }]);
    app = buildDashboardApp();
    adminA = operatorToken({ userId: 'u-admin-a', networkId: fx.networkA, role: 'admin' });
    adminB = operatorToken({ userId: 'u-admin-b', networkId: fx.networkB, role: 'admin' });
  });

  it('network A sees only its own period totals and series', async () => {
    const res = await request(app).get('/api/reports/dashboard').set(bearer(adminA));
    expect(res.status).toBe(200);
    const b = res.body.data;
    expect(b.clicks.today).toBe(3);
    expect(b.conversions.today).toBe(2);
    expect(Number(b.payout.today)).toBe(3);
    expect(Number(b.revenue.today)).toBe(10);
    expect(Number(b.margin.today)).toBe(7);
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    expect(sum(b.series.clicks)).toBe(3);
    expect(sum(b.series.conversions)).toBe(2);
  });

  it('network B sees only its own', async () => {
    const b = (await request(app).get('/api/reports/dashboard').set(bearer(adminB))).body.data;
    expect(b.clicks.today).toBe(7);
    expect(b.conversions.today).toBe(1);
    expect(Number(b.revenue.today)).toBe(100);
  });

  it('a network id in the query string is ignored (scope comes from the token)', async () => {
    const res = await request(app).get(`/api/reports/dashboard?network_id=${fx.networkB}&networkId=${fx.networkB}`).set(bearer(adminA));
    expect(res.body.data.clicks.today).toBe(3);
    expect(Number(res.body.data.revenue.today)).toBe(10);
  });

  it('24h tile summary is network-scoped too', async () => {
    const a = (await request(app).get('/api/reports/summary').set(bearer(adminA))).body.data;
    const b = (await request(app).get('/api/reports/summary').set(bearer(adminB))).body.data;
    expect(a.clicks).toBe(3);
    expect(a.conversions).toBe(2);
    expect(b.clicks).toBe(7);
    expect(b.conversions).toBe(1);
  });

  it('portal and unauthenticated callers cannot read the admin dashboard summary', async () => {
    expect((await request(app).get('/api/reports/dashboard')).status).toBe(401);
  });
});
