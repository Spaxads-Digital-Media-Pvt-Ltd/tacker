/**
 * Rejected clicks go to a fallback (D1), and server-to-server clicks are judged on the visitor (D2) —
 * live DB + Redis, the tracking surface via inject.
 *
 * D1: a click from a partner who isn't active goes to the offer's fallback URL, else the NETWORK's
 * fallback (Settings › General — used by every diverted click), else a neutral 204 — never to the
 * advertiser — and is recorded as an invalid click with the reason.
 * D2: a server-side click (format=json) that passes the visitor's `ip` / `user_agent` is enriched,
 * deduped, scored — and blocked — on them; without the visitor's IP it's scored but never blocked.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { FastifyInstance } from 'fastify';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { getQueue, QUEUE } from '../../src/surfaces/workers/queues.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

interface Job { networkId: string; offerId: string; publisherId: string | null; fraudFlags: string[]; ip: string | null; userAgent: string | null; clickId: string }

d('rejected clicks → fallback; server-to-server clicks judged on the visitor (live DB)', () => {
  let track: FastifyInstance;
  let dash: Express;
  let fx: Fixture;
  let host: string;
  let admin: Record<string, string>;

  const offer = async (opts: { fallback?: string; s2s?: boolean } = {}) => (await query<{ id: string }>(
    `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, default_payout, default_revenue, fallback_url, metadata)
     VALUES ($1, $2, $3, 'active', 'https://adv.example.com/lp?c={click_id}', 5, 8, $4, $5) RETURNING id`,
    [fx.networkA, fx.advA, `Off ${randomUUID().slice(0, 6)}`, opts.fallback ?? null,
      JSON.stringify(opts.s2s ? { attribution_settings: { serverSideClick: true } } : {})])).rows[0]!.id;
  const partner = async (status: string) => (await query<{ id: string }>(
    `INSERT INTO publishers (network_id, name, status) VALUES ($1, $2, $3) RETURNING id`, [fx.networkA, `P ${randomUUID().slice(0, 5)}`, status])).rows[0]!.id;
  const click = (qs: string, extra: { remoteAddress?: string; ua?: string } = {}) => track.inject({
    method: 'GET', url: `/click?${qs}`, headers: { host, ...(extra.ua ? { 'user-agent': extra.ua } : {}) },
    ...(extra.remoteAddress ? { remoteAddress: extra.remoteAddress } : {}),
  });
  const jobs = async (offerId: string): Promise<Job[]> => (await getQueue(QUEUE.clickPersist).getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']))
    .map((j) => j?.data as Job | undefined).filter((x): x is Job => !!x && x.offerId === offerId);
  const setNetworkFallback = (url: string | null) => request(dash).put('/api/settings/general').set(admin).send({ fallbackUrl: url });

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`reject-${randomUUID().slice(0, 8)}`);
    host = `reject-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    setHostResolver(new DbHostResolver());
    track = buildTrackingApp();
    await track.ready();
    dash = buildDashboardApp();
    admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
  });

  it("an inactive partner's click goes to the offer's fallback, recorded as invalid with the reason", async () => {
    const o = await offer({ fallback: 'https://fallback.example.com/offer' });
    const p = await partner('inactive');
    const r = await click(`offer_id=${o}&pub_id=${p}&sub1=abc`);
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('https://fallback.example.com/offer');
    const [job] = await jobs(o);
    expect(job).toMatchObject({ publisherId: p, fraudFlags: ['partner_inactive'] });
    // An active partner on the same offer is unchanged: straight to the advertiser.
    const ok = await click(`offer_id=${o}&pub_id=${await partner('active')}`);
    expect(ok.statusCode).toBe(302);
    expect(ok.headers.location).toMatch(/^https:\/\/adv\.example\.com\/lp\?c=/);
  });

  it("with no offer fallback the network's is used — for every diverted click — and clearing it means 204", async () => {
    const o = await offer();
    const p = await partner('pending');
    expect((await click(`offer_id=${o}&pub_id=${p}`)).statusCode).toBe(204);

    expect((await setNetworkFallback('https://network.example.com/rejected')).status).toBe(200);
    const viaNetwork = await click(`offer_id=${o}&pub_id=${p}`);
    expect(viaNetwork.statusCode).toBe(302);
    expect(viaNetwork.headers.location).toBe('https://network.example.com/rejected');
    // A different reason to divert (made-up partner) uses it too.
    const ghost = await click(`offer_id=${o}&pub_id=${randomUUID()}`);
    expect(ghost.headers.location).toBe('https://network.example.com/rejected');
    expect((await jobs(o)).map((j) => j.fraudFlags[0])).toEqual(expect.arrayContaining(['partner_pending', 'unknown_partner']));

    expect((await setNetworkFallback('javascript:alert(1)')).status).toBe(422);
    expect((await setNetworkFallback(null)).status).toBe(200);
    expect((await click(`offer_id=${o}&pub_id=${p}`)).statusCode).toBe(204);
  });

  it("a server-to-server click with the visitor's ip / user_agent is stored and judged on the visitor", async () => {
    const o = await offer({ s2s: true });
    const p = await partner('active');
    const r = await click(`offer_id=${o}&pub_id=${p}&format=json&ip=203.0.113.77&user_agent=${encodeURIComponent('Mozilla/5.0 (iPhone) Safari/605')}`,
      { remoteAddress: '198.51.100.1', ua: 'partner-server/1.0' });
    expect(r.statusCode).toBe(200);
    const clickId = (r.json() as { data: { click_id: string } }).data.click_id;
    const job = (await jobs(o)).find((j) => j.clickId === clickId)!;
    expect(job).toMatchObject({ ip: '203.0.113.77', userAgent: 'Mozilla/5.0 (iPhone) Safari/605' });

    // A malformed visitor ip is ignored (the connection's address is used).
    const bad = await click(`offer_id=${o}&pub_id=${p}&format=json&ip=not-an-ip`, { remoteAddress: '198.51.100.1' });
    const badId = (bad.json() as { data: { click_id: string } }).data.click_id;
    expect((await jobs(o)).find((j) => j.clickId === badId)?.ip).toBe('198.51.100.1');
  });

  it('a fraud block applies to a server-to-server click that names its visitor — never to one that does not', async () => {
    expect((await request(dash).put('/api/fraud-rules').set(admin).send({ enabled: true, blockScore: 40 })).status).toBe(200);
    try {
      const o = await offer({ s2s: true });
      const p = await partner('active');
      // The visitor is a bot (curl UA scores 50 ≥ 40) → blocked like any click.
      const blocked = await click(`offer_id=${o}&pub_id=${p}&format=json&ip=203.0.113.78&user_agent=curl%2F8.4.0`, { remoteAddress: '198.51.100.2' });
      expect(blocked.statusCode).toBe(204);
      // Same bot user agent on the partner's own server, no visitor ip → scored, not blocked.
      const notBlocked = await click(`offer_id=${o}&pub_id=${p}&format=json`, { remoteAddress: '198.51.100.2', ua: 'curl/8.4.0' });
      expect(notBlocked.statusCode).toBe(200);
      const id = (notBlocked.json() as { data: { click_id: string } }).data.click_id;
      expect((await jobs(o)).find((j) => j.clickId === id)?.fraudFlags).toContain('bot_user_agent');
    } finally {
      await request(dash).put('/api/fraud-rules').set(admin).send({ blockScore: null });
    }
  });
});
