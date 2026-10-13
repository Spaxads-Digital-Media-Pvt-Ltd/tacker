/**
 * Dashboard + offer-group money is exact decimal text, never JS float math — on a real Postgres
 * (INTEGRATION_DB=1, as in CI) — audit F-22.
 *
 * 2000 approved conversions of 9999999999.9999 revenue sum to 19999999999999.8 — a figure a double
 * can't hold (it comes out ...8008, and the margin ...6016). The hourly conversion-rate series lines
 * up with the hourly clicks/conversions (SQL returns only hours with data, unordered).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('money stays exact on the dashboard and offer-group stats (live DB)', () => {
  let dash: Express;
  const run = randomUUID().slice(0, 8); // click/conversion ids are globally unique
  const auth = (networkId: string) => bearer(operatorToken({ userId: randomUUID(), networkId }));
  /** n approved conversions on `offerId` at `at`, each with the given revenue/payout. */
  const conversions = (networkId: string, offerId: string, n: number, revenue: string, payout: string, at = 'now()', status = 'approved', clickPrefix = `${run}k`) =>
    query(
      `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, source, status, revenue, payout, currency, created_at)
       SELECT 'f22-' || $5 || '-' || g || '-' || substr(md5(random()::text), 1, 8), $1, $5 || g, $2, 'postback', $6, $3::numeric, $4::numeric, 'USD', ${at}
         FROM generate_series(1, $7) g`,
      [networkId, offerId, revenue, payout, clickPrefix, status, n]);

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    dash = buildDashboardApp();
  });

  it('per-period revenue / payout / margin are exact 4dp text (a float total would end in ...8008 / ...6016)', async () => {
    const fx = await seedFixture(`money-${randomUUID().slice(0, 8)}`);
    await conversions(fx.networkA, fx.offerA, 2000, '9999999999.9999', '0.0001');
    const res = await request(dash).get('/api/reports/dashboard').set(auth(fx.networkA));
    expect(res.status).toBe(200);
    const b = res.body.data;
    expect(b.revenue.today).toBe('19999999999999.8000');
    expect(b.payout.today).toBe('0.2000');
    expect(b.margin.today).toBe('19999999999999.6000');
    expect(b.margin.month).toBe('19999999999999.6000');
    expect(b.margin.yesterday).toBe('0.0000');
    // The hourly money series are the same exact text, in the current UTC hour's slot.
    const h = new Date().getUTCHours();
    expect(b.series.revenue[h]).toBe('19999999999999.8000');
    expect(b.series.margin[h]).toBe('19999999999999.6000');
    expect(b.series.payout.filter((v: string) => v !== '0.0000')).toEqual(['0.2000']);
  });

  it('the hourly conversion-rate series lines up with that hour’s clicks and conversions', async () => {
    const fx = await seedFixture(`money-cr-${randomUUID().slice(0, 8)}`);
    const hour = (n: number) => `date_trunc('day', now(), 'UTC') + interval '${n} hours 5 minutes'`;
    for (const [h, n] of [[1, 4], [3, 10], [7, 8]] as const) {
      await query(`INSERT INTO clicks (click_id, network_id, offer_id, created_at) SELECT $3 || g, $1, $2, ${hour(h)} FROM generate_series(1, ${n}) g`,
        [fx.networkA, fx.offerA, `${run}c${h}-`]);
    }
    await conversions(fx.networkA, fx.offerA, 5, '1', '0.5', hour(3), 'approved', `${run}k3-`);
    await conversions(fx.networkA, fx.offerA, 2, '1', '0.5', hour(7), 'approved', `${run}k7-`);
    const b = (await request(dash).get('/api/reports/dashboard').set(auth(fx.networkA))).body.data;
    expect(b.series.clicks.slice(0, 8)).toEqual([0, 4, 0, 10, 0, 0, 0, 8]);
    expect(b.series.conversions.slice(0, 8)).toEqual([0, 0, 0, 5, 0, 0, 0, 2]);
    expect(b.series.cr.slice(0, 8)).toEqual([0, 0, 0, 50, 0, 0, 0, 25]);
    expect(b.series.cr.every((v: unknown) => typeof v === 'number')).toBe(true);
  });

  it("offer-group stats: today's approved money as exact text; rejected/pending conversions don't count", async () => {
    const fx = await seedFixture(`money-og-${randomUUID().slice(0, 8)}`);
    const { rows } = await query<{ id: string }>(
      `INSERT INTO offer_groups (network_id, name, offer_ids) VALUES ($1, 'F-22 group', $2) RETURNING id`, [fx.networkA, JSON.stringify([fx.offerA])]);
    // The stats join today's clicks to their conversions.
    const og = `${run}og`;
    await query(`INSERT INTO clicks (click_id, network_id, offer_id) SELECT $3 || g, $1, $2 FROM generate_series(1, 2003) g`, [fx.networkA, fx.offerA, og]);
    await conversions(fx.networkA, fx.offerA, 2000, '9999999999.9999', '0.0001', 'now()', 'approved', og);
    await query(
      `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, source, status, revenue, payout, currency)
       VALUES ($3 || 'rej', $1, $3 || '2001', $2, 'postback', 'rejected', 500, 300, 'USD'), ($3 || 'pend', $1, $3 || '2002', $2, 'postback', 'pending', 70, 40, 'USD')`,
      [fx.networkA, fx.offerA, og]);
    const res = await request(dash).get(`/api/offer-groups/${rows[0]!.id}/stats`).set(auth(fx.networkA));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      revenue: '19999999999999.8000', payout: '0.2000', margin: '19999999999999.6000', clicks: 2003, cv: 2000,
    });
  });
});
