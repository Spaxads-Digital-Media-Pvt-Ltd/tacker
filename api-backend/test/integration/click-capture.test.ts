/**
 * Click capture authenticity on a real Postgres + Redis (INTEGRATION_DB=1): /click → click job →
 * click-persist worker → clicks row → GET /api/reports/clicks.
 *  - IP: a direct connection keeps its socket address (127.0.0.1 locally — never replaced); behind a
 *    trusted proxy the first UNTRUSTED X-Forwarded-For hop (walking from the right) is the client;
 *    a client-written left-hand X-Forwarded-For entry and headers from an untrusted peer are ignored.
 *  - Browser / OS / user agent: exactly what the request's User-Agent says; none when it has none.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { Express } from 'express';
import type { FastifyInstance } from 'fastify';
import type { Worker } from 'bullmq';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { getQueue, QUEUE } from '../../src/surfaces/workers/queues.js';
import { startClickPersistWorker } from '../../src/surfaces/workers/processors/click-persist.js';
import { enqueueClick } from '../../src/surfaces/tracking/click-job.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1';

interface ClickJobData {
  clickId: string; ip: string | null; os: string | null; browser: string | null; device: string | null; userAgent: string | null;
  sourceId?: string | null; fbclid?: string | null; gclid?: string | null; smartLinkId?: string | null;
}

d('click capture: IP / user agent from the real request (live DB + Redis)', () => {
  let track: FastifyInstance;
  let dash: Express;
  let fx: Fixture;
  let host: string;
  let worker: Worker | null = null;

  const clickIdFrom = (loc: string | undefined) => new URL((loc ?? '').replace('{click_id}', '')).pathname.split('/').pop()!;
  const click = async (headers: Record<string, string>, remoteAddress?: string) => {
    const r = await track.inject({ method: 'GET', url: `/click?offer_id=${fx.offerA}&pub_id=${fx.pubA1}`, headers: { host, ...headers }, ...(remoteAddress ? { remoteAddress } : {}) });
    expect(r.statusCode).toBe(302);
    return clickIdFrom(r.headers.location as string);
  };
  const job = async (clickId: string): Promise<ClickJobData> => {
    const jobs = await getQueue(QUEUE.clickPersist).getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
    const j = jobs.find((x) => (x?.data as ClickJobData | undefined)?.clickId === clickId);
    if (!j) throw new Error(`no click job for ${clickId}`);
    return j.data as ClickJobData;
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    await getQueue(QUEUE.clickPersist).obliterate({ force: true }); // test Redis (db 15) only
    fx = await seedFixture(`capture-${randomUUID().slice(0, 8)}`);
    host = `capture-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    await query(`UPDATE offers SET destination_url = 'https://adv.example.com/lp/{click_id}' WHERE id = $1`, [fx.offerA]);
    setHostResolver(new DbHostResolver());
    track = buildTrackingApp();
    await track.ready();
    dash = buildDashboardApp();
  });
  afterAll(async () => { await worker?.close(); await track?.close(); });

  describe('IP address', () => {
    it('a direct local request keeps the genuine loopback address (never a made-up public IP)', async () => {
      expect((await job(await click({ 'user-agent': CHROME_WIN }, '127.0.0.1'))).ip).toBe('127.0.0.1');
    });
    it('behind a trusted proxy the forwarded client address is used', async () => {
      expect((await job(await click({ 'user-agent': CHROME_WIN, 'x-forwarded-for': '203.0.113.7' }, '127.0.0.1'))).ip).toBe('203.0.113.7');
    });
    it('a client-written left-hand X-Forwarded-For entry is ignored (was: taken as the click IP)', async () => {
      const id = await click({ 'user-agent': CHROME_WIN, 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }, '127.0.0.1');
      expect((await job(id)).ip).toBe('203.0.113.7');
    });
    it('via a Cloudflare IPv6 edge and via the full Cloudflare → Nginx chain the real client is captured', async () => {
      expect((await job(await click({ 'user-agent': CHROME_WIN, 'x-forwarded-for': '2001:db8::42' }, '2606:4700::1'))).ip).toBe('2001:db8::42');
      expect((await job(await click({ 'user-agent': CHROME_WIN, 'x-forwarded-for': '6.6.6.6, 198.18.5.5, 104.16.0.9' }, '127.0.0.1'))).ip).toBe('198.18.5.5');
    });
    it('X-Forwarded-For from an untrusted peer is ignored — the socket address is the client', async () => {
      expect((await job(await click({ 'user-agent': CHROME_WIN, 'x-forwarded-for': '1.2.3.4' }, '198.18.0.9'))).ip).toBe('198.18.0.9');
    });
  });

  describe('browser / OS / user agent', () => {
    it('captured from the request User-Agent (desktop Chrome vs iPhone Safari)', async () => {
      expect(await job(await click({ 'user-agent': CHROME_WIN }, '127.0.0.1'))).toMatchObject({ browser: 'Chrome 155.0.0.0', os: 'Windows 10', device: 'desktop', userAgent: CHROME_WIN });
      expect(await job(await click({ 'user-agent': IPHONE }, '127.0.0.1'))).toMatchObject({ browser: 'Mobile Safari 18.2', os: 'iOS 18.2', device: 'mobile', userAgent: IPHONE });
    });
    it('a request with NO User-Agent header records none (real HTTP request, no default UA)', async () => {
      await track.listen({ port: 0, host: '127.0.0.1' });
      const port = (track.server.address() as AddressInfo).port;
      const loc = await new Promise<string>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: `/click?offer_id=${fx.offerA}&pub_id=${fx.pubA1}`, headers: { host } }, (res) => { res.resume(); resolve(res.headers.location ?? ''); });
        req.on('error', reject); req.end();
      });
      const j = await job(clickIdFrom(loc));
      expect(j).toMatchObject({ userAgent: null, browser: null, os: null, ip: '127.0.0.1' });
    });
  });

  describe('source / fbclid / gclid from the click URL', () => {
    const clickWith = async (qs: string) => {
      const r = await track.inject({ method: 'GET', url: `/click?offer_id=${fx.offerA}&pub_id=${fx.pubA1}&${qs}`, headers: { host, 'user-agent': CHROME_WIN }, remoteAddress: '127.0.0.1' });
      expect(r.statusCode).toBe(302);
      return clickIdFrom(r.headers.location as string);
    };
    it('captured verbatim when present (source_id / source / src aliases), null when absent', async () => {
      const tag = randomUUID().slice(0, 8);
      expect(await job(await clickWith(`source_id=src-${tag}&fbclid=IwAR-${tag}&gclid=Cj0K-${tag}`))).toMatchObject({ sourceId: `src-${tag}`, fbclid: `IwAR-${tag}`, gclid: `Cj0K-${tag}` });
      expect(await job(await clickWith(`src=alias-${tag}`))).toMatchObject({ sourceId: `alias-${tag}`, fbclid: null, gclid: null });
      expect(await job(await clickWith('sub1=x'))).toMatchObject({ sourceId: null, fbclid: null, gclid: null });
    });
    it('blank / whitespace-only values are null (never ""); a blank source_id falls through to source', async () => {
      const cases: [string, Partial<ClickJobData>][] = [
        ['source=&fbclid=&gclid=', { sourceId: null, fbclid: null, gclid: null }],
        ['source_id=%20%20&fbclid=%09&gclid=%20', { sourceId: null, fbclid: null, gclid: null }],
        ['source_id=&source=push-fallback', { sourceId: 'push-fallback' }],
        ['source_id=%20&source=&src=native-fallback', { sourceId: 'native-fallback' }],
        ['source_id=sid-wins&source=src-loses&src=x', { sourceId: 'sid-wins' }],
        ['fbclid=IwAR-ok&gclid=', { fbclid: 'IwAR-ok', gclid: null }],
      ];
      for (const [qs, want] of cases) expect(await job(await clickWith(qs)), qs).toMatchObject(want);
    });
    it('/sl forwards source and the ad click ids to /click (blank values are not forwarded)', async () => {
      const sl = (await query<{ id: string }>(`INSERT INTO smart_links (network_id, name) VALUES ($1, 'capture sl') RETURNING id`, [fx.networkA])).rows[0]!.id;
      await query(`INSERT INTO smart_link_items (network_id, smart_link_id, offer_id) VALUES ($1, $2, $3)`, [fx.networkA, sl, fx.offerA]);
      const fwd = async (qs: string) => {
        const r = await track.inject({ method: 'GET', url: `/sl?id=${sl}&${qs}`, headers: { host }, remoteAddress: '127.0.0.1' });
        expect(r.statusCode).toBe(302);
        return new URLSearchParams((r.headers.location as string).split('?')[1]);
      };
      const full = await fwd('source=push-sl&fbclid=IwAR-sl&gclid=Cj0K-sl');
      expect([full.get('source_id'), full.get('fbclid'), full.get('gclid'), full.get('sl')]).toEqual(['push-sl', 'IwAR-sl', 'Cj0K-sl', sl]);
      const blank = await fwd('source_id=%20&source=&fbclid=&gclid=%20');
      expect([blank.has('source_id'), blank.has('fbclid'), blank.has('gclid')]).toEqual([false, false, false]);
      // The forwarded /click records them like a direct click.
      const r = await track.inject({ method: 'GET', url: `/click?${full.toString()}&pub_id=${fx.pubA1}`, headers: { host }, remoteAddress: '127.0.0.1' });
      expect(await job(clickIdFrom(r.headers.location as string))).toMatchObject({ sourceId: 'push-sl', fbclid: 'IwAR-sl', gclid: 'Cj0K-sl', smartLinkId: sl });
    });
    it('worker stores NULL for "" from an older-build job; the API returns NULL for a stored ""', async () => {
      const tag = randomUUID().slice(0, 8);
      const legacyId = randomUUID().replace(/-/g, '');
      await enqueueClick({
        clickId: legacyId, networkId: fx.networkA, offerId: fx.offerA, publisherId: fx.pubA1, ts: new Date().toISOString(), ip: '127.0.0.1',
        country: null, region: null, city: null, isp: null, device: null, os: null, browser: null, referrer: null, userAgent: null,
        sub1: `legacy-${tag}`, sub2: null, sub3: null, sub4: null, sub5: null, isUnique: true, fraudScore: 0, fraudFlags: [],
        resolvedPayout: null, resolvedRevenue: null, currency: null, smartLinkId: null, sourceId: '', fbclid: '  ', gclid: '',
      });
      // A row as an earlier build persisted it ('' values) — inserted directly, test DB only.
      const storedBlankId = randomUUID().replace(/-/g, '');
      await query(`INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at, ip, is_unique, fraud_score, source_id, fbclid, gclid)
        VALUES ($1, $2, $3, $4, now(), '127.0.0.1', true, 0, '', ' ', '')`, [storedBlankId, fx.networkA, fx.offerA, fx.pubA1]);
      worker ??= startClickPersistWorker();
      const deadline = Date.now() + 15000;
      let row: { source_id: string | null; fbclid: string | null; gclid: string | null } | undefined;
      while (Date.now() < deadline && !row) {
        row = (await query<NonNullable<typeof row>>(`SELECT source_id, fbclid, gclid FROM clicks WHERE network_id = $1 AND click_id = $2`, [fx.networkA, legacyId])).rows[0];
        if (!row) await new Promise((r) => setTimeout(r, 200));
      }
      expect(row).toEqual({ source_id: null, fbclid: null, gclid: null });
      const auth = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA }));
      const res = await request(dash).get(`/api/reports/clicks?clickIds=${storedBlankId}`).set(auth);
      expect(res.body.data[0]).toMatchObject({ source_id: null, fbclid: null, gclid: null });
      // The stored values themselves are untouched (no rewrite of existing rows).
      expect((await query(`SELECT source_id, fbclid, gclid FROM clicks WHERE click_id = $1`, [storedBlankId])).rows[0]).toEqual({ source_id: '', fbclid: ' ', gclid: '' });
    });
    it('persisted, returned by /api/reports/clicks, filterable (flat + grouped), and tenant-isolated', async () => {
      const tag = randomUUID().slice(0, 8);
      const withAll = await clickWith(`source_id=s-${tag}&fbclid=fb-${tag}&gclid=g-${tag}`);
      const without = await clickWith(`sub1=${tag}`);
      worker ??= startClickPersistWorker();
      const deadline = Date.now() + 15000;
      let n = 0;
      while (Date.now() < deadline && n < 2) {
        n = (await query(`SELECT 1 FROM clicks WHERE network_id = $1 AND click_id = ANY($2::text[])`, [fx.networkA, [withAll, without]])).rowCount ?? 0;
        if (n < 2) await new Promise((r) => setTimeout(r, 200));
      }
      const row = (await query<{ source_id: string | null; fbclid: string | null; gclid: string | null }>(
        `SELECT source_id, fbclid, gclid FROM clicks WHERE network_id = $1 AND click_id = ANY($2::text[]) ORDER BY source_id NULLS LAST`, [fx.networkA, [withAll, without]])).rows;
      expect(row).toEqual([{ source_id: `s-${tag}`, fbclid: `fb-${tag}`, gclid: `g-${tag}` }, { source_id: null, fbclid: null, gclid: null }]);

      const auth = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA }));
      const both = await request(dash).get(`/api/reports/clicks?clickIds=${withAll},${without}`).set(auth);
      const byId = Object.fromEntries(both.body.data.map((r: { click_id: string }) => [r.click_id, r]));
      expect(byId[withAll]).toMatchObject({ source_id: `s-${tag}`, fbclid: `fb-${tag}`, gclid: `g-${tag}` });
      expect(byId[without]).toMatchObject({ source_id: null, fbclid: null, gclid: null });
      for (const [k, v] of [['sourceId', `s-${tag}`], ['fbclid', `fb-${tag}`], ['gclid', `g-${tag}`]] as const) {
        const r = await request(dash).get(`/api/reports/clicks?${k}=${v}`).set(auth);
        expect(r.status, k).toBe(200);
        expect(r.body.data.map((x: { click_id: string }) => x.click_id), k).toEqual([withAll]);
        const g = await request(dash).get(`/api/reports/grouped?groupBy=offer&${k}=${v}`).set(auth);
        expect(g.status, `grouped ${k}`).toBe(200);
        expect(Number(g.body.data.totals.clicks), `grouped ${k}`).toBe(1);
      }
      expect((await request(dash).get(`/api/reports/clicks?gclid=no-such-${tag}`).set(auth)).body.data).toEqual([]);
      expect((await request(dash).get('/api/reports/clicks?gclid=').set(auth)).status).toBe(422);
      const other = await request(dash).get(`/api/reports/clicks?sourceId=s-${tag}`).set(bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkB })));
      expect(other.status).toBe(200);
      expect(other.body.data).toEqual([]);
    });
  });

  describe('persisted and reported as captured', () => {
    it('click-persist writes the job values; /api/reports/clicks returns them (plain IP, raw UA)', async () => {
      const ids = {
        local: await click({ 'user-agent': CHROME_WIN }, '127.0.0.1'),
        proxied: await click({ 'user-agent': IPHONE, 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }, '127.0.0.1'),
      };
      worker ??= startClickPersistWorker();
      const deadline = Date.now() + 15000;
      let rows: { click_id: string; ip: string; os: string | null; browser: string | null; user_agent: string | null }[] = [];
      while (Date.now() < deadline) {
        rows = (await query<typeof rows[number]>(`SELECT click_id, host(ip) AS ip, os, browser, user_agent FROM clicks WHERE network_id = $1 AND click_id = ANY($2::text[])`, [fx.networkA, Object.values(ids)])).rows;
        if (rows.length === 2) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      const byId = Object.fromEntries(rows.map((r) => [r.click_id, r]));
      expect(byId[ids.local]).toMatchObject({ ip: '127.0.0.1', os: 'Windows 10', browser: 'Chrome 155.0.0.0', user_agent: CHROME_WIN });
      expect(byId[ids.proxied]).toMatchObject({ ip: '203.0.113.9', os: 'iOS 18.2', browser: 'Mobile Safari 18.2', user_agent: IPHONE });

      const auth = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA }));
      const res = await request(dash).get(`/api/reports/clicks?clickIds=${Object.values(ids).join(',')}&limit=10`).set(auth);
      expect(res.status).toBe(200);
      const api = Object.fromEntries(res.body.data.map((r: { click_id: string }) => [r.click_id, r]));
      expect(api[ids.local]).toMatchObject({ ip: '127.0.0.1', os: 'Windows 10', browser: 'Chrome 155.0.0.0', user_agent: CHROME_WIN });
      expect(api[ids.proxied]).toMatchObject({ ip: '203.0.113.9', user_agent: IPHONE });
      // Another network sees none of these clicks.
      const other = await request(dash).get(`/api/reports/clicks?clickIds=${Object.values(ids).join(',')}`).set(bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkB })));
      expect(other.body.data).toEqual([]);
    });
  });
});
