/**
 * Customer Value › Conversion Events API (live DB; INTEGRATION_DB=1): each event carries the
 * conversion's own currency (USD / EUR / none) and exact payout / revenue text; paging with
 * limit/offset (what the all-pages export walks) is stable even when timestamps tie; another
 * network's conversions for the same user_id never appear.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { canConnect, resetDb, seedFixture, type Fixture } from '../helpers/db.js';
import { query } from '../../src/lib/db/pool.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const run = process.env.INTEGRATION_DB === '1';
const d = run ? describe : describe.skip;

interface Ev { conversionId: string; payout: string | null; revenue: string | null; currency: string | null; status: string; dataPoints: { name: string; value: string }[] }

d('Customer Value › Conversion Events — currency, exact money, paging, isolation (live DB)', () => {
  let app: Express; let fx: Fixture; let auth: { Authorization: string }; let authB: { Authorization: string };
  const USER = 'cv-events-user';
  const conv = async (net: string, offerId: string, at: string, o: { payout: string | null; revenue: string | null; currency: string | null; status?: string; raw?: Record<string, unknown> }) => {
    const id = randomUUID().replace(/-/g, '');
    await query(`INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, payout, revenue, currency, status, source, raw_params, created_at)
      VALUES ($1, $2, $1, $3, $4, $5, $6, $7, 'postback', $8, $9)`,
      [id, net, offerId, o.payout, o.revenue, o.currency, o.status ?? 'approved', JSON.stringify({ user_id: USER, ...(o.raw ?? {}) }), at]);
    return id;
  };
  const get = (qs: string, a = auth) => request(app).get(`/api/customer-value/conversion-events?userId=${USER}&${qs}`).set(a);

  let usdId: string, eurId: string, noneId: string;
  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable. Run migrations against DATABASE_URL first.');
    await resetDb();
    fx = await seedFixture();
    app = buildDashboardApp();
    auth = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
    authB = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkB, role: 'admin' }));
    await query(`INSERT INTO customer_data_points (network_id, name, data_type, parameter_key) VALUES ($1, 'Deposit', 'number', 'deposit')`, [fx.networkA]);
    usdId = await conv(fx.networkA, fx.offerA, '2026-05-03T10:00:00Z', { payout: '1.2345', revenue: '3.0050', currency: 'USD', raw: { deposit: '150' } });
    eurId = await conv(fx.networkA, fx.offerA, '2026-05-02T10:00:00Z', { payout: '0.0005', revenue: '0.0015', currency: 'EUR', status: 'pending' });
    noneId = await conv(fx.networkA, fx.offerA, '2026-05-01T10:00:00Z', { payout: '7.0000', revenue: null, currency: null });
    // 30 more with the SAME timestamp, so paging has to break ties to be stable.
    for (let i = 0; i < 30; i++) await conv(fx.networkA, fx.offerA, '2026-04-01T00:00:00Z', { payout: '1.0000', revenue: '2.0000', currency: 'USD' });
    // Another network, same user_id.
    const offerB = (await query<{ id: string }>(`INSERT INTO offers (network_id, advertiser_id, name, status, destination_url) VALUES ($1, $2, 'B', 'active', 'https://example.com') RETURNING id`, [fx.networkB, fx.advB])).rows[0]!.id;
    await conv(fx.networkB, offerB, '2026-05-04T10:00:00Z', { payout: '999.0000', revenue: '999.0000', currency: 'GBP' });
  });

  it('each event carries its own currency (USD, EUR, none) and the exact stored money text', async () => {
    const res = await get('from=2026-04-30&to=2026-05-31&limit=10');
    expect(res.status).toBe(200);
    const byId = new Map((res.body.data.events as Ev[]).map((e) => [e.conversionId, e]));
    expect(byId.get(usdId)).toMatchObject({ payout: '1.2345', revenue: '3.0050', currency: 'USD', status: 'approved' });
    expect(byId.get(eurId)).toMatchObject({ payout: '0.0005', revenue: '0.0015', currency: 'EUR', status: 'pending' });
    expect(byId.get(noneId)).toMatchObject({ payout: '7.0000', revenue: null, currency: null });
    expect(byId.get(usdId)!.dataPoints).toEqual([{ name: 'Deposit', parameterKey: 'deposit', value: '150' }]);
    for (const e of res.body.data.events as Ev[]) {
      if (e.payout != null) expect(typeof e.payout).toBe('string');
      if (e.revenue != null) expect(typeof e.revenue).toBe('string');
    }
  });

  it('paging (limit/offset) returns every event exactly once, newest first, even with tied timestamps', async () => {
    const seen: string[] = [];
    for (let offset = 0; offset < 100; offset += 7) {
      const page = (await get(`limit=7&offset=${offset}`)).body.data.events as Ev[];
      seen.push(...page.map((e) => e.conversionId));
      if (page.length < 7) break;
    }
    expect(seen).toHaveLength(33);
    expect(new Set(seen).size).toBe(33);
    expect(seen.slice(0, 3)).toEqual([usdId, eurId, noneId]);
  });

  it("another network's conversions for the same user_id never appear, and it sees none of these", async () => {
    const a = (await get('limit=100')).body.data.events as Ev[];
    expect(a.some((e) => e.currency === 'GBP')).toBe(false);
    const b = (await get('limit=100', authB)).body.data.events as Ev[];
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ currency: 'GBP', payout: '999.0000' });
  });

  it('existing contract unchanged: no userId → empty; limit above 500 → 422', async () => {
    const empty = await request(app).get('/api/customer-value/conversion-events').set(auth);
    expect(empty.body.data).toEqual({ userId: '', events: [] });
    expect((await get('limit=501')).status).toBe(422);
  });
});
