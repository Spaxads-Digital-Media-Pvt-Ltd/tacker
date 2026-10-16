/**
 * Offer Custom Settings save correctly and are ENFORCED — on a real Postgres + Redis
 * (INTEGRATION_DB=1, as in CI) — audit F-12.
 *
 * The API takes the v2 typed fields (the legacy {event, value} shape no longer "saves" an empty
 * row), offerId is required and status is active|inactive (validation errors, not 500s). At runtime a
 * partner's custom payout/revenue, landing page, click + conversion caps and throttle rate apply to
 * that partner only; every write busts the offer's cached config.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { FastifyInstance } from 'fastify';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('Offer Custom Settings: saved as v2 and enforced (live DB + Redis)', () => {
  let dash: Express;
  let track: FastifyInstance;
  let fx: Fixture;
  let host: string;
  let admin: { Authorization: string };

  const offer = async () => (await query<{ id: string }>(
    `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, default_payout, default_revenue)
     VALUES ($1, $2, $3, 'active', 'https://shop.example.com/lp?cid={click_id}', 5, 8) RETURNING id`,
    [fx.networkA, fx.advA, `F-12 offer ${randomUUID().slice(0, 6)}`])).rows[0]!.id;
  const save = (body: Record<string, unknown>) => request(dash).post('/api/offer-custom-settings').set(admin).send(body);
  const click = async (offerId: string, pub: string) => track.inject({ method: 'GET', url: `/click?offer_id=${offerId}&pub_id=${pub}`, headers: { host } });
  const clickId = async (offerId: string, pub: string) => {
    const r = await click(offerId, pub);
    expect(r.statusCode).toBe(302);
    return new URL(r.headers.location as string).searchParams.get('cid')!;
  };
  const convert = async (offerId: string, pub: string, qs = '') => {
    const c = await clickId(offerId, pub);
    const r = await track.inject({ method: 'GET', url: `/postback?click_id=${c}&status=approved&txn_id=${randomUUID()}&secure_code=${fx.secureCodeA}${qs}`, headers: { host } });
    expect(r.statusCode).toBe(200);
    return (await query<{ payout: string; revenue: string; status: string; reason: string | null }>(
      `SELECT payout::text, revenue::text, status, reason FROM conversions WHERE network_id = $1 AND click_id = $2`, [fx.networkA, c])).rows[0]!;
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`cs-${randomUUID().slice(0, 8)}`);
    host = `cs-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    setHostResolver(new DbHostResolver());
    track = buildTrackingApp();
    await track.ready();
    dash = buildDashboardApp();
    admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA }));
  });

  describe('API', () => {
    it('the legacy {event, value} shape, a "paused" status or a missing offerId are validation errors — never a silent empty save or a 500', async () => {
      const id = await offer();
      const legacy = await save({ category: 'caps', offerId: id, name: 'Daily cap', event: 'Daily Click Cap', value: 100 });
      expect(legacy.status).toBe(400);
      expect(legacy.body.error.message).toMatch(/needs at least one cap/);
      expect((await save({ category: 'caps', offerId: id, capType: 'clicks', capValue: 5, status: 'paused' })).status).toBe(422);
      expect((await save({ category: 'caps', capType: 'clicks', capValue: 5 })).status).toBe(422);
      expect((await query(`SELECT 1 FROM offer_custom_settings WHERE offer_id = $1`, [id])).rows).toHaveLength(0);
    });

    it('saves the typed v2 fields (incl. the flat single-cap shorthand) and reads them back', async () => {
      const id = await offer();
      const res = await save({ category: 'caps', offerId: id, partnerId: fx.pubA1, capType: 'conversions', capInterval: 'weekly', capValue: 25 });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        category: 'caps', offerId: id, partnerId: fx.pubA1, applyAllPartners: false, status: 'active',
        caps: { conversions: { weekly: 25 } }, capType: 'conversions', capInterval: 'weekly', capValue: 25,
      });
      const pay = await save({ category: 'revenue_payout', offerId: id, partnerIds: [fx.pubA1], payoutModel: 'CPS', payoutValue: '12.5' });
      expect(pay.body.data).toMatchObject({ applyCustomPayout: true, payoutModel: 'CPS', payoutValue: '12.5000', applyCustomRevenue: false });
      const got = await request(dash).get(`/api/offer-custom-settings/${pay.body.data.id}`).set(admin);
      expect(got.status).toBe(200);
      const patched = await request(dash).patch(`/api/offer-custom-settings/${res.body.data.id}`).set(admin).send({ status: 'inactive' });
      expect(patched.body.data.status).toBe('inactive');
    });

    it('partners and goals must belong here', async () => {
      const id = await offer();
      expect((await save({ category: 'throttle_rates', offerId: id, partnerId: fx.pubB1, throttleRate: 10 })).status).toBe(400);
      const other = await offer();
      const { rows } = await query<{ id: string }>(`INSERT INTO offer_goals (network_id, offer_id, name) VALUES ($1, $2, 'Sale') RETURNING id`, [fx.networkA, other]);
      const res = await save({ category: 'revenue_payout', offerId: id, payoutValue: 3, goalId: rows[0]!.id });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('goalId must be a goal of this offer.');
    });
  });

  describe('runtime', () => {
    it("a partner's custom payout/revenue overrides the default for that partner only (explicit S2S payout still wins)", async () => {
      const id = await offer();
      expect((await save({ category: 'revenue_payout', offerId: id, partnerIds: [fx.pubA1], payoutValue: 9, revenueValue: 14 })).status).toBe(201);
      expect(await convert(id, fx.pubA1)).toMatchObject({ payout: '9.0000', revenue: '14.0000', status: 'approved' });
      expect(await convert(id, fx.pubA2)).toMatchObject({ payout: '5.0000', revenue: '8.0000' });
      expect(await convert(id, fx.pubA1, '&payout=7')).toMatchObject({ payout: '7.0000' });
    });

    it('CPS = a % of the reported sale amount; a goal-scoped setting prices only that goal', async () => {
      const id = await offer();
      await save({ category: 'revenue_payout', offerId: id, partnerIds: [fx.pubA1], payoutModel: 'CPS', payoutValue: 10 });
      expect(await convert(id, fx.pubA1, '&sale_amount=200')).toMatchObject({ payout: '20.0000' });

      const id2 = await offer();
      const { rows } = await query<{ id: string }>(
        `INSERT INTO offer_goals (network_id, offer_id, name, event_name, payout) VALUES ($1, $2, 'Upsell', 'upsell', 3) RETURNING id`, [fx.networkA, id2]);
      await save({ category: 'revenue_payout', offerId: id2, partnerIds: [fx.pubA1], payoutValue: 6, goalId: rows[0]!.id });
      expect(await convert(id2, fx.pubA1, '&event=upsell')).toMatchObject({ payout: '6.0000' });
      expect(await convert(id2, fx.pubA1)).toMatchObject({ payout: '5.0000' }); // the base conversion keeps its rate
    });

    it("a partner's custom landing page replaces the destination for them only", async () => {
      const id = await offer();
      await save({ category: 'landing_pages', offerId: id, partnerIds: [fx.pubA1], landingPageUrl: 'https://vip.example.com/lp?c={click_id}' });
      const mine = await click(id, fx.pubA1);
      expect(mine.headers.location).toMatch(/^https:\/\/vip\.example\.com\/lp\?c=[0-9a-f]{32}$/);
      expect((await click(id, fx.pubA2)).headers.location).toMatch(/^https:\/\/shop\.example\.com\/lp/);
    });

    it('per-partner click caps divert past the cap; conversion caps hold past the cap (pending, Over caps)', async () => {
      const id = await offer();
      await save({ category: 'caps', offerId: id, partnerId: fx.pubA1, capType: 'clicks', capInterval: 'daily', capValue: 2 });
      expect((await click(id, fx.pubA1)).statusCode).toBe(302);
      expect((await click(id, fx.pubA1)).statusCode).toBe(302);
      expect((await click(id, fx.pubA1)).statusCode).toBe(204); // capped → diverted (no fallback URL)
      expect((await click(id, fx.pubA2)).statusCode).toBe(302); // other partners unaffected

      const id2 = await offer();
      await save({ category: 'caps', offerId: id2, partnerId: fx.pubA1, capType: 'conversions', capInterval: 'daily', capValue: 1 });
      expect(await convert(id2, fx.pubA1)).toMatchObject({ status: 'approved' });
      expect(await convert(id2, fx.pubA1)).toMatchObject({ status: 'pending', reason: 'custom_conversion_cap_reached' });
      expect(await convert(id2, fx.pubA2)).toMatchObject({ status: 'approved' });
    });

    it('throttle rate sets that share of the partner’s conversions to the chosen status', async () => {
      const id = await offer();
      await save({ category: 'throttle_rates', offerId: id, partnerId: fx.pubA1, throttleRate: 100 });
      expect(await convert(id, fx.pubA1)).toMatchObject({ status: 'rejected', reason: 'custom_throttle' });
      const id2 = await offer();
      await save({ category: 'throttle_rates', offerId: id2, partnerId: fx.pubA1, throttleRate: 100, conversionStatus: 'pending' });
      expect(await convert(id2, fx.pubA1)).toMatchObject({ status: 'pending', reason: 'custom_throttle' });
    });

    it('a not-yet-effective or inactive setting does nothing, and edits apply on the next click', async () => {
      const id = await offer();
      await save({ category: 'revenue_payout', offerId: id, partnerIds: [fx.pubA1], payoutValue: 9, effectiveFrom: '2099-01-01T00:00:00Z' });
      expect(await convert(id, fx.pubA1)).toMatchObject({ payout: '5.0000' });

      const id2 = await offer();
      const s = await save({ category: 'revenue_payout', offerId: id2, partnerIds: [fx.pubA1], payoutValue: 9 });
      expect(await convert(id2, fx.pubA1)).toMatchObject({ payout: '9.0000' }); // config now cached with the setting
      await request(dash).patch(`/api/offer-custom-settings/${s.body.data.id}`).set(admin).send({ status: 'inactive' });
      expect(await convert(id2, fx.pubA1)).toMatchObject({ payout: '5.0000' });
    });
  });
});
