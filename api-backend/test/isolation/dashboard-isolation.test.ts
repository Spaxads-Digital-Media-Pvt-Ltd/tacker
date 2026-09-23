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
    // vitest exits after all suites; pool end here breaks subsequent DB test files.
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

  // --- RBAC: read_only cannot mutate offers (A-1 fix) ---
  it('read_only role gets 403 on POST /api/offers', async () => {
    const res = await request(app)
      .post('/api/offers')
      .set(bearer(operatorToken({ userId: 'uA-readonly', networkId: fx.networkA, role: 'read_only' })))
      .send({
        advertiserId: fx.advA,
        name: 'RBAC test offer',
        currency: 'USD',
        destinationUrl: 'https://example.com',
        trackingDomainId: null,
        defaultRevenue: 10,
        defaultPayout: 5,
      });
    expect(res.status).toBe(403);
  });

  it('admin role can create an offer (200)', async () => {
    const res = await request(app)
      .post('/api/offers')
      .set(bearer(operatorToken({ userId: 'uA-admin', networkId: fx.networkA, role: 'admin' })))
      .send({
        advertiserId: fx.advA,
        name: 'RBAC admin offer',
        currency: 'USD',
        destinationUrl: 'https://example.com',
        trackingDomainId: null,
        defaultRevenue: 10,
        defaultPayout: 5,
      });
    expect(res.status).toBe(201);
  });

  // --- Geo-rule PATCH (P0 regression) ---
  let geoRuleSeq = 0;
  async function createGeoRule(networkId: string, offerId: string, country?: string): Promise<string> {
    geoRuleSeq++;
    // Use a unique country per call so this helper is safe to call many times against the same
    // offer — the (offer_id, country, COALESCE(region, '')) unique index forbids duplicates and
    // sibling isolation tests may have already inserted a US rule on fx.offerA.
    const c = country ?? `U${String(geoRuleSeq).padStart(2, '0')}`;
    const res = await request(app)
      .post(`/api/offers/${offerId}/geo-rules`)
      .set(bearer(operatorToken({ userId: 'u-geo-patch', networkId, role: 'admin' })))
      .send({ country: c, action: 'allow', payoutOverride: 5, revenueOverride: 10, destinationOverride: null });
    expect(res.status).toBe(201);
    return res.body.data.id;
  }

  it('admin can PATCH a geo rule (200)', async () => {
    const ruleId = await createGeoRule(fx.networkA, fx.offerA);
    const res = await request(app)
      .patch(`/api/offers/${fx.offerA}/geo-rules/${ruleId}`)
      .set(bearer(operatorToken({ userId: 'u-geo-patch', networkId: fx.networkA, role: 'admin' })))
      .send({ action: 'deny', payoutOverride: 15, revenueOverride: 20 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.action).toBe('deny');
    expect(res.body.data.payoutOverride).toBe('15.0000');
    expect(res.body.data.revenueOverride).toBe('20.0000');
  });

  it('PATCH preserves fields not included in the payload', async () => {
    // Explicit country so the test is not affected by the auto-increment counter.
    const ruleId = await createGeoRule(fx.networkA, fx.offerA, 'US');
    const res = await request(app)
      .patch(`/api/offers/${fx.offerA}/geo-rules/${ruleId}`)
      .set(bearer(operatorToken({ userId: 'u-geo-patch2', networkId: fx.networkA, role: 'admin' })))
      .send({ action: 'deny' });
    expect(res.status).toBe(200);
    expect(res.body.data.country).toBe('US');
    expect(res.body.data.action).toBe('deny');
  });

  it('PATCH with invalid action returns 422', async () => {
    const ruleId = await createGeoRule(fx.networkA, fx.offerA);
    const res = await request(app)
      .patch(`/api/offers/${fx.offerA}/geo-rules/${ruleId}`)
      .set(bearer(operatorToken({ userId: 'u-geo-patch', networkId: fx.networkA, role: 'admin' })))
      .send({ action: 'invalid' });
    expect(res.status).toBe(422);
  });

  it('PATCH with empty body returns 400', async () => {
    const ruleId = await createGeoRule(fx.networkA, fx.offerA);
    const res = await request(app)
      .patch(`/api/offers/${fx.offerA}/geo-rules/${ruleId}`)
      .set(bearer(operatorToken({ userId: 'u-geo-patch', networkId: fx.networkA, role: 'admin' })))
      .send({});
    expect(res.status).toBe(400);
  });

  it('PATCH non-existent rule returns 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app)
      .patch(`/api/offers/${fx.offerA}/geo-rules/${fakeId}`)
      .set(bearer(operatorToken({ userId: 'u-geo-patch', networkId: fx.networkA, role: 'admin' })))
      .send({ action: 'deny' });
    expect(res.status).toBe(404);
  });

  it('PATCH rule belonging to another offer in same network returns 404', async () => {
    const offerB = await request(app)
      .post('/api/offers')
      .set(bearer(operatorToken({ userId: 'u-geo-patch2', networkId: fx.networkA, role: 'admin' })))
      .send({ advertiserId: fx.advA, name: 'Offer B geo-patch', currency: 'USD', destinationUrl: 'https://b.com', trackingDomainId: null, defaultRevenue: 10, defaultPayout: 5 });
    expect(offerB.status).toBe(201);
    const ruleOnB = await createGeoRule(fx.networkA, offerB.body.data.id);
    const res = await request(app)
      .patch(`/api/offers/${fx.offerA}/geo-rules/${ruleOnB}`)
      .set(bearer(operatorToken({ userId: 'u-geo-patch', networkId: fx.networkA, role: 'admin' })))
      .send({ action: 'deny' });
    expect(res.status).toBe(404);
  });

  it('PATCH rule from a different network returns 404', async () => {
    const advB = await request(app)
      .post('/api/advertisers')
      .set(bearer(operatorToken({ userId: 'u-geo-advb', networkId: fx.networkB, role: 'admin' })))
      .send({ name: 'Adv B geo-patch' });
    expect(advB.status).toBe(201);
    const offerC = await request(app)
      .post('/api/offers')
      .set(bearer(operatorToken({ userId: 'u-geo-offerC', networkId: fx.networkB, role: 'admin' })))
      .send({ advertiserId: advB.body.data.id, name: 'Offer C geo-patch', currency: 'USD', destinationUrl: 'https://c.com', trackingDomainId: null, defaultRevenue: 10, defaultPayout: 5 });
    expect(offerC.status).toBe(201);
    const ruleOnC = await createGeoRule(fx.networkB, offerC.body.data.id);
    const res = await request(app)
      .patch(`/api/offers/${offerC.body.data.id}/geo-rules/${ruleOnC}`)
      .set(bearer(operatorToken({ userId: 'u-geo-patch', networkId: fx.networkA, role: 'admin' })))
      .send({ action: 'deny' });
    expect(res.status).toBe(404);
  });

  it('read_only role gets 403 on PATCH geo rule', async () => {
    const ruleId = await createGeoRule(fx.networkA, fx.offerA);
    const res = await request(app)
      .patch(`/api/offers/${fx.offerA}/geo-rules/${ruleId}`)
      .set(bearer(operatorToken({ userId: 'u-geo-readonly', networkId: fx.networkA, role: 'read_only' })))
      .send({ action: 'deny' });
    expect(res.status).toBe(403);
  });

  it('unauthenticated PATCH returns 401', async () => {
    const res = await request(app).patch('/api/offers/some-offer/geo-rules/some-rule').send({ action: 'deny' });
    expect(res.status).toBe(401);
  });

  it('PATCH sets country to uppercase (case normalisation)', async () => {
    const ruleId = await createGeoRule(fx.networkA, fx.offerA);
    const res = await request(app)
      .patch(`/api/offers/${fx.offerA}/geo-rules/${ruleId}`)
      .set(bearer(operatorToken({ userId: 'u-geo-patch', networkId: fx.networkA, role: 'admin' })))
      .send({ country: 'gb' });
    expect(res.status).toBe(200);
    expect(res.body.data.country).toBe('GB');
  });

  it('PATCH clears payoutOverride/revenueOverride/destinationOverride when null', async () => {
    const ruleId = await createGeoRule(fx.networkA, fx.offerA);
    const res = await request(app)
      .patch(`/api/offers/${fx.offerA}/geo-rules/${ruleId}`)
      .set(bearer(operatorToken({ userId: 'u-geo-patch', networkId: fx.networkA, role: 'admin' })))
      .send({ payoutOverride: null, revenueOverride: null, destinationOverride: null });
    expect(res.status).toBe(200);
    expect(res.body.data.payoutOverride).toBeNull();
    expect(res.body.data.revenueOverride).toBeNull();
    expect(res.body.data.destinationOverride).toBeNull();
  });
});
