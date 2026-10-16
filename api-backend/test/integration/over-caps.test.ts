/**
 * Over caps + rejected clicks (Everflow standard) — live DB + Redis.
 *
 *  - A conversion past a cap is HELD as pending with the cap as its reason, for an admin to approve or
 *    reject — never rejected, never dropped. Held ones don't use up the cap; approving one books it.
 *  - A click /click doesn't send to the offer (cap exceeded, partner blocked / not approved, geo,
 *    offer paused, …) is recorded as an invalid click carrying the reason. It never converts, the
 *    partner's own reports leave it out, the admin's show it as invalid.
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
import { getQueue, QUEUE } from '../../src/surfaces/workers/queues.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, portalToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

interface ClickJobData { networkId: string; offerId: string; publisherId: string | null; fraudFlags: string[]; resolvedPayout: string; isUnique: boolean; clickId: string }

d('over caps (held as pending) + rejected clicks recorded with the reason (live DB + Redis)', () => {
  let dash: Express;
  let track: FastifyInstance;
  let fx: Fixture;
  let host: string;
  let auth: { Authorization: string };

  const newOffer = async (name: string) => (await query<{ id: string }>(
    `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, default_payout, default_revenue)
     VALUES ($1, $2, $3, 'active', 'https://adv.example.com/lp/{click_id}', 5, 8) RETURNING id`, [fx.networkA, fx.advA, name])).rows[0]!.id;
  const click = (offerId: string, pub: string | null = fx.pubA1, qs = '') =>
    track.inject({ method: 'GET', url: `/click?offer_id=${offerId}${pub ? `&pub_id=${pub}` : ''}${qs}`, headers: { host } });
  const clickId = async (offerId: string) => {
    const r = await click(offerId);
    expect(r.statusCode).toBe(302);
    return new URL(r.headers.location as string).pathname.split('/').pop()!;
  };
  const convert = async (offerId: string, qs = '') => {
    const c = await clickId(offerId);
    const r = await track.inject({ method: 'GET', url: `/postback?secure_code=${fx.secureCodeA}&click_id=${c}&status=approved&txn_id=${randomUUID()}${qs}`, headers: { host } });
    return r.json() as { status: string; conversion_id: string };
  };
  const conv = async (id: string) => (await query<{ status: string; reason: string | null }>(
    'SELECT status, reason FROM conversions WHERE network_id = $1 AND conversion_id = $2', [fx.networkA, id])).rows[0]!;
  const ledgerRows = async (id: string) => (await query('SELECT 1 FROM ledger_entries WHERE network_id = $1 AND conversion_id = $2', [fx.networkA, id])).rows.length;
  const capUsage = async (offerId: string) => ((await request(dash).get('/api/reports/caps').set(auth).expect(200)).body.data as { id: string; conversions_today: number; conversions_total: number }[])
    .find((r) => r.id === offerId)!;
  const rejectedJobs = async (offerId: string): Promise<ClickJobData[]> => (await getQueue(QUEUE.clickPersist).getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']))
    .map((j) => j?.data as ClickJobData | undefined)
    .filter((j): j is ClickJobData => !!j && j.offerId === offerId && j.fraudFlags.length > 0);

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`caps-${randomUUID().slice(0, 8)}`);
    host = `caps-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    setHostResolver(new DbHostResolver());
    dash = buildDashboardApp();
    track = buildTrackingApp();
    await track.ready();
    auth = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA }));
  });

  it('offer daily cap: past it conversions are held as pending "Over caps" — they don’t use up the cap; approving one books it', async () => {
    const offer = await newOffer('Capped');
    await request(dash).patch(`/api/offers/${offer}`).set(auth).send({ dailyConversionCap: 2 }).expect(200);
    const results = [await convert(offer), await convert(offer), await convert(offer), await convert(offer)];
    expect(results.map((r) => r.status)).toEqual(['approved', 'approved', 'pending', 'pending']);
    const held = results.slice(2);
    for (const h of held) {
      expect(await conv(h.conversion_id)).toEqual({ status: 'pending', reason: 'daily_conversion_cap_reached' });
      expect(await ledgerRows(h.conversion_id)).toBe(0);
    }
    expect(await capUsage(offer)).toMatchObject({ conversions_today: 2, conversions_total: 2 }); // held ones don't count

    const list = await request(dash).get(`/api/reports/conversions?overCaps=true&offerId=${offer}`).set(auth).expect(200);
    expect(list.body.data.map((r: { conversion_id: string }) => r.conversion_id).sort()).toEqual(held.map((h) => h.conversion_id).sort());

    await request(dash).post(`/api/finance/conversions/${held[0]!.conversion_id}/approve`).set(auth).send({}).expect(200);
    expect((await conv(held[0]!.conversion_id)).status).toBe('approved');
    expect(await ledgerRows(held[0]!.conversion_id)).toBe(2);
    expect(await capUsage(offer)).toMatchObject({ conversions_today: 3 }); // approved past the cap: it counts now
    await request(dash).post(`/api/finance/conversions/${held[1]!.conversion_id}/reject`).set(auth).send({}).expect(200);
    expect((await request(dash).get(`/api/reports/conversions?overCaps=true&offerId=${offer}`).set(auth).expect(200)).body.data).toEqual([]);
    expect(await capUsage(offer)).toMatchObject({ conversions_today: 3 });
  });

  it('an event’s own cap holds that event only', async () => {
    const offer = await newOffer('Goal capped');
    await request(dash).post(`/api/offers/${offer}/goals`).set(auth).send({ name: 'Sale', eventName: 'sale', payout: '1', revenue: '2', dailyConversionCap: 1 }).expect(201);
    expect((await convert(offer, '&event=sale')).status).toBe('approved');
    const over = await convert(offer, '&event=sale');
    expect(over.status).toBe('pending');
    expect((await conv(over.conversion_id)).reason).toBe('goal_daily_conversion_cap_reached');
    expect((await convert(offer, '&event=lead')).status).toBe('approved');
  });

  it('clicks past the daily click cap are recorded as invalid "cap_exceeded" on the partner — no payout, not unique', async () => {
    const offer = await newOffer('Click capped');
    await request(dash).patch(`/api/offers/${offer}`).set(auth).send({ dailyClickCap: 1 }).expect(200);
    expect((await click(offer)).statusCode).toBe(302);
    expect((await click(offer)).statusCode).toBe(204); // diverted (no fallback URL)
    const jobs = await rejectedJobs(offer);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ publisherId: fx.pubA1, fraudFlags: ['cap_exceeded'], resolvedPayout: '0.0000', isUnique: false });
  });

  it('every other rejection is recorded with its own reason', async () => {
    const offer = await newOffer('Rejections');
    // Partner A2 blocked on the offer; only GB visitors allowed (set before the offer config is cached).
    await query(`INSERT INTO offer_publisher_access (network_id, offer_id, publisher_id, access, approval_status) VALUES ($1, $2, $3, 'deny', 'approved')`, [fx.networkA, offer, fx.pubA2]);
    await query(`INSERT INTO offer_geo_rules (network_id, offer_id, country, action) VALUES ($1, $2, 'GB', 'allow')`, [fx.networkA, offer]);
    await request(dash).patch(`/api/offers/${offer}`).set(auth).send({ status: 'paused' }).expect(200);
    expect((await click(offer, fx.pubA1, '&geo=GB')).statusCode).toBe(204);
    await request(dash).patch(`/api/offers/${offer}`).set(auth).send({ status: 'active' }).expect(200);
    expect((await click(offer, fx.pubA2, '&geo=GB')).statusCode).toBe(204);
    expect((await click(offer, fx.pubA1, '&geo=US')).statusCode).toBe(204);
    expect((await click(offer, fx.pubA1, '&geo=GB')).statusCode).toBe(302);
    const jobs = await rejectedJobs(offer);
    expect(jobs.map((j) => j.fraudFlags[0]).sort()).toEqual(['geo_not_allowed', 'offer_not_active', 'partner_blocked']);
    expect(jobs.find((j) => j.fraudFlags[0] === 'partner_blocked')!.publisherId).toBe(fx.pubA2);
  });

  it('a rejected click never converts — not even when its id is known', async () => {
    const offer = await newOffer('Never converts');
    const id = randomUUID().replace(/-/g, '');
    await query(`INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, fraud_flags, is_unique) VALUES ($1, $2, $3, $4, ARRAY['cap_exceeded'], false)`,
      [id, fx.networkA, offer, fx.pubA1]);
    const r = await track.inject({ method: 'GET', url: `/postback?secure_code=${fx.secureCodeA}&click_id=${id}&txn_id=x`, headers: { host } });
    expect(r.statusCode).toBe(404);
  });

  it("the partner's own reports leave rejected clicks out; the admin's show them as invalid", async () => {
    const offer = await newOffer('Portal view');
    const ins = (flags: string[]) => query(
      `INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, fraud_flags, is_unique, created_at) VALUES ($1, $2, $3, $4, $5, $6, now() - interval '1 hour')`,
      [randomUUID().replace(/-/g, ''), fx.networkA, offer, fx.pubA1, flags, flags.length === 0]);
    await ins([]); await ins(['datacenter_ip']); await ins(['cap_exceeded']); await ins(['partner_blocked']);
    const portal = bearer(portalToken({ userId: randomUUID(), networkId: fx.networkA, kind: 'publisher', ownerId: fx.pubA1 }));
    const stats = await request(dash).get(`/api/portal/publisher/stats?groupBy=offer&offerId=${offer}`).set(portal).expect(200);
    const row = stats.body.data.rows.find((r: { dimensions: { offer: string } }) => r.dimensions.offer === offer);
    expect(row.metrics.clicks).toBe(2); // the clean click + the flagged one that was still sent on
    const admin = await request(dash).get(`/api/reports?groupBy=offer&offerId=${offer}&metrics=clicks,invalid_clicks`).set(auth).expect(200);
    expect(admin.body.data.rows[0].metrics).toMatchObject({ clicks: 4, invalid_clicks: 3 });
  });
});
