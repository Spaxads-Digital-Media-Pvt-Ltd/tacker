/**
 * Regression: Advertiser Details → API Keys. The tab was a static shell, so "Add" sent nothing and the
 * list stayed at "0 Total". Admins now manage an advertiser's keys at /api/advertisers/:id/keys.
 *
 * Proves: create → list shows it (total 1); never visible for another advertiser in the same network
 * or for any advertiser of another network; foreign/unknown advertiser ids are 404; the key works only
 * on the advertiser Public API (scoped to that advertiser) and revocation takes effect.
 *
 * Runs only when INTEGRATION_DB=1 (requires a live Postgres with migrations applied).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { buildPublicApiApp } from '../../src/surfaces/public-api/app.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, resetDb, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const run = process.env.INTEGRATION_DB === '1';
const d = run ? describe : describe.skip;

d('Advertiser API keys (admin, per advertiser)', () => {
  let app: Express;
  let pub: Express;
  let fx: Fixture;
  let advA2: string;
  let adminA: string;
  let adminB: string;
  let fullKey = '';
  let keyId = '';

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    await resetDb();
    fx = await seedFixture();
    advA2 = (await query<{ id: string }>(
      `INSERT INTO advertisers (network_id, name) VALUES ($1, 'Adv A2') RETURNING id`, [fx.networkA])).rows[0]!.id;
    app = buildDashboardApp();
    pub = buildPublicApiApp();
    adminA = operatorToken({ userId: 'u-admin-a', networkId: fx.networkA, role: 'admin' });
    adminB = operatorToken({ userId: 'u-admin-b', networkId: fx.networkB, role: 'admin' });
  });

  it('admin creates a key for an advertiser and the list returns it (total 1)', async () => {
    const created = await request(app).post(`/api/advertisers/${fx.advA}/keys`).set(bearer(adminA)).send({ name: 'QA-API-KEY-001' });
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe('QA-API-KEY-001');
    expect(typeof created.body.data.key).toBe('string');
    fullKey = created.body.data.key;
    keyId = created.body.data.id;

    const list = await request(app).get(`/api/advertisers/${fx.advA}/keys`).set(bearer(adminA));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ id: keyId, name: 'QA-API-KEY-001', status: 'active' });
    expect(list.body.data[0].key).toBeUndefined(); // full secret is only returned once, at creation

    const row = (await query(`SELECT network_id, audience, owner_id FROM api_keys WHERE id = $1`, [keyId])).rows[0];
    expect(row).toEqual({ network_id: fx.networkA, audience: 'advertiser', owner_id: fx.advA });
  });

  it('is not visible for another advertiser in the same network', async () => {
    const list = await request(app).get(`/api/advertisers/${advA2}/keys`).set(bearer(adminA));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(0);
  });

  it('another network cannot list, create or revoke for that advertiser', async () => {
    expect((await request(app).get(`/api/advertisers/${fx.advA}/keys`).set(bearer(adminB))).status).toBe(404);
    expect((await request(app).post(`/api/advertisers/${fx.advA}/keys`).set(bearer(adminB)).send({ name: 'x' })).status).toBe(404);
    expect((await request(app).delete(`/api/advertisers/${fx.advA}/keys/${keyId}`).set(bearer(adminB))).status).toBe(404);
    const listB = await request(app).get(`/api/advertisers/${fx.advB}/keys`).set(bearer(adminB));
    expect(listB.body.data).toHaveLength(0);
  });

  it('a key cannot be revoked through a different advertiser', async () => {
    expect((await request(app).delete(`/api/advertisers/${advA2}/keys/${keyId}`).set(bearer(adminA))).status).toBe(404);
  });

  it('unknown advertiser id is 404, malformed id is 422, non-admin role is 403', async () => {
    expect((await request(app).get('/api/advertisers/00000000-0000-4000-8000-0000000000ff/keys').set(bearer(adminA))).status).toBe(404);
    expect((await request(app).get('/api/advertisers/not-a-uuid/keys').set(bearer(adminA))).status).toBe(422);
    const manager = operatorToken({ userId: 'u-mgr', networkId: fx.networkA, role: 'manager' });
    expect((await request(app).get(`/api/advertisers/${fx.advA}/keys`).set(bearer(manager))).status).toBe(403);
  });

  it('the key works only on the advertiser Public API, scoped to that advertiser', async () => {
    const ok = await request(pub).get('/api/v1/advertiser/offers').set('X-Api-Key', fullKey);
    expect(ok.status).toBe(200);
    expect(ok.body.data.map((o: { id: string }) => o.id)).toEqual([fx.offerA]);
    expect((await request(pub).get('/api/v1/publisher/offers').set('X-Api-Key', fullKey)).status).toBe(403);
    expect((await request(pub).get('/api/v1/network/offers').set('X-Api-Key', fullKey)).status).toBe(403);
  });

  it('revoke updates the list and the key stops working', async () => {
    expect((await request(app).delete(`/api/advertisers/${fx.advA}/keys/${keyId}`).set(bearer(adminA))).status).toBe(200);
    const list = await request(app).get(`/api/advertisers/${fx.advA}/keys`).set(bearer(adminA));
    expect(list.body.data[0].status).toBe('revoked');
    expect((await request(pub).get('/api/v1/advertiser/offers').set('X-Api-Key', fullKey)).status).toBe(401);
  });
});
