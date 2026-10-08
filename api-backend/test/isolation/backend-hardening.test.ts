/**
 * Backend hardening — cross-network id guards against a real Postgres (INTEGRATION_DB=1; the helpers
 * refuse to run unless the database name contains "test"). Each case writes another network's id
 * into a create/update body and expects a 4xx with nothing persisted.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { canConnect, resetDb, seedFixture, type Fixture } from '../helpers/db.js';
import { query } from '../../src/lib/db/pool.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const run = process.env.INTEGRATION_DB === '1';
const d = run ? describe : describe.skip;

d('backend hardening — cross-network ids on write (DB)', () => {
  let app: Express;
  let fx: Fixture;
  const asA = () => bearer(operatorToken({ userId: 'uA', networkId: fx.networkA }));
  const asB = () => bearer(operatorToken({ userId: 'uB', networkId: fx.networkB }));

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but the database is unreachable');
    await resetDb();
    fx = await seedFixture('hardening');
    app = buildDashboardApp();
  });

  it("postback-control create with another network's offer id is a 4xx and inserts nothing", async () => {
    const res = await request(app).post('/api/postback-controls').set(asB()).send({
      name: 'foreign target', controlType: 'reject', targetType: 'offer', targetIds: [fx.offerA],
    });
    expect(res.status).toBe(400);
    const { rows } = await query(`SELECT 1 FROM advertiser_postback_controls WHERE network_id = $1 AND name = 'foreign target'`, [fx.networkB]);
    expect(rows).toHaveLength(0);

    // Same network is accepted.
    const ok = await request(app).post('/api/postback-controls').set(asA()).send({
      name: 'own target', controlType: 'reject', targetType: 'offer', targetIds: [fx.offerA], partnerIds: [fx.pubA1],
    });
    expect(ok.status).toBe(201);

    // A foreign partner id on update is rejected too.
    const upd = await request(app).patch(`/api/postback-controls/${ok.body.data.id}`).set(asA()).send({ partnerIds: [fx.pubB1] });
    expect(upd.status).toBe(400);
  });

  it("tiered-commission create with another network's partner id is a 4xx", async () => {
    const body = { name: 'tc', targetType: 'offer', targetIds: [fx.offerA], timePeriod: 'monthly', goals: [{ variable: 'conversion', minValue: 1 }] };
    const ok = await request(app).post('/api/tiered-commissions').set(asA()).send({ ...body, partnerIds: [fx.pubA1] });
    expect(ok.status).toBe(201);
    const res = await request(app).post('/api/tiered-commissions').set(asA()).send({ ...body, partnerIds: [fx.pubB1] });
    expect(res.status).toBe(400);
    const tgt = await request(app).post('/api/tiered-commissions').set(asB()).send({ ...body, partnerIds: [] });
    expect(tgt.status).toBe(400);
  });

  it("communication-hub audience with another network's tierId is a 4xx", async () => {
    const tier = await request(app).post('/api/partner-tiers').set(asA()).send({ name: 'Gold A', marginPct: 10 });
    expect(tier.status).toBe(201);
    const tierId = tier.body.data.id as string;

    const foreign = await request(app).post('/api/communication-hub/audiences').set(asB())
      .send({ name: 'steal', groupType: 'publishers', tierId });
    expect(foreign.status).toBe(400);
    const { rows } = await query(`SELECT 1 FROM audiences WHERE network_id = $1 AND name = 'steal'`, [fx.networkB]);
    expect(rows).toHaveLength(0);

    const own = await request(app).post('/api/communication-hub/audiences').set(asA())
      .send({ name: 'mine', groupType: 'publishers', tierId });
    expect(own.status).toBe(201);
  });

  it("smart-link create with another network's catch-all offer is a 4xx", async () => {
    const res = await request(app).post('/api/smart-links').set(asB()).send({ name: 'sl', catchAllOfferId: fx.offerA });
    expect(res.status).toBe(400);
  });

  it('coupon list accepts status=expired; usage rejects a bad year', async () => {
    expect((await request(app).get('/api/coupon-codes?status=expired').set(asA())).status).toBe(200);
    expect((await request(app).get('/api/control-center/usage?year=abc').set(asA())).status).toBe(422);
    expect((await request(app).get('/api/control-center/usage?year=2026').set(asA())).status).toBe(200);
  });

  it('alerts list returns a total in the pagination meta', async () => {
    const res = await request(app).get('/api/alerts').set(asA());
    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({ limit: 50, offset: 0 });
    expect(typeof res.body.pagination.total).toBe('number');
  });

  it('scheduled-action display IDs are stable across status filters', async () => {
    const mk = async (status: string) => {
      const r = await request(app).post('/api/automation/scheduled-actions').set(asA())
        .send({ offerId: fx.offerA, actionType: 'pause', status });
      expect(r.status).toBe(201);
      return r.body.data.id as string;
    };
    const first = await mk('pending');
    const second = await mk('cancelled');
    const all = await request(app).get('/api/automation/scheduled-actions?status=all').set(asA());
    const pending = await request(app).get('/api/automation/scheduled-actions?status=pending').set(asA());
    const idOf = (body: { data: { id: string; displayId: number }[] }, id: string) => body.data.find((x) => x.id === id)?.displayId;
    expect(idOf(all.body, first)).toBe(1);
    expect(idOf(all.body, second)).toBe(2);
    expect(idOf(pending.body, first)).toBe(1);
  });
});
