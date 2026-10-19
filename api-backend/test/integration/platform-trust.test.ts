/**
 * Super Admin › Trust & safety — on a real Postgres + Redis (INTEGRATION_DB=1).
 *
 * - The platform blocklist: IPs / CIDRs / ranges, user-agent phrases and referrer domains are rejected at
 *   /click for every network, on the next click after a change; hits are counted; duplicates and nonsense are
 *   refused; removing an entry lets traffic through again.
 * - The scan: an address sending flagged clicks to two networks is listed with both networks and its flags.
 * - Privacy requests: erasure clears the subject's personal fields in its network only (clicks, the raw
 *   postback parameters, the postback logs) and never an amount; an email is removed from sub ids and raw
 *   parameters only; access exports the clicks; the subject is masked once done; read-only sees it masked.
 * - Roles: Sales has no Trust & safety; Support reads but can't change.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { FastifyInstance } from 'fastify';
import { buildPlatformAdminApp } from '../../src/surfaces/platform-admin/app.js';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { query } from '../../src/lib/db/pool.js';
import { signPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { invalidatePlatformBlocklist } from '../../src/lib/platform/blocklist.js';
import { scanTrust } from '../../src/lib/platform/trust.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const ROLE = { owner: '00000000-0000-4000-a000-000000000001', sales: '00000000-0000-4000-a000-000000000003', support: '00000000-0000-4000-a000-000000000005' };

d('Super Admin › Trust & safety (live DB + Redis)', () => {
  let platform: Express;
  let track: FastifyInstance;
  let fx: Fixture;
  let host: string;
  let offerB: string;
  let owner: Record<string, string>;
  const T = randomUUID().slice(0, 8);
  const blockIds: string[] = [];
  const member = async (role: string) => {
    const id = randomUUID();
    await query(`INSERT INTO platform_admins (id, email, status, auth_provider, password_hash, role_id) VALUES ($1, $2, 'active', 'local', 'x', $3)`,
      [id, `trust-${id.slice(0, 8)}@test.local`, role]);
    return bearer(await signPlatformAdminToken(id));
  };
  const click = (headers: Record<string, string>) =>
    track.inject({ method: 'GET', url: `/click?offer_id=${fx.offerA}&pub_id=${fx.pubA1}`, headers: { host, ...headers } });
  const block = async (body: Record<string, unknown>) => {
    const r = await request(platform).post('/platform/trust/blocklist').set(owner).send(body);
    if (r.status === 201) blockIds.push(r.body.data.id);
    return r;
  };
  const insertClick = async (networkId: string, ip: string, extra: Record<string, unknown> = {}) => {
    const clickId = randomUUID().replace(/-/g, '');
    await query(
      `INSERT INTO clicks (click_id, network_id, offer_id, created_at, ip, user_agent, referrer, city, sub1, sub2, fraud_score, fraud_flags)
       VALUES ($1, $2, $3, now() - interval '1 hour', $4::inet, 'UA-of-the-person', 'https://ref.example/x', 'Lyon', $5, $6, $7, $8)`,
      [clickId, networkId, networkId === fx.networkA ? fx.offerA : offerB, ip, extra['sub1'] ?? null, extra['sub2'] ?? null, extra['score'] ?? 0, extra['flags'] ?? []]);
    return clickId;
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`trust-${T}`);
    offerB = (await query<{ id: string }>(`INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, default_payout, default_revenue)
      VALUES ($1, $2, 'Offer B', 'active', 'https://example.com/b', 1.0000, 2.0000) RETURNING id`, [fx.networkB, fx.advB])).rows[0]!.id;
    host = `trust-${T}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    setHostResolver(new DbHostResolver());
    track = buildTrackingApp();
    await track.ready();
    platform = buildPlatformAdminApp();
    owner = await member(ROLE.owner);
    await invalidatePlatformBlocklist();
  });
  afterAll(async () => {
    if (blockIds.length) await query('DELETE FROM platform_blocklist WHERE id = ANY($1::uuid[])', [blockIds]);
    await invalidatePlatformBlocklist();
    await track?.close();
  });

  it('the blocklist rejects IPs, ranges, user agents and referrer domains at /click for every network — and lets go when removed', async () => {
    const ua = `TrustTestBot-${T}`;
    expect((await click({ 'x-forwarded-for': '100.64.77.10' })).statusCode).toBe(302);
    expect((await block({ kind: 'ip', value: '100.64.77.0/24', reason: 'datacenter abuse' })).status).toBe(201);
    expect((await block({ kind: 'ip', value: '100.65.1.10', valueTo: '100.65.1.20' })).status).toBe(201);
    expect((await block({ kind: 'user_agent', value: ua })).status).toBe(201);
    const ref = await block({ kind: 'referrer', value: `https://www.spam-${T}.test/landing?x=1` });
    expect(ref.body.data.value).toBe(`spam-${T}.test`); // stored as the domain
    expect((await click({ 'x-forwarded-for': '100.64.77.10' })).statusCode).toBe(204); // the next click
    expect((await click({ 'x-forwarded-for': '100.65.1.15' })).statusCode).toBe(204);
    expect((await click({ 'x-forwarded-for': '100.65.1.21' })).statusCode).toBe(302);
    expect((await click({ 'x-forwarded-for': '100.66.0.1', 'user-agent': `Mozilla/5.0 (${ua.toLowerCase()}/1.0)` })).statusCode).toBe(204);
    expect((await click({ 'x-forwarded-for': '100.66.0.2', referer: `https://ads.spam-${T}.test/p` })).statusCode).toBe(204);
    expect((await click({ 'x-forwarded-for': '100.66.0.3', referer: `https://notspam-${T}.test/p` })).statusCode).toBe(302);

    // Refused: duplicates, nonsense, a past expiry.
    expect((await block({ kind: 'ip', value: '100.64.77.0/24' })).status).toBe(409);
    expect((await block({ kind: 'ip', value: 'not-an-ip' })).status).toBe(400);
    expect((await block({ kind: 'user_agent', value: 'ab' })).status).toBe(400);
    expect((await block({ kind: 'ip', value: '100.67.0.1', expiresAt: '2020-01-01' })).status).toBe(400);

    const list = (await request(platform).get('/platform/trust/blocklist').set(owner)).body.data as { id: string; value: string; hits: number }[];
    await new Promise((r) => setTimeout(r, 50)); // the hit counts are fire-and-forget
    const again = (await request(platform).get('/platform/trust/blocklist').set(owner)).body.data as { id: string; value: string; hits: number }[];
    expect(again.find((b) => b.value === '100.64.77.0/24')!.hits).toBeGreaterThanOrEqual(1);
    expect(list.length).toBeGreaterThanOrEqual(4);

    // Removed: traffic flows again.
    const cidr = again.find((b) => b.value === '100.64.77.0/24')!;
    expect((await request(platform).delete(`/platform/trust/blocklist/${cidr.id}`).set(owner)).status).toBe(200);
    expect((await click({ 'x-forwarded-for': '100.64.77.10' })).statusCode).toBe(302);
  });

  it('the scan lists an address sending flagged clicks to two networks; the summary marks it once blocked', async () => {
    const ip = `100.68.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200) + 1}`;
    await insertClick(fx.networkA, ip, { score: 80, flags: ['fraud_blocked'] });
    await insertClick(fx.networkB, ip, { score: 70, flags: ['datacenter_ip'] });
    const scan = await scanTrust();
    expect(scan.suspiciousIps).toBeGreaterThanOrEqual(1);
    const row = (await query<{ network_ids: string[]; flagged: number; top_flags: string[] }>('SELECT network_ids, flagged, top_flags FROM platform_fraud_ips WHERE ip = $1', [ip])).rows[0]!;
    expect([...row.network_ids].sort()).toEqual([fx.networkA, fx.networkB].sort());
    expect(row.top_flags).toEqual(expect.arrayContaining(['fraud_blocked', 'datacenter_ip']));
    const before = (await request(platform).get('/platform/trust/summary').set(owner)).body.data;
    const hit = (before.suspicious as { ip: string; blocked: boolean; networks: { name: string }[] }[]).find((s) => s.ip === ip);
    expect(hit).toMatchObject({ blocked: false });
    expect(hit!.networks.map((n) => n.name).sort()).toEqual([`Net A trust-${T}`, `Net B trust-${T}`]);
    await block({ kind: 'ip', value: ip, reason: 'flagged in two networks' });
    const after = (await request(platform).get('/platform/trust/summary').set(owner)).body.data;
    expect((after.suspicious as { ip: string; blocked: boolean }[]).find((s) => s.ip === ip)!.blocked).toBe(true);
    expect(after).toMatchObject({ kpis: expect.objectContaining({ clicks7d: expect.any(Number) }), privacy: expect.objectContaining({ open: expect.any(Number) }) });
  });

  it('privacy: erasure clears the person’s data in that network only — never amounts; the subject is masked; access exports', async () => {
    const ip = `100.69.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200) + 1}`;
    const mine = await insertClick(fx.networkA, ip, { sub1: 'keep-me', sub2: 'campaign-7' });
    const other = await insertClick(fx.networkB, ip);
    const convId = `cv-${T}-1`;
    await query(`INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, source, status, payout, revenue, currency, raw_params)
                 VALUES ($1, $2, $3, $4, 'postback', 'approved', 5.0000, 8.0000, 'USD', '{"click_id": "x", "email": "p@example.com"}')`, [convId, fx.networkA, mine, fx.offerA]);
    await query(`INSERT INTO inbound_postback_logs (network_id, source, method, click_id, outcome, ip, params) VALUES ($1, 'postback', 'GET', $2, 'recorded', '198.18.0.1', '{"click_id": "x"}')`, [fx.networkA, mine]);
    await query(`INSERT INTO postback_logs (network_id, conversion_id, url, attempt, success) VALUES ($1, $2, $3, 1, true)`,
      [fx.networkA, convId, `https://partner.example/pb?cid=${mine}&sub=keep-me`]);

    // Access first: the export carries the click.
    const access = await request(platform).post('/platform/trust/privacy').set(owner)
      .send({ networkId: fx.networkA, kind: 'access', regulation: 'gdpr', subjectType: 'ip', subject: ip, requesterEmail: 'person@example.com' });
    expect(access.status, JSON.stringify(access.body)).toBe(201);
    const csv = await request(platform).get(`/platform/trust/privacy/${access.body.data.id}/export.csv`).set(owner);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain(mine);
    expect(csv.text).not.toContain(other); // network A only
    expect((await request(platform).post(`/platform/trust/privacy/${access.body.data.id}/erase`).set(owner)).status).toBe(400); // access ≠ erasure

    const er = await request(platform).post('/platform/trust/privacy').set(owner)
      .send({ networkId: fx.networkA, kind: 'erasure', regulation: 'ccpa', subjectType: 'ip', subject: ip });
    expect(new Date(er.body.data.dueAt).getTime() - Date.now()).toBeGreaterThan(44 * 86_400_000); // CCPA: 45 days
    const run = await request(platform).post(`/platform/trust/privacy/${er.body.data.id}/erase`).set(owner);
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body.data.result).toMatchObject({ clicks: 1, conversions: 1, inboundPostbacks: 1, outboundPostbacks: 1, networks: 1 });

    const cl = (await query<Record<string, unknown>>('SELECT ip, user_agent, referrer, city, sub1, offer_id FROM clicks WHERE click_id = $1', [mine])).rows[0]!;
    expect(cl).toMatchObject({ ip: null, user_agent: null, referrer: null, city: null, sub1: null, offer_id: fx.offerA });
    expect((await query<{ ip: string }>('SELECT host(ip) AS ip FROM clicks WHERE click_id = $1', [other])).rows[0]!.ip).toBe(ip); // network B untouched
    const cv = (await query<{ raw_params: unknown; payout: string; revenue: string }>('SELECT raw_params, payout::text, revenue::text FROM conversions WHERE conversion_id = $1', [convId])).rows[0]!;
    expect(cv).toEqual({ raw_params: {}, payout: '5.0000', revenue: '8.0000' }); // amounts stay
    expect((await query<{ url: string }>('SELECT url FROM postback_logs WHERE conversion_id = $1', [convId])).rows[0]!.url).toBe('https://partner.example/pb?[erased]');
    const done = (await query<{ status: string; subject: string; subject_hash: string }>('SELECT status, subject, subject_hash FROM privacy_requests WHERE id = $1', [er.body.data.id])).rows[0]!;
    expect(done.status).toBe('completed');
    expect(done.subject).toMatch(/^100\.69\.\*\.\*$/);
    expect(done.subject_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await request(platform).post(`/platform/trust/privacy/${er.body.data.id}/erase`).set(owner)).status).toBe(409);
  });

  it('privacy: an email is removed from sub ids and raw parameters only', async () => {
    const email = `Person.${T}@Example.com`;
    const c1 = await insertClick(fx.networkA, '100.70.0.1', { sub1: email.toLowerCase(), sub2: 'campaign-9' });
    await query(`INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, source, status, payout, revenue, currency, raw_params)
                 VALUES ($1, $2, $3, $4, 'postback', 'approved', 1.0000, 2.0000, 'USD', $5)`,
      [`cv-${T}-2`, fx.networkA, `no-click-${T}`, fx.offerA, JSON.stringify({ email, txn: 'T-1' })]);
    const r = await request(platform).post('/platform/trust/privacy').set(owner)
      .send({ networkId: fx.networkA, kind: 'erasure', subjectType: 'email', subject: email });
    const run = await request(platform).post(`/platform/trust/privacy/${r.body.data.id}/erase`).set(owner);
    expect(run.status).toBe(200);
    const cl = (await query<Record<string, unknown>>('SELECT ip, sub1, sub2 FROM clicks WHERE click_id = $1', [c1])).rows[0]!;
    expect(cl).toMatchObject({ sub1: null, sub2: 'campaign-9' });
    expect(cl['ip']).not.toBeNull(); // an email erasure keeps the rest of the click
    expect((await query<{ raw_params: unknown }>('SELECT raw_params FROM conversions WHERE conversion_id = $1', [`cv-${T}-2`])).rows[0]!.raw_params).toEqual({ txn: 'T-1' });
    expect((await request(platform).post('/platform/trust/privacy').set(owner).send({ kind: 'erasure', subjectType: 'email', subject: 'nope' })).status).toBe(400);
  });

  it('roles: Sales has no Trust & safety; Support reads (subjects masked) but can’t change', async () => {
    const sales = await member(ROLE.sales);
    expect((await request(platform).get('/platform/trust/summary').set(sales)).status).toBe(403);
    const support = await member(ROLE.support);
    expect((await request(platform).get('/platform/trust/summary').set(support)).status).toBe(200);
    expect((await request(platform).post('/platform/trust/blocklist').set(support).send({ kind: 'ip', value: '100.71.0.1' })).status).toBe(403);
    const open = await request(platform).post('/platform/trust/privacy').set(owner)
      .send({ networkId: fx.networkA, kind: 'erasure', subjectType: 'ip', subject: '100.72.10.20' });
    const seen = ((await request(platform).get('/platform/trust/privacy').set(support)).body.data as { id: string; subject: string }[]).find((p) => p.id === open.body.data.id)!;
    expect(seen.subject).toBe('100.72.*.*');
    const full = ((await request(platform).get('/platform/trust/privacy').set(owner)).body.data as { id: string; subject: string }[]).find((p) => p.id === open.body.data.id)!;
    expect(full.subject).toBe('100.72.10.20');
  });
});
