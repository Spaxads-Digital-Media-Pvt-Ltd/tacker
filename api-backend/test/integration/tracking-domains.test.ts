/**
 * Custom tracking domains can be verified and activated — on a real Postgres + Redis
 * (INTEGRATION_DB=1, as in CI) — audit F-15. DNS is stubbed through setTxtResolver.
 *
 * Creating a custom domain returns the TXT record to publish (state 'pending'); verifying with the
 * record present makes it verified + active and /click serves it at once; a miss marks it 'failed'
 * (manual) or leaves it 'pending' (background re-check). Status transitions are explicit, and the
 * edge's certificate "ask" hook only says yes for active + verified hosts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import request from 'supertest';
import type { Express } from 'express';
import type { FastifyInstance } from 'fastify';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { setTxtResolver, setCertificateIssuer, recheckPendingDomains } from '../../src/lib/tracking-domains/verify.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('custom tracking domain verification (live DB + Redis, stubbed DNS)', () => {
  let dash: Express;
  let track: FastifyInstance;
  let fx: Fixture;
  let admin: { Authorization: string };
  /** TXT records the stub DNS serves, by record name. */
  const dns = new Map<string, string[][]>();

  const create = async () => {
    const host = `links-${randomUUID().slice(0, 8)}.example-brand.com`;
    const res = await request(dash).post('/api/tracking-domains').set(admin).send({ mode: 'custom', host });
    expect(res.status).toBe(201);
    return res.body.data as { id: string; host: string; verificationState: string; status: string; sslStatus: string; dnsRecord: { type: string; name: string; value: string } };
  };
  const verify = (id: string, auth = admin) => request(dash).post(`/api/tracking-domains/${id}/verify`).set(auth);
  const click = (host: string) => track.inject({ method: 'GET', url: `/click?offer_id=${fx.offerA}&pub_id=${fx.pubA1}`, headers: { host } });
  const stateOf = async (id: string) => (await query<{ verification_state: string; status: string; ssl_status: string }>(
    'SELECT verification_state, status, ssl_status FROM tracking_domains WHERE id = $1', [id])).rows[0]!;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`domains-${randomUUID().slice(0, 8)}`);
    setTxtResolver(async (name) => {
      const rec = dns.get(name);
      if (!rec) throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: 'ENOTFOUND' });
      return rec;
    });
    setHostResolver(new DbHostResolver());
    track = buildTrackingApp();
    await track.ready();
    dash = buildDashboardApp();
    admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA }));
  });
  afterAll(() => setTxtResolver(resolveTxt));

  it('creating a custom domain returns the TXT record to publish; it stays pending and /click ignores it', async () => {
    const dom = await create();
    expect(dom).toMatchObject({ verificationState: 'pending', status: 'pending', sslStatus: 'none' });
    expect(dom.dnsRecord).toEqual({ type: 'TXT', name: `_tracker-verify.${dom.host}`, value: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect((await click(dom.host)).statusCode).toBe(404);
  });

  it('verify without the record → failed with the reason; with it → verified + active, and /click serves the host right away', async () => {
    const dom = await create();
    expect((await click(dom.host)).statusCode).toBe(404); // also caches the miss on the tracking side

    const miss = await verify(dom.id);
    expect(miss.status).toBe(200);
    expect(miss.body.data).toMatchObject({ verified: false, reason: `No TXT record at _tracker-verify.${dom.host} yet`, domain: { verificationState: 'failed' } });

    dns.set(dom.dnsRecord.name, [['wrong-token']]);
    expect((await verify(dom.id)).body.data.reason).toMatch(/doesn't carry the verification token/);

    dns.set(dom.dnsRecord.name, [[dom.dnsRecord.value.slice(0, 10), dom.dnsRecord.value.slice(10)]]); // split TXT strings join
    const hit = await verify(dom.id);
    expect(hit.body.data).toMatchObject({ verified: true, domain: { verificationState: 'verified', status: 'active', sslStatus: 'pending' } });
    expect((await click(dom.host)).statusCode).toBe(302);
  });

  it('the background re-check activates a pending domain once its record appears, and never marks it failed', async () => {
    const dom = await create();
    await recheckPendingDomains();
    expect(await stateOf(dom.id)).toMatchObject({ verification_state: 'pending', status: 'pending' });
    dns.set(dom.dnsRecord.name, [[dom.dnsRecord.value]]);
    const r = await recheckPendingDomains();
    expect(r.verified).toBeGreaterThanOrEqual(1);
    expect(await stateOf(dom.id)).toMatchObject({ verification_state: 'verified', status: 'active' });
  });

  it('a plugged-in certificate issuer can confirm the certificate (never "issued" before verification)', async () => {
    setCertificateIssuer({ issue: async () => 'issued' });
    try {
      const dom = await create();
      expect((await stateOf(dom.id)).ssl_status).toBe('none');
      dns.set(dom.dnsRecord.name, [[dom.dnsRecord.value]]);
      await verify(dom.id);
      expect((await stateOf(dom.id)).ssl_status).toBe('issued');
    } finally {
      setCertificateIssuer({ issue: async () => 'pending' });
    }
  });

  it('status transitions are explicit: no activating an unverified host; disabling stops /click at once', async () => {
    const pending = await create();
    const bad = await request(dash).patch(`/api/tracking-domains/${pending.id}`).set(admin).send({ status: 'active' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toBe('Verify this domain (DNS TXT record) before activating it.');

    const dom = await create();
    dns.set(dom.dnsRecord.name, [[dom.dnsRecord.value]]);
    await verify(dom.id);
    expect((await click(dom.host)).statusCode).toBe(302);
    expect((await request(dash).patch(`/api/tracking-domains/${dom.id}`).set(admin).send({ status: 'disabled' })).status).toBe(200);
    expect((await click(dom.host)).statusCode).toBe(404);
    expect((await request(dash).patch(`/api/tracking-domains/${dom.id}`).set(admin).send({ status: 'active' })).status).toBe(200);
    expect((await click(dom.host)).statusCode).toBe(302);
  });

  it('the edge certificate "ask" hook answers yes only for active + verified hosts', async () => {
    const pending = await create();
    const ok = await create();
    dns.set(ok.dnsRecord.name, [[ok.dnsRecord.value]]);
    await verify(ok.id);
    expect((await track.inject({ method: 'GET', url: `/_tls/ask?domain=${ok.host.toUpperCase()}` })).statusCode).toBe(200);
    expect((await track.inject({ method: 'GET', url: `/_tls/ask?domain=${pending.host}` })).statusCode).toBe(404);
    expect((await track.inject({ method: 'GET', url: '/_tls/ask?domain=evil.example.org' })).statusCode).toBe(404);
    expect((await track.inject({ method: 'GET', url: '/_tls/ask' })).statusCode).toBe(400);
  });

  it('read_only/finance cannot verify or change domains', async () => {
    const dom = await create();
    for (const role of ['read_only', 'finance']) {
      const auth = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role }));
      expect((await verify(dom.id, auth)).status).toBe(403);
      expect((await request(dash).patch(`/api/tracking-domains/${dom.id}`).set(auth).send({ status: 'disabled' })).status).toBe(403);
    }
  });
});
