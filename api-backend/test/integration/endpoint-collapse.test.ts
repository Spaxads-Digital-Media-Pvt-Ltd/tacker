/**
 * Duplicate endpoints collapsed (audit F-25·F-28 step 3) — on a real Postgres (INTEGRATION_DB=1).
 *
 * - Postbacks: three scoped APIs over publisher_postbacks (network-wide, a partner's, an offer's)
 *   now share one URL rule — http(s) only. The offer's API used to take any URL scheme.
 * - Team users: one create (POST /api/users); the identical copy at /api/control-center/users is
 *   gone. Without Supabase Auth configured the create says so (503) instead of a 500.
 * - Business units: one API (/api/control-center/business-units, which the SPA uses); the unused
 *   /api/business-units — which hard-deleted and listed soft-deleted units — is gone.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('duplicate endpoints collapsed (live DB)', () => {
  let dash: Express;
  let fx: Fixture;
  let admin: { Authorization: string };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`collapse-${randomUUID().slice(0, 8)}`);
    dash = buildDashboardApp();
    admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
  });

  it('every postback API takes only http(s) URLs', async () => {
    const viaOffer = (url: string) => request(dash).post(`/api/offers/${fx.offerA}/postbacks`).set(admin).send({ publisherId: fx.pubA1, url });
    const viaPartner = (url: string) => request(dash).post(`/api/publishers/${fx.pubA1}/postbacks`).set(admin).send({ url });
    const viaNetwork = (url: string) => request(dash).post('/api/postbacks').set(admin).send({ publisherId: fx.pubA1, url });
    for (const bad of ['ftp://pb.example.com/x', 'javascript:alert(1)']) {
      for (const send of [viaOffer, viaPartner, viaNetwork]) expect((await send(bad)).status).toBe(422);
    }
    expect((await viaOffer('https://pb.example.com/{click_id}')).status).toBe(201);
    expect((await viaPartner('https://pb.example.com/p')).status).toBe(201);
    expect((await viaNetwork('http://pb.example.com/n')).status).toBe(201);
  });

  it('one team-user create; without Supabase Auth it answers 503 with the reason', async () => {
    const res = await request(dash).post('/api/users').set(admin).send({ name: 'New Teammate', email: `t-${randomUUID().slice(0, 6)}@example.com`, role: 'manager' });
    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/Team logins are unavailable: Supabase Auth is not configured/);
    expect((await request(dash).post('/api/control-center/users').set(admin).send({ name: 'x', email: 'x@example.com' })).status).toBe(404);
  });

  it('business units: only the Control Center API (soft delete, deleted units hidden)', async () => {
    expect((await request(dash).get('/api/business-units').set(admin)).status).toBe(404);
    const created = await request(dash).post('/api/control-center/business-units').set(admin).send({ name: `BU ${randomUUID().slice(0, 6)}` });
    expect(created.status).toBe(201);
    expect((await request(dash).delete(`/api/control-center/business-units/${created.body.data.id}`).set(admin)).status).toBe(200);
    const list = await request(dash).get('/api/control-center/business-units').set(admin);
    expect((list.body.data as { id: string }[]).map((u) => u.id)).not.toContain(created.body.data.id);
  });
});
