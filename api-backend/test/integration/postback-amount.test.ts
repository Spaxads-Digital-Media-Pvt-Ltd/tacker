/**
 * `amount` is the sale / order value, never the partner payout — on a real Postgres + Redis
 * (INTEGRATION_DB=1, as in CI) — audit F-02.
 *
 * `payout` is the only payout override. `amount` joins sale_amount / order_amount as the base for
 * Percentage / Mixed revenue (explicit names win when several are sent) and leaves payout alone.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('postback amount is the sale value, never the payout (live DB + Redis)', () => {
  let track: FastifyInstance;
  let fx: Fixture;
  let host: string;
  let pctOffer: string;   // Percentage revenue: 10% of the sale amount
  let mixedOffer: string; // Mixed revenue: default 8.00 + 10% of the sale amount

  const click = async (offerId: string): Promise<string> => {
    const r = await track.inject({ method: 'GET', url: `/click?offer_id=${offerId}&pub_id=${fx.pubA1}`, headers: { host } });
    expect(r.statusCode).toBe(302);
    return new URL(r.headers.location as string).pathname.split('/').pop()!;
  };
  /** Click, then an authenticated S2S postback; returns the stored conversion's money. */
  const convert = async (offerId: string, qs: string) => {
    const c = await click(offerId);
    const r = await track.inject({
      method: 'GET', url: `/postback?click_id=${c}&status=approved&secure_code=${fx.secureCodeA}&${qs}`, headers: { host },
    });
    expect(r.statusCode).toBe(200);
    const { rows } = await query<{ payout: string; revenue: string }>(
      `SELECT payout::text AS payout, revenue::text AS revenue FROM conversions WHERE click_id = $1`, [c]);
    expect(rows).toHaveLength(1);
    return rows[0]!;
  };
  const offerWithRevenue = async (revenueType: 'percentage' | 'mixed') =>
    (await query<{ id: string }>(
      `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, default_payout, default_revenue, metadata)
       VALUES ($1, $2, $3, 'active', 'https://shop.example.com/lp/{click_id}', 5.0000, 8.0000, $4) RETURNING id`,
      [fx.networkA, fx.advA, `${revenueType} offer ${randomUUID().slice(0, 8)}`,
        JSON.stringify({ revenue_settings: { revenueType, revenuePct: 10 } })])).rows[0]!.id;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`amount-${randomUUID().slice(0, 8)}`);
    host = `amount-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    pctOffer = await offerWithRevenue('percentage');
    mixedOffer = await offerWithRevenue('mixed');
    setHostResolver(new DbHostResolver());
    track = buildTrackingApp();
    await track.ready();
  });

  describe('fixed-price offer (payout 5.00, revenue 8.00)', () => {
    it('amount=149.99 is a sale value: payout stays the offer default, not 149.99', async () => {
      expect(await convert(fx.offerA, 'amount=149.99&txn_id=A1')).toEqual({ payout: '5.0000', revenue: '8.0000' });
    });

    it('payout=7.50 is still the payout override', async () => {
      expect(await convert(fx.offerA, 'payout=7.50&txn_id=A2')).toEqual({ payout: '7.5000', revenue: '8.0000' });
    });

    it('payout and amount together: payout from `payout`, amount ignored for payout', async () => {
      expect(await convert(fx.offerA, 'payout=7.50&amount=149.99&txn_id=A3')).toEqual({ payout: '7.5000', revenue: '8.0000' });
    });
  });

  describe('percentage revenue offer (10% of the sale amount)', () => {
    it('amount=100 → revenue 10.00 (10% of 100), payout unchanged', async () => {
      expect(await convert(pctOffer, 'amount=100&txn_id=P1')).toEqual({ payout: '5.0000', revenue: '10.0000' });
    });

    it('sale_amount and order_amount keep working as the revenue base', async () => {
      expect(await convert(pctOffer, 'sale_amount=50&txn_id=P2')).toEqual({ payout: '5.0000', revenue: '5.0000' });
      expect(await convert(pctOffer, 'order_amount=30&txn_id=P3')).toEqual({ payout: '5.0000', revenue: '3.0000' });
    });

    it('explicit sale_amount wins over amount when both are sent (older integrations sent amount=<payout>)', async () => {
      expect(await convert(pctOffer, 'sale_amount=200&amount=999&txn_id=P4')).toEqual({ payout: '5.0000', revenue: '20.0000' });
    });

    it('an explicit revenue param still wins over any sale amount', async () => {
      expect(await convert(pctOffer, 'revenue=3&amount=100&txn_id=P5')).toEqual({ payout: '5.0000', revenue: '3.0000' });
    });
  });

  it('mixed revenue: default 8.00 + 10% of amount=100 → 18.00, payout unchanged', async () => {
    expect(await convert(mixedOffer, 'amount=100&txn_id=M1')).toEqual({ payout: '5.0000', revenue: '18.0000' });
  });

  it("a browser-fired pixel's amount never sets revenue either (visitor-controlled, F-01)", async () => {
    const c = await click(pctOffer);
    const r = await track.inject({
      method: 'GET', url: `/pixel?click_id=${c}&status=approved&amount=100`, headers: { host, referer: 'https://shop.example.com/thank-you' },
    });
    expect(r.statusCode).toBe(200);
    const { rows } = await query<{ payout: string; revenue: string }>(
      `SELECT payout::text AS payout, revenue::text AS revenue FROM conversions WHERE click_id = $1`, [c]);
    expect(rows).toEqual([{ payout: '5.0000', revenue: '8.0000' }]);
  });
});
