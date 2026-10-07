/**
 * End-to-end money flow on a real Postgres + Redis (INTEGRATION_DB=1, as in CI):
 * /click → click_id + Redis attribution → /postback (same click_id) → conversion → ledger, plus the
 * invariants around it: txn_id idempotency backed by the DB unique key, firePartnerPostback only
 * gating the outbound postback, manual approve / reject keeping the append-only ledger exact, partner
 * payout overrides being paid, private-offer enforcement at /click, conversion caps, and conversion
 * imports never writing ledger for a skipped duplicate.
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
import { getRedis } from '../../src/lib/redis.js';
import { getQueue, QUEUE } from '../../src/surfaces/workers/queues.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('money flow: click → postback → conversion → ledger (live DB + Redis)', () => {
  let dash: Express;
  let track: FastifyInstance;
  let fx: Fixture;
  let host: string;
  let auth: { Authorization: string };

  const click = async (qs: string) => {
    const r = await track.inject({ method: 'GET', url: `/click?${qs}`, headers: { host } });
    const loc = r.headers.location as string | undefined;
    return { status: r.statusCode, clickId: loc ? new URL(loc.replace('{click_id}', '')).pathname.split('/').pop()! : null, loc };
  };
  const postback = async (qs: string) => {
    const r = await track.inject({ method: 'GET', url: `/postback?${qs}`, headers: { host } });
    return { status: r.statusCode, body: r.json() as { status: string; conversion_id: string | null } };
  };
  const ledger = async (conversionId: string) => (await query<{ account_type: string; entry_type: string; direction: string; amount: string }>(
    `SELECT account_type, entry_type, direction, amount::text AS amount FROM ledger_entries WHERE conversion_id = $1 ORDER BY created_at, entry_type`,
    [conversionId])).rows;
  const net = async (conversionId: string, accountType: string) => (await query<{ n: string }>(
    `SELECT COALESCE(SUM(CASE direction WHEN 'credit' THEN amount ELSE -amount END), 0)::numeric(14,4)::text AS n
       FROM ledger_entries WHERE conversion_id = $1 AND account_type = $2`, [conversionId, accountType])).rows[0]!.n;
  const outboundJobFor = async (conversionId: string) =>
    (await getQueue(QUEUE.outboundPostback).getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']))
      .some((j) => (j?.data as { conversionId?: string })?.conversionId === conversionId);
  const convert = async (pub: string, txn: string, status = '&status=approved') => {
    const c = await click(`offer_id=${fx.offerA}&pub_id=${pub}`);
    expect(c.status).toBe(302);
    return postback(`click_id=${c.clickId}&txn_id=${txn}${status}`);
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`flow-${randomUUID().slice(0, 8)}`);
    host = `flow-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    // Click id goes in the PATH so it's easy to read back from the redirect.
    await query(`UPDATE offers SET destination_url = 'https://adv.example.com/lp/{click_id}' WHERE id = $1`, [fx.offerA]);
    setHostResolver(new DbHostResolver());
    dash = buildDashboardApp();
    track = buildTrackingApp();
    await track.ready();
    auth = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA }));
  });

  it('click → 302 with a click_id; postback with the same click_id → approved + earning/billing', async () => {
    const c = await click(`offer_id=${fx.offerA}&pub_id=${fx.pubA1}`);
    expect(c.status).toBe(302);
    expect(c.clickId).toMatch(/^[0-9a-f]{32}$/);
    const p = await postback(`click_id=${c.clickId}&txn_id=T1&status=approved`);
    expect(p.body.status).toBe('approved');
    const l = await ledger(p.body.conversion_id!);
    expect(l).toEqual(expect.arrayContaining([
      expect.objectContaining({ account_type: 'publisher', entry_type: 'earning', direction: 'credit', amount: '5.0000' }),
      expect.objectContaining({ account_type: 'advertiser', entry_type: 'billing', direction: 'debit', amount: '8.0000' }),
    ]));
    expect(l).toHaveLength(2);
    expect(await outboundJobFor(p.body.conversion_id!)).toBe(true);

    // Duplicate with the same txn_id — first via the Redis guard, then with it expired (DB unique key).
    expect((await postback(`click_id=${c.clickId}&txn_id=T1&status=approved`)).body.status).toBe('duplicate');
    await getRedis().del(`convidem:${c.clickId}:T1`);
    expect((await postback(`click_id=${c.clickId}&txn_id=T1&status=approved`)).body.status).toBe('duplicate');
    const n = (await query<{ n: number }>(`SELECT COUNT(*)::int n FROM conversions WHERE click_id = $1`, [c.clickId])).rows[0]!.n;
    expect(n).toBe(1);
    expect(await ledger(p.body.conversion_id!)).toHaveLength(2);
  });

  it('firePartnerPostback=false suppresses only the outbound postback — conversion + ledger still happen', async () => {
    await request(dash).patch(`/api/offers/${fx.offerA}`).set(auth).send({ firePartnerPostback: false }).expect(200);
    const p = await convert(fx.pubA1, 'NOFIRE');
    expect(p.body.status).toBe('approved');
    expect(await ledger(p.body.conversion_id!)).toHaveLength(2);
    expect(await outboundJobFor(p.body.conversion_id!)).toBe(false);
    await request(dash).patch(`/api/offers/${fx.offerA}`).set(auth).send({ firePartnerPostback: true }).expect(200);
  });

  it('pending → manual approve writes the ledger once; reject reverses it to exactly zero', async () => {
    const p = await convert(fx.pubA1, 'PEND', '');
    expect(p.body.status).toBe('pending');
    expect(await ledger(p.body.conversion_id!)).toHaveLength(0);
    await request(dash).post(`/api/finance/conversions/${p.body.conversion_id}/approve`).set(auth).expect(200);
    expect(await ledger(p.body.conversion_id!)).toHaveLength(2);
    await request(dash).post(`/api/finance/conversions/${p.body.conversion_id}/approve`).set(auth).expect(400);
    expect(await ledger(p.body.conversion_id!)).toHaveLength(2);
    expect(await outboundJobFor(p.body.conversion_id!)).toBe(true);

    await request(dash).post(`/api/finance/conversions/${p.body.conversion_id}/reject`).set(auth).expect(200);
    expect(await net(p.body.conversion_id!, 'publisher')).toBe('0.0000');
    expect(await net(p.body.conversion_id!, 'advertiser')).toBe('0.0000');
    expect(await ledger(p.body.conversion_id!)).toHaveLength(4); // originals kept, offsets appended
  });

  it("a partner's payout override is what the partner is actually paid", async () => {
    const acc = (await query<{ id: string }>(`SELECT id FROM offer_publisher_access WHERE offer_id = $1 AND publisher_id = $2`, [fx.offerA, fx.pubA1])).rows[0]!;
    await request(dash).patch(`/api/offers/${fx.offerA}/publishers/${acc.id}`).set(auth).send({ payoutOverride: '6.5' }).expect(200);
    const p = await convert(fx.pubA1, 'OVR');
    expect(await ledger(p.body.conversion_id!)).toEqual(expect.arrayContaining([
      expect.objectContaining({ entry_type: 'earning', amount: '6.5000' }),
    ]));
    await request(dash).patch(`/api/offers/${fx.offerA}/publishers/${acc.id}`).set(auth).send({ payoutOverride: null }).expect(200);
  });

  it('private offers only accept clicks from approved partners', async () => {
    await request(dash).patch(`/api/offers/${fx.offerA}`).set(auth).send({ visibility: 'private' }).expect(200);
    expect((await click(`offer_id=${fx.offerA}&pub_id=${fx.pubA2}`)).status).toBe(204); // no grant
    expect((await click(`offer_id=${fx.offerA}`)).status).toBe(204); // no partner at all
    expect((await click(`offer_id=${fx.offerA}&pub_id=${fx.pubA1}`)).status).toBe(302); // approved
    await request(dash).patch(`/api/offers/${fx.offerA}`).set(auth).send({ visibility: 'public' }).expect(200);
    expect((await click(`offer_id=${fx.offerA}&pub_id=${fx.pubA2}`)).status).toBe(302);
  });

  it('total conversion cap: conversions beyond the cap are rejected and never reach the ledger', async () => {
    const counted = (await query<{ n: number }>(`SELECT COUNT(*)::int n FROM conversions WHERE offer_id = $1 AND status <> 'rejected'`, [fx.offerA])).rows[0]!.n;
    await request(dash).patch(`/api/offers/${fx.offerA}`).set(auth).send({ totalConversionCap: counted + 1 }).expect(200);
    expect((await convert(fx.pubA1, 'CAP1')).body.status).toBe('approved');
    const over = await convert(fx.pubA1, 'CAP2');
    expect(over.body.status).toBe('rejected');
    const reason = (await query<{ reason: string }>(`SELECT reason FROM conversions WHERE conversion_id = $1`, [over.body.conversion_id])).rows[0]!.reason;
    expect(reason).toBe('total_conversion_cap_reached');
    expect(await ledger(over.body.conversion_id!)).toHaveLength(0);
    await request(dash).patch(`/api/offers/${fx.offerA}`).set(auth).send({ totalConversionCap: null }).expect(200);
  });

  it('conversion import: a duplicate transaction_id is skipped AND writes no ledger', async () => {
    const ref = (await query<{ ref: string }>(`SELECT ref::text FROM offers WHERE id = $1`, [fx.offerA])).rows[0]!.ref;
    const before = (await query<{ n: number }>(`SELECT COUNT(*)::int n FROM ledger_entries WHERE network_id = $1`, [fx.networkA])).rows[0]!.n;
    const res = await request(dash).post('/api/conversion-imports').set(auth)
      .send({ type: 'create', rows: [{ offerRef: ref, transactionId: 'T1', payout: '1', revenue: '2', status: 'approved' }] });
    expect(res.status).toBe(201);
    expect(res.body.data.error_count).toBe(1);
    const after = (await query<{ n: number }>(`SELECT COUNT(*)::int n FROM ledger_entries WHERE network_id = $1`, [fx.networkA])).rows[0]!.n;
    expect(after).toBe(before);
  });
});
