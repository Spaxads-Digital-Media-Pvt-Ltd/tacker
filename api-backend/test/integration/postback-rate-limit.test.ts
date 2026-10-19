/**
 * Postback rate limits (O3) — live DB + Redis, the tracking surface with its limits ON.
 *
 * An authenticated postback (the network's security code) is never throttled: an advertiser's server
 * may send any number, and several per click. Only FAILED postbacks (wrong / missing code, unknown
 * click) use up the sending IP's budget and the click id's; past it, that IP / click id waits.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { POSTBACK_LIMIT, POSTBACK_PER_CLICK_LIMIT } from '../../src/lib/tracking-rate-limit.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
// A fresh address per test run, so a re-run inside the 5-minute window starts clean.
const ip = () => `2001:db8::${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}`;

d('postback rate limits: authenticated postbacks are never throttled (live DB + Redis)', () => {
  let track: FastifyInstance;
  let fx: Fixture;
  let host: string;
  const clicks = async (n: number) => {
    const ids = Array.from({ length: n }, () => randomUUID().replace(/-/g, ''));
    await query(`INSERT INTO clicks (click_id, network_id, offer_id, publisher_id) SELECT unnest($1::text[]), $2, $3, $4`, [ids, fx.networkA, fx.offerA, fx.pubA1]);
    return ids;
  };
  const postback = (clickId: string, from: string, code: string) => track.inject({
    method: 'GET', url: `/postback?secure_code=${code}&click_id=${clickId}&txn_id=${randomUUID()}`, headers: { host }, remoteAddress: from,
  });

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`prl-${randomUUID().slice(0, 8)}`);
    host = `prl-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    setHostResolver(new DbHostResolver());
    track = buildTrackingApp({ rateLimits: true });
    await track.ready();
  });

  it('one advertiser server sends more than the per-IP budget — every authenticated postback counts', async () => {
    const server = ip();
    const ids = await clicks(POSTBACK_LIMIT + 10);
    const codes = new Set<number>();
    for (const id of ids) codes.add((await postback(id, server, fx.secureCodeA)).statusCode);
    expect([...codes]).toEqual([200]);
    const { rows } = await query<{ n: number }>('SELECT COUNT(*)::int AS n FROM conversions WHERE network_id = $1 AND click_id = ANY($2)', [fx.networkA, ids]);
    expect(rows[0]!.n).toBe(ids.length);
  });

  it('failed postbacks use up the IP’s budget: past it, that IP waits (others don’t)', async () => {
    const bad = ip();
    // A different click each time, so only the IP's budget fills up.
    const ids = await clicks(POSTBACK_LIMIT + 1);
    const target = ids.pop()!;
    for (const id of ids) expect((await postback(id, bad, 'wrong-code')).statusCode).toBe(403);
    const refused = await postback(target, bad, fx.secureCodeA);
    expect(refused.statusCode).toBe(429);
    expect(refused.headers['retry-after']).toBe('60');
    expect((await postback(target, ip(), fx.secureCodeA)).statusCode).toBe(200);
  });

  it('failed postbacks for one click id from many IPs: past its budget, that click id waits', async () => {
    const [leaked, other] = await clicks(2);
    for (let i = 0; i < POSTBACK_PER_CLICK_LIMIT; i++) expect((await postback(leaked!, ip(), 'guess')).statusCode).toBe(403);
    expect((await postback(leaked!, ip(), fx.secureCodeA)).statusCode).toBe(429);
    expect((await postback(other!, ip(), fx.secureCodeA)).statusCode).toBe(200);
  });

  it("unauthenticated postbacks don't use up a click's conversion allowance (10 junk ones used to block the real conversion)", async () => {
    const [c] = await clicks(1);
    for (let i = 0; i < 11; i++) expect((await postback(c!, ip(), 'junk')).statusCode).toBe(403);
    const real = await postback(c!, ip(), fx.secureCodeA);
    expect(real.statusCode).toBe(200);
    expect((real.json() as { status: string }).status).not.toBe('rejected'); // counted (pending = the offer's default status)
    const { rows } = await query('SELECT 1 FROM conversions WHERE network_id = $1 AND click_id = $2', [fx.networkA, c]);
    expect(rows).toHaveLength(1);
  });
});
