/**
 * M2 regression: copy-settings-to handles unique constraint collisions gracefully.
 *
 * offer_geo_rules has a unique index (offer_id, country, COALESCE(region, '')).
 * The endpoint must not return 500 when source and target share a geo rule key.
 * The target's existing row must be preserved (NOT EXISTS guard filters conflicting source rows).
 *
 * Runs only when INTEGRATION_DB=1 (requires a live Postgres with migrations applied).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { canConnect, resetDb, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const run = process.env.INTEGRATION_DB === '1';
const d = run ? describe : describe.skip;

d('Copy offer settings — unique constraint collisions (M2)', () => {
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

  async function createOfferWithGeoRules(networkId: string, advertiserId: string, name: string, country: string): Promise<string> {
    const res = await request(app)
      .post('/api/offers')
      .set(bearer(operatorToken({ userId: 'u-geo', networkId, role: 'admin' })))
      .send({
        advertiserId,
        name,
        currency: 'USD',
        destinationUrl: `https://${name.toLowerCase()}.com`,
        trackingDomainId: null,
        defaultRevenue: 10,
        defaultPayout: 5,
      });
    expect(res.status).toBe(201);
    const offerId = res.body.data.id;

    // Add a geo rule so the offer has something to copy
    await request(app)
      .post(`/api/offers/${offerId}/geo-rules`)
      .set(bearer(operatorToken({ userId: 'u-geo', networkId, role: 'admin' })))
      .send({ country, action: 'allow', payoutOverride: 3, revenueOverride: 7 });

    return offerId;
  }

  async function getGeoRules(offerId: string): Promise<{ id: string; country: string; action: string; payoutOverride: string | null }[]> {
    const res = await request(app)
      .get(`/api/offers/${offerId}/geo-rules`)
      .set(bearer(operatorToken({ userId: 'u-geo', networkId: fx.networkA, role: 'admin' })));
    expect(res.status).toBe(200);
    return res.body.data;
  }

  it('copies non-conflicting settings without error', async () => {
    const src = await createOfferWithGeoRules(fx.networkA, fx.advA, 'SrcOffer', 'CA');
    const tgt = await createOfferWithGeoRules(fx.networkA, fx.advA, 'TgtOffer', 'MX');

    const res = await request(app)
      .post(`/api/offers/${src}/copy-settings-to`)
      .set(bearer(operatorToken({ userId: 'u-geo', networkId: fx.networkA, role: 'admin' })))
      .send({ targetOfferId: tgt, includeCustomSettings: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.copied).toBe(true);

    // Target should now have both its original MX rule and the copied CA rule
    const rules = await getGeoRules(tgt);
    const countries = rules.map((r) => r.country);
    expect(countries).toContain('MX');
    expect(countries).toContain('CA');
  });

  it('preserves the existing target geo rule when source shares its key', async () => {
    // Both offers have a geo rule for 'US'. The copy-settings-to NOT EXISTS guard must
    // skip the source's US rule so the target retains exactly its original US rule.
    const src = await createOfferWithGeoRules(fx.networkA, fx.advA, 'SrcOffer2', 'US');
    const tgt = await createOfferWithGeoRules(fx.networkA, fx.advA, 'TgtOffer2', 'US');

    const res = await request(app)
      .post(`/api/offers/${src}/copy-settings-to`)
      .set(bearer(operatorToken({ userId: 'u-geo', networkId: fx.networkA, role: 'admin' })))
      .send({ targetOfferId: tgt, includeCustomSettings: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.copied).toBe(true);

    // Target must still have exactly 1 rule (not 2 from a duplicate insert),
    // and its payoutOverride is the original from createOfferWithGeoRules (3.0000)
    const rulesAfter = await getGeoRules(tgt);
    expect(rulesAfter.filter((r) => r.country === 'US')).toHaveLength(1);
    expect(rulesAfter[0]!.payoutOverride).toBe('3.0000');
  });

  it('copies non-conflicting source geo rules alongside existing target rules', async () => {
    const src = await createOfferWithGeoRules(fx.networkA, fx.advA, 'SrcOffer3', 'GB');
    const tgt = await createOfferWithGeoRules(fx.networkA, fx.advA, 'TgtOffer3', 'DE');

    // Add a second rule to source (FR) so not all rules conflict
    await request(app)
      .post(`/api/offers/${src}/geo-rules`)
      .set(bearer(operatorToken({ userId: 'u-geo', networkId: fx.networkA, role: 'admin' })))
      .send({ country: 'FR', action: 'allow' });

    const res = await request(app)
      .post(`/api/offers/${src}/copy-settings-to`)
      .set(bearer(operatorToken({ userId: 'u-geo', networkId: fx.networkA, role: 'admin' })))
      .send({ targetOfferId: tgt, includeCustomSettings: true });

    expect(res.status).toBe(200);

    // Target should now have: its original DE + source's FR (new) + source's GB (no conflict with DE)
    const rulesAfter = await getGeoRules(tgt);
    const countries = rulesAfter.map((r) => r.country).sort();
    expect(countries).toContain('DE');
    expect(countries).toContain('GB');
    expect(countries).toContain('FR');
  });
});
