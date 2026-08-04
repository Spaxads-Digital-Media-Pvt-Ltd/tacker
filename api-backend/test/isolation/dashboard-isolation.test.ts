/**
 * LIVE cross-tenant AND cross-owner isolation (spec §3A, non-negotiable #5). Actively attempts
 * X-accessing-Y and networkA-accessing-networkB against the real Dashboard API + real Postgres,
 * asserting every attempt fails. Expanded with every new endpoint.
 *
 * Runs when INTEGRATION_DB=1 (CI provides a Postgres service; locally set it with a DB up and
 * migrations applied). Otherwise skipped — the pure structural suite still runs everywhere.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { closeDb } from '../../src/lib/db/pool.js';
import { canConnect, resetDb, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, portalToken, bearer } from '../helpers/tokens.js';

const run = process.env.INTEGRATION_DB === '1';
const d = run ? describe : describe.skip;

d('Dashboard API isolation (live DB)', () => {
  let app: Express;
  let fx: Fixture;

  beforeAll(async () => {
    if (!(await canConnect())) {
      throw new Error('INTEGRATION_DB=1 but Postgres is unreachable. Run migrations against DATABASE_URL first.');
    }
    await resetDb();
    fx = await seedFixture();
    app = buildDashboardApp();
  });

  afterAll(async () => {
    await closeDb();
  });

  // --- Tenant isolation (network A <-> network B) ---
  it('operator sees only their own network’s advertisers', async () => {
    const res = await request(app).get('/api/advertisers').set(bearer(operatorToken({ userId: 'uB', networkId: fx.networkB })));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((a: { id: string }) => a.id);
    expect(ids).toContain(fx.advB);
    expect(ids).not.toContain(fx.advA);
  });

  it('operator cannot fetch another network’s advertiser by id (404)', async () => {
    const res = await request(app).get(`/api/advertisers/${fx.advA}`).set(bearer(operatorToken({ userId: 'uB', networkId: fx.networkB })));
    expect(res.status).toBe(404);
  });

  it('operator cannot fetch another network’s offer by id (404)', async () => {
    const res = await request(app).get(`/api/offers/${fx.offerA}`).set(bearer(operatorToken({ userId: 'uB', networkId: fx.networkB })));
    expect(res.status).toBe(404);
  });

  // --- Owner isolation (publisher X <-> publisher Y in the SAME network) ---
  it('publisher sees only offers granted to them', async () => {
    const a1 = await request(app).get('/api/portal/offers').set(bearer(portalToken({ userId: 'p1', networkId: fx.networkA, kind: 'publisher', ownerId: fx.pubA1 })));
    expect(a1.status).toBe(200);
    expect(a1.body.data.map((o: { id: string }) => o.id)).toContain(fx.offerA);

    // pubA2 has NO access grant → must NOT see offerA.
    const a2 = await request(app).get('/api/portal/offers').set(bearer(portalToken({ userId: 'p2', networkId: fx.networkA, kind: 'publisher', ownerId: fx.pubA2 })));
    expect(a2.status).toBe(200);
    expect(a2.body.data.map((o: { id: string }) => o.id)).not.toContain(fx.offerA);
  });

  it('publisher offer DTO never exposes revenue/margin (only payout)', async () => {
    const res = await request(app).get('/api/portal/offers').set(bearer(portalToken({ userId: 'p1', networkId: fx.networkA, kind: 'publisher', ownerId: fx.pubA1 })));
    const offer = res.body.data[0];
    expect(offer).toBeDefined();
    expect(offer).toHaveProperty('payout');
    expect(offer).not.toHaveProperty('revenue');
    expect(offer).not.toHaveProperty('defaultRevenue');
    expect(offer).not.toHaveProperty('margin');
  });

  it('advertiser sees only their own offers with revenue (not publisher payout)', async () => {
    const a = await request(app).get('/api/portal/offers').set(bearer(portalToken({ userId: 'aA', networkId: fx.networkA, kind: 'advertiser', ownerId: fx.advA })));
    expect(a.status).toBe(200);
    expect(a.body.data.map((o: { id: string }) => o.id)).toContain(fx.offerA);
    expect(a.body.data[0]).toHaveProperty('revenue');
    expect(a.body.data[0]).not.toHaveProperty('payout');

    // advB owns no offers → empty.
    const b = await request(app).get('/api/portal/offers').set(bearer(portalToken({ userId: 'aB', networkId: fx.networkB, kind: 'advertiser', ownerId: fx.advB })));
    expect(b.body.data).toHaveLength(0);
  });

  // --- Surface / kind segregation ---
  it('portal user cannot reach operator CRUD (403)', async () => {
    const res = await request(app).get('/api/advertisers').set(bearer(portalToken({ userId: 'p1', networkId: fx.networkA, kind: 'publisher', ownerId: fx.pubA1 })));
    expect(res.status).toBe(403);
  });

  it('operator cannot reach a portal self-route (403)', async () => {
    const res = await request(app).get('/api/portal/publisher/me').set(bearer(operatorToken({ userId: 'uA', networkId: fx.networkA })));
    expect(res.status).toBe(403);
  });

  it('unauthenticated requests are denied (401)', async () => {
    const res = await request(app).get('/api/advertisers');
    expect(res.status).toBe(401);
  });
});
