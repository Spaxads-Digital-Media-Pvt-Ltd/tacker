/**
 * DATE columns round-trip as the same calendar day through the API, on a server east of UTC — on a
 * real Postgres (INTEGRATION_DB=1, as in CI) — audit F-19. The process timezone is pinned to
 * Asia/Kolkata (where the off-by-one was seen) so the check means the same thing on a UTC CI box.
 *
 * Also: a customer-value rule's End Date really ends it (the old code built an Invalid Date from the
 * DATE value, so an expired rule kept adjusting payouts).
 */
const originalTz = process.env.TZ;
process.env.TZ = 'Asia/Kolkata';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { evaluateCustomerValueRules } from '../../src/lib/customer-value/evaluate.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

d('DATE columns keep their calendar day (live DB, TZ=Asia/Kolkata)', () => {
  let dash: Express;
  let fx: Fixture;
  let admin: { Authorization: string };

  afterAll(() => { process.env.TZ = originalTz; });
  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`dates-${randomUUID().slice(0, 8)}`);
    dash = buildDashboardApp();
    admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA }));
  });

  it('investigations: created and read back with the dates that were sent', async () => {
    const created = await request(dash).post('/api/investigator').set(admin)
      .send({ startDate: '2026-10-01', endDate: '2026-10-03', targetType: 'click_id', targetValue: 'abc' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-03' });
    const got = await request(dash).get(`/api/investigator/${created.body.data.id}`).set(admin);
    expect(got.body.data).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-03' });
  });

  it('reporting adjustments and partner invoice periods', async () => {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO reporting_adjustments (network_id, publisher_id, offer_id, date_from, date_to) VALUES ($1, $2, $3, '2026-10-01', '2026-10-02') RETURNING id`,
      [fx.networkA, fx.pubA1, fx.offerA]);
    const adj = await request(dash).get(`/api/reporting-adjustments/${rows[0]!.id}`).set(admin);
    expect(adj.status).toBe(200);
    expect(adj.body.data).toMatchObject({ dateFrom: '2026-10-01', dateTo: '2026-10-02' });

    const inv = await request(dash).post('/api/partner-invoices').set(admin).send({ publisherId: fx.pubA1, periodStart: '2026-10-01', periodEnd: '2026-10-31' });
    expect(inv.status).toBe(201);
    expect(inv.body.data).toMatchObject({ periodStart: '2026-10-01', periodEnd: '2026-10-31' });
  });

  it('customer-value rules: the API returns the stored day (the edit form needs YYYY-MM-DD)', async () => {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO customer_value_rules (network_id, name, start_date, end_date, payout_value) VALUES ($1, 'F-19 dates', '2026-10-01', '2026-10-31', 1) RETURNING id`,
      [fx.networkA]);
    const got = await request(dash).get(`/api/customer-value/rules/${rows[0]!.id}`).set(admin);
    expect(got.status).toBe(200);
    expect(got.body.data).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-31' });
  });

  it("a customer-value rule's End Date really ends it (no more Invalid Date)", async () => {
    const net = (await seedFixture(`dates-cv-${randomUUID().slice(0, 8)}`)).networkA;
    const offerId = (await query<{ id: string }>(`SELECT id FROM offers WHERE network_id = $1 LIMIT 1`, [net])).rows[0]!.id;
    const ctx = { networkId: net, offerId, advertiserId: null, publisherId: null, payout: '5.0000', revenue: '8.0000', rawParams: {} };

    await query(`INSERT INTO customer_value_rules (network_id, name, start_date, end_date, payout_value) VALUES ($1, 'Ended yesterday', $2, $3, 99)`,
      [net, day(-30), day(-1)]);
    expect(await evaluateCustomerValueRules({ ...ctx, userId: `u-${randomUUID()}` })).toMatchObject({ appliedId: null, payout: '5.0000' });

    await query(`UPDATE customer_value_rules SET end_date = $2 WHERE network_id = $1`, [net, day(1)]);
    expect(await evaluateCustomerValueRules({ ...ctx, userId: `u-${randomUUID()}` })).toMatchObject({ payoutOverridden: true, payout: '99.0000' });
  });
});
