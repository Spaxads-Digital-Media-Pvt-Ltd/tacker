/**
 * Several conversions per click, Everflow-style — live DB + Redis, through /postback and the dashboard.
 *
 * Each event follows its duplicate rule — its goal's, else the offer's (Edit Offer › Revenue):
 * `unique_txn` (default: many per click, each with its own transaction id), `one_per_click` (one per
 * click per event), `every_postback` (every postback counts; an identical retry within 60 s doesn't).
 * A transaction id is unique per offer + event. Unusual volume from one click is held as pending for
 * review — recorded, never dropped.
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
import { dedupeRule, RETRY_WINDOW_S } from '../../src/surfaces/tracking/conversions/record.js';
import { getRedis } from '../../src/lib/redis.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('multiple conversions per click: duplicate rules per offer and event (live DB + Redis)', () => {
  let dash: Express;
  let track: FastifyInstance;
  let fx: Fixture;
  let host: string;
  let auth: { Authorization: string };

  const click = async (): Promise<string> => {
    const r = await track.inject({ method: 'GET', url: `/click?offer_id=${fx.offerA}&pub_id=${fx.pubA1}`, headers: { host } });
    expect(r.statusCode).toBe(302);
    return new URL((r.headers.location as string).replace('{click_id}', '')).pathname.split('/').pop()!;
  };
  const postback = async (qs: string) =>
    (await track.inject({ method: 'GET', url: `/postback?secure_code=${fx.secureCodeA}&status=approved&${qs}`, headers: { host } })).json() as { status: string; conversion_id: string | null };
  const statuses = async (clickId: string, ...qs: string[]) => {
    const out: string[] = [];
    for (const q of qs) out.push((await postback(`click_id=${clickId}&${q}`)).status);
    return out;
  };
  const convs = async (clickId: string) => (await query<{ event_name: string | null; transaction_id: string | null; status: string; reason: string | null }>(
    `SELECT event_name, transaction_id, status, reason FROM conversions WHERE network_id = $1 AND click_id = $2 ORDER BY created_at`,
    [fx.networkA, clickId])).rows;
  const revenueSettings = async () => (await request(dash).get(`/api/offers/${fx.offerA}`).set(auth).expect(200)).body.data.revenueSettings as Record<string, unknown>;
  const setRevenue = async (patch: Record<string, unknown>, drop: string[] = []) => {
    const next = { ...(await revenueSettings()), ...patch };
    for (const k of drop) delete next[k];
    await request(dash).patch(`/api/offers/${fx.offerA}`).set(auth).send({ revenueSettings: next }).expect(200);
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`multi-${randomUUID().slice(0, 8)}`);
    host = `multi-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    await query(`UPDATE offers SET destination_url = 'https://adv.example.com/lp/{click_id}' WHERE id = $1`, [fx.offerA]);
    setHostResolver(new DbHostResolver());
    dash = buildDashboardApp();
    track = buildTrackingApp();
    await track.ready();
    auth = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA }));
  });

  it('default (unique transaction id): one click converts many times — upsells, renewals, rev-share sales', async () => {
    expect((await revenueSettings())['duplicateMode']).toBe('unique_txn');
    const c = await click();
    expect(await statuses(c, 'txn_id=U1', 'txn_id=U2', 'txn_id=U3', 'txn_id=U2')).toEqual(['approved', 'approved', 'approved', 'duplicate']);
    // The same advertiser order id under another event (a lead, then its sale) is its own conversion.
    expect(await statuses(c, 'txn_id=U1&event=upsell', 'txn_id=U1&event=upsell')).toEqual(['approved', 'duplicate']);
    // Without a transaction id: once per click + event.
    expect(await statuses(c, 'event=signup', 'event=signup')).toEqual(['approved', 'duplicate']);
    expect(await convs(c)).toHaveLength(5);
  });

  it('a transaction id is unique per offer + event — also across clicks, and after the Redis key expires', async () => {
    const [c1, c2] = [await click(), await click()];
    expect(await statuses(c1, 'txn_id=X1')).toEqual(['approved']);
    expect(await statuses(c2, 'txn_id=X1')).toEqual(['duplicate']);
    await getRedis().del(dedupeRule({ networkId: fx.networkA, offerId: fx.offerA, clickId: c2, event: null, txnId: 'X1', mode: 'unique_txn' }).key);
    expect(await statuses(c2, 'txn_id=X1')).toEqual(['duplicate']); // the DB index
    expect(await convs(c2)).toHaveLength(0);
  });

  it('one per click: one conversion per click per event, whatever the transaction id — also after the Redis key expires', async () => {
    await setRevenue({ duplicateMode: 'one_per_click' });
    expect((await revenueSettings())['allowDuplicates']).toBe(false); // kept in step for older clients
    const c = await click();
    expect(await statuses(c, 'txn_id=A', 'txn_id=B')).toEqual(['approved', 'duplicate']);
    // Per event, like Everflow's per-event toggle: the click's upsell still converts once.
    expect(await statuses(c, 'event=upsell&txn_id=C', 'event=upsell&txn_id=D')).toEqual(['approved', 'duplicate']);
    for (const event of [null, 'upsell']) {
      await getRedis().del(dedupeRule({ networkId: fx.networkA, offerId: fx.offerA, clickId: c, event, txnId: null, mode: 'one_per_click' }).key);
    }
    expect(await statuses(c, 'txn_id=E', 'event=upsell&txn_id=F')).toEqual(['duplicate', 'duplicate']);
    expect((await convs(c)).map((v) => v.transaction_id)).toEqual(['A', 'C']);
    await setRevenue({ duplicateMode: 'unique_txn' });
  });

  it('an older client that only sends allowDuplicates still works: false → one per click, true → unique transaction ids', async () => {
    await setRevenue({ allowDuplicates: false }, ['duplicateMode']);
    expect(await revenueSettings()).toMatchObject({ duplicateMode: 'one_per_click', allowDuplicates: false });
    await setRevenue({ allowDuplicates: true }, ['duplicateMode']);
    expect(await revenueSettings()).toMatchObject({ duplicateMode: 'unique_txn', allowDuplicates: true });
  });

  it('every postback (per event): recurring billing without a transaction id counts each time; an identical retry within 60 s does not', async () => {
    const goal = await request(dash).post(`/api/offers/${fx.offerA}/goals`).set(auth)
      .send({ name: 'Renewal', eventName: 'renewal', payout: '1', revenue: '2', duplicateMode: 'every_postback' });
    expect(goal.status).toBe(201);
    expect(goal.body.data.duplicateMode).toBe('every_postback');
    const c = await click();
    expect(await statuses(c, 'event=renewal&amount=10', 'event=renewal&amount=10', 'event=renewal&amount=12'))
      .toEqual(['approved', 'duplicate', 'approved']);
    // The retry window has passed: the same request is a new renewal.
    expect(RETRY_WINDOW_S).toBe(60);
    const rawParams = { secure_code: fx.secureCodeA, status: 'approved', click_id: c, event: 'renewal', amount: '10' };
    await getRedis().del(dedupeRule({ networkId: fx.networkA, offerId: fx.offerA, clickId: c, event: 'renewal', txnId: null, mode: 'every_postback', rawParams }).key);
    expect(await statuses(c, 'event=renewal&amount=10')).toEqual(['approved']);
    // A transaction id seen before for the event is still a duplicate.
    expect(await statuses(c, 'event=renewal&txn_id=R1', 'event=renewal&txn_id=R1')).toEqual(['approved', 'duplicate']);
    // Other events follow the offer's rule (unique transaction ids): once per click without one.
    expect(await statuses(c, 'event=lead', 'event=lead')).toEqual(['approved', 'duplicate']);
    expect((await convs(c)).filter((v) => v.event_name === 'renewal')).toHaveLength(4);
  });

  it("the event's own rule beats the offer's", async () => {
    await setRevenue({ duplicateMode: 'one_per_click' });
    const c = await click();
    expect(await statuses(c, 'event=renewal&amount=1', 'event=renewal&amount=2')).toEqual(['approved', 'approved']);
    expect(await statuses(c, 'txn_id=P1', 'txn_id=P2')).toEqual(['approved', 'duplicate']);
    await setRevenue({ duplicateMode: 'unique_txn' });
  });

  it('unusual volume from one click is held as pending for review — recorded, never dropped (and a retry is not a second one)', async () => {
    await setRevenue({ clickConversionLimit: 2 });
    const c = await click();
    expect(await statuses(c, 'txn_id=V1', 'txn_id=V2', 'txn_id=V3', 'txn_id=V3')).toEqual(['approved', 'approved', 'pending', 'duplicate']);
    expect((await convs(c)).map((v) => [v.transaction_id, v.status, v.reason])).toEqual([
      ['V1', 'approved', null], ['V2', 'approved', null], ['V3', 'pending', 'held_unusual_volume'],
    ]);
    // 0 = no limit.
    await setRevenue({ clickConversionLimit: 0 });
    const c2 = await click();
    expect(await statuses(c2, 'txn_id=W1', 'txn_id=W2', 'txn_id=W3', 'txn_id=W4')).toEqual(['approved', 'approved', 'approved', 'approved']);
    await setRevenue({ clickConversionLimit: 10 });
  });

  it('conversion import: a transaction id is unique per offer + event; an update by transaction id names the event when it is ambiguous', async () => {
    const ref = (await query<{ ref: string }>(`SELECT ref::text FROM offers WHERE id = $1`, [fx.offerA])).rows[0]!.ref;
    const created = await request(dash).post('/api/conversion-imports').set(auth).send({ type: 'create', rows: [
      { offerRef: ref, transactionId: 'IMP1', event: 'lead', payout: '1', revenue: '2', status: 'pending' },
      { offerRef: ref, transactionId: 'IMP1', event: 'sale', payout: '1', revenue: '2', status: 'pending' },
      { offerRef: ref, transactionId: 'IMP1', event: 'sale', payout: '1', revenue: '2', status: 'pending' },
    ] });
    expect(created.status).toBe(201);
    expect(created.body.data.total_processed).toBe(2);
    expect(created.body.data.errors[0].message).toMatch(/already exists for this offer and event/);
    const ambiguous = await request(dash).post('/api/conversion-imports').set(auth)
      .send({ type: 'update_by_transaction_id', rows: [{ offerRef: ref, transactionId: 'IMP1', payout: '3' }] });
    expect(ambiguous.body.data.errors[0].message).toMatch(/matches 2 conversions on different offers or events/);
    const byEvent = await request(dash).post('/api/conversion-imports').set(auth)
      .send({ type: 'update_by_transaction_id', rows: [{ offerRef: ref, transactionId: 'IMP1', event: 'sale', payout: '3' }] });
    expect(byEvent.body.data.total_processed).toBe(1);
    const { rows } = await query<{ event_name: string; payout: string }>(
      `SELECT event_name, payout::text FROM conversions WHERE network_id = $1 AND transaction_id = 'IMP1' ORDER BY event_name`, [fx.networkA]);
    expect(rows).toEqual([{ event_name: 'lead', payout: '1.0000' }, { event_name: 'sale', payout: '3.0000' }]);
  });
});
