/**
 * Inbound conversion authentication on a real Postgres + Redis (INTEGRATION_DB=1, as in CI) — audit F-01 / F-14.
 *
 * S2S /postback must carry the network's (or the offer's) secure_code and fails closed without one;
 * browser-fired /pixel and /iframe must come from the offer's own site and never set the price.
 * Nothing is written — no conversion, no ledger — for a rejected request.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { invalidateOfferConfig, invalidateNetworkOfferConfigs } from '../../src/surfaces/tracking/offer-cache.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('inbound conversion auth: postback secure_code + pixel/iframe origin binding (live DB + Redis)', () => {
  let track: FastifyInstance;
  let fx: Fixture;
  let host: string;
  const ADVERTISER_PAGE = 'https://adv.example.com/thank-you';

  const click = async (): Promise<string> => {
    const r = await track.inject({ method: 'GET', url: `/click?offer_id=${fx.offerA}&pub_id=${fx.pubA1}`, headers: { host } });
    expect(r.statusCode).toBe(302);
    return new URL(r.headers.location as string).pathname.split('/').pop()!;
  };
  const postback = (qs: string) => track.inject({ method: 'GET', url: `/postback?${qs}`, headers: { host } });
  const fire = (path: '/pixel' | '/iframe', qs: string, headers: Record<string, string> = {}) =>
    track.inject({ method: 'GET', url: `${path}?${qs}`, headers: { host, ...headers } });
  const conversions = async (clickId: string) => (await query<{ status: string; payout: string; revenue: string; conversion_id: string }>(
    `SELECT status, payout::text AS payout, revenue::text AS revenue, conversion_id FROM conversions WHERE click_id = $1`, [clickId])).rows;
  const ledger = async (clickId: string) => (await query<{ account_type: string; entry_type: string; amount: string }>(
    `SELECT l.account_type, l.entry_type, l.amount::text AS amount
       FROM ledger_entries l JOIN conversions c ON c.conversion_id = l.conversion_id AND c.network_id = l.network_id
      WHERE c.click_id = $1 ORDER BY l.account_type`, [clickId])).rows;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`auth-${randomUUID().slice(0, 8)}`);
    host = `auth-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    // Click id in the PATH so it's easy to read back from the redirect; the landing site is adv.example.com.
    await query(`UPDATE offers SET destination_url = 'https://adv.example.com/lp/{click_id}' WHERE id = $1`, [fx.offerA]);
    setHostResolver(new DbHostResolver());
    track = buildTrackingApp();
    await track.ready();
  });

  describe('S2S /postback', () => {
    it('without a secure_code → 403, and no conversion or ledger row is written', async () => {
      const c = await click();
      const r = await postback(`click_id=${c}&status=approved&payout=9999&txn_id=NO-CODE`);
      expect(r.statusCode).toBe(403);
      expect(await conversions(c)).toEqual([]);
      expect(await ledger(c)).toEqual([]);
    });

    it('with a wrong secure_code → 403, nothing written', async () => {
      const c = await click();
      const r = await postback(`click_id=${c}&status=approved&secure_code=${fx.secureCodeB}&txn_id=WRONG-CODE`);
      expect(r.statusCode).toBe(403);
      expect(await conversions(c)).toEqual([]);
    });

    it("with the network's secure_code → 200, exactly one approved conversion + earning/billing", async () => {
      const c = await click();
      const r = await postback(`click_id=${c}&status=approved&secure_code=${fx.secureCodeA}&txn_id=GOOD-CODE`);
      expect(r.statusCode).toBe(200);
      expect(r.json().status).toBe('approved');
      expect(await conversions(c)).toHaveLength(1);
      expect(await ledger(c)).toEqual([
        { account_type: 'advertiser', entry_type: 'billing', amount: '8.0000' },
        { account_type: 'publisher', entry_type: 'earning', amount: '5.0000' },
      ]);
    });

    it("an offer's own secure_code overrides the network code", async () => {
      await query(`UPDATE offers SET security_code = 'OfferOnlyCode42' WHERE id = $1`, [fx.offerA]);
      await invalidateOfferConfig(fx.networkA, fx.offerA);
      try {
        const c = await click();
        expect((await postback(`click_id=${c}&status=approved&secure_code=${fx.secureCodeA}&txn_id=OFFER-1`)).statusCode).toBe(403);
        const ok = await postback(`click_id=${c}&status=approved&secure_code=OfferOnlyCode42&txn_id=OFFER-2`);
        expect(ok.statusCode).toBe(200);
        expect(await conversions(c)).toHaveLength(1);
      } finally {
        await query(`UPDATE offers SET security_code = NULL WHERE id = $1`, [fx.offerA]);
        await invalidateOfferConfig(fx.networkA, fx.offerA);
      }
    });

    it('fails closed: with no code configured at all (Settings > Security "Clear"), every postback → 403', async () => {
      await query(`UPDATE networks SET postback_security_code = NULL WHERE id = $1`, [fx.networkA]);
      await invalidateNetworkOfferConfigs(fx.networkA);
      try {
        const c = await click();
        expect((await postback(`click_id=${c}&status=approved&txn_id=CLEARED-1`)).statusCode).toBe(403);
        expect((await postback(`click_id=${c}&status=approved&secure_code=${fx.secureCodeA}&txn_id=CLEARED-2`)).statusCode).toBe(403);
        expect(await conversions(c)).toEqual([]);
      } finally {
        await query(`UPDATE networks SET postback_security_code = $2 WHERE id = $1`, [fx.networkA, fx.secureCodeA]);
        await invalidateNetworkOfferConfigs(fx.networkA);
      }
    });
  });

  describe('browser-fired /pixel and /iframe', () => {
    it("a pixel from the advertiser's page records at the offer price — client payout/revenue/sale_amount ignored", async () => {
      const c = await click();
      const r = await fire('/pixel', `click_id=${c}&status=approved&payout=9999&amount=9999&revenue=9999&sale_amount=9999`, { referer: ADVERTISER_PAGE });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toBe('image/gif');
      const rows = await conversions(c);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'approved', payout: '5.0000', revenue: '8.0000' });
      expect(await ledger(c)).toEqual([
        { account_type: 'advertiser', entry_type: 'billing', amount: '8.0000' },
        { account_type: 'publisher', entry_type: 'earning', amount: '5.0000' },
      ]);
    });

    it('a pixel with no Referer / Origin records nothing (the gif is still served)', async () => {
      const c = await click();
      const r = await fire('/pixel', `click_id=${c}&status=approved`);
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toBe('image/gif');
      expect(await conversions(c)).toEqual([]);
    });

    it("a pixel fired from a partner's own site (pixel stuffing) records nothing", async () => {
      const c = await click();
      await fire('/pixel', `click_id=${c}&status=approved`, { referer: 'https://partner-blog.test/review' });
      expect(await conversions(c)).toEqual([]);
    });

    it("an iframe from the advertiser's checkout subdomain records at the offer price", async () => {
      const c = await click();
      const r = await fire('/iframe', `click_id=${c}&status=approved&payout=500`, { referer: 'https://checkout.example.com/done' });
      expect(r.statusCode).toBe(200);
      expect(await conversions(c)).toMatchObject([{ status: 'approved', payout: '5.0000' }]);
    });
  });

  it('every new network gets a postback secure_code by default (any insert path)', async () => {
    const { rows } = await query<{ code: string | null }>(
      `INSERT INTO networks (name, slug) VALUES ($1, $2) RETURNING postback_security_code AS code`,
      ['Default Code Net', `default-code-${randomUUID().slice(0, 8)}`]);
    expect(rows[0]!.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{12}$/);
  });
});
