/**
 * Fraud scoring is actionable at /click — on a real Postgres + Redis (INTEGRATION_DB=1, as in CI) —
 * audit F-23.
 *
 * Below the network's block score a click is flagged as before; at or over it the click is rejected —
 * diverted (fallback / 204), never attributed, and recorded as an invalid click with reason
 * `fraud_blocked` plus its fraud flags and score (round 3: rejected clicks are kept for reports). Blocking is opt-in, honours "enabled", applies
 * at once after the rules change (cache busted), and never hits a server-side click. The IPQS verdict
 * the click worker caches per network + IP raises the score of that IP's later clicks.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { FastifyInstance } from 'fastify';
import type { Worker } from 'bullmq';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { invalidateOfferConfig } from '../../src/surfaces/tracking/offer-cache.js';
import { getQueue, QUEUE } from '../../src/surfaces/workers/queues.js';
import { startClickPersistWorker } from '../../src/surfaces/workers/processors/click-persist.js';
import { ipqsCacheKey, ipqsVerdict } from '../../src/lib/integrations/ipqs.js';
import { getRedis } from '../../src/lib/redis.js';
import { decryptSecret } from '../../src/lib/crypto/secret-box.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const CURL = 'curl/8.7.1';

interface JobData { clickId: string; fraudScore: number; fraudFlags: string[]; resolvedPayout: string; isUnique: boolean }

d('fraud blocking at /click (live DB + Redis)', () => {
  let track: FastifyInstance;
  let dash: Express;
  let fx: Fixture;
  let host: string;
  let admin: { Authorization: string };
  let worker: Worker | null = null;
  const run = randomUUID().slice(0, 6);
  let ipSeq = 0;
  /** A fresh client IP per call (TEST-NET-2), so velocity never builds up between cases. */
  const freshIp = () => `198.51.${100 + (Number.parseInt(run.slice(0, 2), 16) % 50)}.${++ipSeq}`;

  const rules = async (body: Record<string, unknown>) => {
    const res = await request(dash).put('/api/fraud-rules').set(admin).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data;
  };
  const click = (ua: string, ip = freshIp(), qs = '') => track.inject({
    method: 'GET', url: `/click?offer_id=${fx.offerA}&pub_id=${fx.pubA1}${qs}`, remoteAddress: '127.0.0.1',
    headers: { host, 'x-forwarded-for': ip, 'user-agent': ua },
  });
  const clickIdOf = (loc: string) => new URL(loc).pathname.split('/').pop()!;
  const jobs = async () => (await getQueue(QUEUE.clickPersist).getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']))
    .map((j) => j?.data as JobData | undefined).filter(Boolean) as JobData[];
  const jobFor = async (clickId: string) => (await jobs()).find((j) => j.clickId === clickId);
  const setAttribution = async (patch: Record<string, unknown>) => {
    await query(`UPDATE offers SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{attribution_settings}',
      COALESCE(metadata->'attribution_settings', '{}'::jsonb) || $2::jsonb) WHERE id = $1`, [fx.offerA, JSON.stringify(patch)]);
    await invalidateOfferConfig(fx.networkA, fx.offerA);
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    await getQueue(QUEUE.clickPersist).obliterate({ force: true }); // test Redis only
    fx = await seedFixture(`fraud-${run}`);
    host = `fraud-${run}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    await query(`UPDATE offers SET destination_url = 'https://adv.example.com/lp/{click_id}', fallback_url = 'https://fallback.example.com/' WHERE id = $1`, [fx.offerA]);
    setHostResolver(new DbHostResolver());
    track = buildTrackingApp();
    await track.ready();
    dash = buildDashboardApp();
    admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA }));
  });
  afterAll(async () => { await worker?.close(); await track?.close(); });

  it('below the block score a click is only flagged (as before); at or over it the click is rejected — recorded as fraud_blocked, never attributed', async () => {
    await rules({ blockScore: 60 });
    const flagged = await click(CURL);
    expect(flagged.statusCode).toBe(302);
    expect(flagged.headers.location).toMatch(/^https:\/\/adv\.example\.com\/lp\//);
    expect(await jobFor(clickIdOf(flagged.headers.location as string))).toMatchObject({ fraudScore: 50, fraudFlags: ['bot_user_agent'] });

    await rules({ blockScore: 50 }); // takes effect on the very next click (cached config is busted)
    const before = new Set((await jobs()).map((j) => j.clickId));
    const blocked = await click(CURL);
    expect(blocked.statusCode).toBe(302);
    expect(blocked.headers.location).toBe('https://fallback.example.com/');
    // Recorded for the reports as a rejected click: the reason first, then the signals; no payout. Its id
    // never left the tracker (the fallback carries no macros), and it isn't stored for attribution.
    const added = (await jobs()).filter((j) => !before.has(j.clickId));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ fraudScore: 50, fraudFlags: ['fraud_blocked', 'bot_user_agent'], resolvedPayout: '0.0000', isUnique: false });
    expect(await getRedis().exists(`click:${fx.networkA}:${added[0]!.clickId}`)).toBe(0);

    // A real browser still goes through.
    const ok = await click(CHROME);
    expect(ok.headers.location).toMatch(/^https:\/\/adv\.example\.com\/lp\//);
  });

  it('without a fallback URL a blocked click gets the neutral 204', async () => {
    await rules({ blockScore: 50 });
    await query(`UPDATE offers SET fallback_url = NULL WHERE id = $1`, [fx.offerA]);
    await invalidateOfferConfig(fx.networkA, fx.offerA);
    try {
      expect((await click(CURL)).statusCode).toBe(204);
    } finally {
      await query(`UPDATE offers SET fallback_url = 'https://fallback.example.com/' WHERE id = $1`, [fx.offerA]);
      await invalidateOfferConfig(fx.networkA, fx.offerA);
    }
  });

  it('blocking is opt-in and off while fraud protection is disabled', async () => {
    await rules({ blockScore: null });
    expect((await click(CURL)).headers.location).toMatch(/^https:\/\/adv\.example\.com\//);
    await rules({ blockScore: 50, enabled: false });
    expect((await click(CURL)).headers.location).toMatch(/^https:\/\/adv\.example\.com\//);
    await rules({ enabled: true });
    expect((await click(CURL)).headers.location).toBe('https://fallback.example.com/');
  });

  it('a server-side click (format=json on an offer that allows it) is scored but never blocked', async () => {
    await rules({ blockScore: 50 });
    await setAttribution({ serverSideClick: true });
    try {
      const res = await click(CURL, freshIp(), '&format=json');
      expect(res.statusCode).toBe(200);
      const { click_id: id } = res.json().data as { click_id: string };
      expect(await jobFor(id)).toMatchObject({ fraudScore: 50, fraudFlags: ['bot_user_agent'] });
    } finally {
      await setAttribution({ serverSideClick: false });
    }
  });

  it("an IPQS proxy verdict cached for the IP raises its clicks' score — blocking them at the threshold — only on IPQS offers", async () => {
    const ip = freshIp();
    await getRedis().set(ipqsCacheKey(fx.networkA, ip), JSON.stringify({ score: 5, flags: ['ipqs_proxy'] }), 'EX', 300);
    await rules({ blockScore: 30 });
    // Offer without IPQS: the verdict isn't consulted.
    expect((await click(CHROME, ip)).headers.location).toMatch(/^https:\/\/adv\.example\.com\//);
    await setAttribution({ ipqs: { enabled: true } });
    try {
      expect((await click(CHROME, ip)).headers.location).toBe('https://fallback.example.com/');
      await rules({ blockScore: 31 });
      const through = await click(CHROME, ip);
      expect(await jobFor(clickIdOf(through.headers.location as string))).toMatchObject({ fraudScore: 30, fraudFlags: ['ipqs_proxy'] });
    } finally {
      await setAttribution({ ipqs: { enabled: false } });
    }
  });

  it('the click worker looks an IP up once, caches the verdict for the network, and stores the folded score', async () => {
    await rules({ blockScore: null });
    await query(`UPDATE networks SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{integrations}',
      COALESCE(settings->'integrations', '{}'::jsonb) || '{"ipQualityScoreApiKey": "test-ipqs-key"}'::jsonb) WHERE id = $1`, [fx.networkA]);
    const fetchMock = vi.fn(async (_url: string | URL | Request) => new Response(
      JSON.stringify({ success: true, proxy: true, vpn: false, tor: false, bot_status: false, fraud_score: 12 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await setAttribution({ ipqs: { enabled: true } });
    const persisted = async (clickId: string) => {
      const deadline = Date.now() + 15000;
      let row: { fraud_score: number; fraud_flags: string[] } | undefined;
      while (Date.now() < deadline && !row) {
        row = (await query<NonNullable<typeof row>>(`SELECT fraud_score, fraud_flags FROM clicks WHERE network_id = $1 AND click_id = $2`, [fx.networkA, clickId])).rows[0];
        if (!row) await new Promise((r) => setTimeout(r, 200));
      }
      return row;
    };
    try {
      const ip = freshIp();
      const lookups = () => fetchMock.mock.calls.filter(([u]) => String(u).endsWith(`/${encodeURIComponent(ip)}?strictness=1`)).length;
      const first = await click(CHROME, ip);
      const firstId = clickIdOf(first.headers.location as string);
      expect(await jobFor(firstId)).toMatchObject({ fraudScore: 0, fraudFlags: [] }); // IPQS is never called on the hot path
      worker ??= startClickPersistWorker();
      expect(await persisted(firstId)).toEqual({ fraud_score: 30, fraud_flags: ['ipqs_proxy'] });
      expect(lookups()).toBe(1);

      // The IP's next click is scored with the cached verdict at /click; the worker doesn't call IPQS again.
      const second = await click(CHROME, ip);
      const secondId = clickIdOf(second.headers.location as string);
      expect(await jobFor(secondId)).toMatchObject({ fraudScore: 30, fraudFlags: ['ipqs_proxy'] });
      expect(await persisted(secondId)).toEqual({ fraud_score: 30, fraud_flags: ['ipqs_proxy'] });
      expect(await ipqsVerdict(fx.networkA, ip)).toEqual({ score: 12, flags: ['ipqs_proxy'] });
      expect(lookups()).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      await setAttribution({ ipqs: { enabled: false } });
    }
  });

  describe('fraud-rules API', () => {
    it('validates the new settings and merges partial weights', async () => {
      for (const body of [{ blockScore: 0 }, { blockScore: 101 }, { weights: { datacenter: -1 } }, { weights: { unknown: 5 } },
        { alertEmails: ['not-an-email'] }, { alertWebhookUrl: 'not a url' }]) {
        expect((await request(dash).put('/api/fraud-rules').set(admin).send(body)).status, JSON.stringify(body)).toBe(422);
      }
      await rules({ weights: { botUserAgent: 70 } });
      const got = (await request(dash).get('/api/fraud-rules').set(admin)).body.data;
      expect(got.weights).toMatchObject({ botUserAgent: 70, datacenter: 40, ipqsProxy: 30 });
      await rules({ weights: { botUserAgent: 50 } });
    });

    it('the alert webhook must be http(s) and not a private address; it is stored encrypted and only ever shown masked', async () => {
      for (const url of ['ftp://hooks.example.com/x', 'http://10.1.2.3/hook', 'http://127.0.0.1:9/hook']) {
        const res = await request(dash).put('/api/fraud-rules').set(admin).send({ alertWebhookUrl: url });
        expect(res.status, url).toBe(422);
        expect(res.body.error.message).toMatch(/^alertWebhookUrl is not allowed/);
      }
      const secretUrl = 'https://hooks.example.com/services/T00/B00/s3cr3t';
      const saved = await rules({ alertWebhookUrl: secretUrl, alertEmails: ['Ops@Example.com', 'ops@example.com'] });
      expect(saved).toMatchObject({ alertWebhookUrl: 'https://hooks.example.com/…', alertWebhookUrlSet: true, alertEmails: ['ops@example.com'] });
      const stored = (await query<{ hook: string }>(`SELECT config->>'alertWebhookUrl' AS hook FROM fraud_rules WHERE network_id = $1`, [fx.networkA])).rows[0]!.hook;
      expect(stored).toMatch(/^enc:v1:/);
      expect(decryptSecret(stored)).toBe(secretUrl);

      // Sending the masked value back (a form that round-trips GET) keeps the real URL.
      await rules({ alertWebhookUrl: 'https://hooks.example.com/…', scanWindowHours: 24 });
      const again = (await query<{ hook: string }>(`SELECT config->>'alertWebhookUrl' AS hook FROM fraud_rules WHERE network_id = $1`, [fx.networkA])).rows[0]!.hook;
      expect(decryptSecret(again)).toBe(secretUrl);

      // Neither the GET nor the audit trail carries the token.
      expect(JSON.stringify((await request(dash).get('/api/fraud-rules').set(admin)).body)).not.toContain('s3cr3t');
      const audits = await query<{ after: unknown }>(`SELECT after FROM audit_log WHERE network_id = $1 AND action = 'fraud_rules.update'`, [fx.networkA]);
      expect(audits.rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(audits.rows)).not.toContain('s3cr3t');

      await rules({ alertWebhookUrl: null });
      expect((await request(dash).get('/api/fraud-rules').set(admin)).body.data).toMatchObject({ alertWebhookUrl: null, alertWebhookUrlSet: false });
    });

    it('read_only/finance can read the rules but not change them', async () => {
      for (const role of ['read_only', 'finance']) {
        const auth = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role }));
        expect((await request(dash).get('/api/fraud-rules').set(auth)).status).toBe(200);
        expect((await request(dash).put('/api/fraud-rules').set(auth).send({ blockScore: 10 })).status).toBe(403);
      }
    });
  });
});
