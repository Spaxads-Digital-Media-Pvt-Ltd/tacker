/**
 * Admin impersonation is a scoped, short-lived, audited session — on a real Postgres (INTEGRATION_DB=1,
 * as in CI) — audit F-10.
 *
 * POST /api/{publishers|advertisers}/:id/impersonate returns a dedicated 30-minute token (never the
 * account's own credentials). With it the admin sees that account's portal; /api/me says who is
 * impersonating; every write is audited with the admin's id (impersonated_by); credential changes are
 * refused; the token expires and can't be forged.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { SignJWT } from 'jose';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { signImpersonationToken, IMPERSONATION_ISSUER } from '../../src/lib/auth/impersonation-token.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, portalToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('admin impersonation is scoped, time-boxed and audited (live DB)', () => {
  let dash: Express;
  let fx: Fixture;
  const adminId = randomUUID();
  let admin: { Authorization: string };
  let imp: { Authorization: string };
  let started: { token: string; expiresAt: number; kind: string; ownerId: string; impersonatedBy: string };

  const auditRows = async (where: string, params: unknown[]) => (await query<{
    action: string; actor_id: string | null; impersonated_by: string | null; after: Record<string, unknown> | null;
  }>(`SELECT action, actor_id, impersonated_by, after FROM audit_log WHERE network_id = $1 AND ${where} ORDER BY created_at`, [fx.networkA, ...params])).rows;
  /** The catch-all audit row is written when the response finishes — give it a moment. */
  const settle = () => new Promise((r) => setTimeout(r, 150));

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`imp-${randomUUID().slice(0, 8)}`);
    await query(`INSERT INTO users (network_id, auth_user_id, email, role) VALUES ($1, $2, 'ops-admin@example.com', 'admin')`, [fx.networkA, adminId]);
    dash = buildDashboardApp();
    admin = bearer(operatorToken({ userId: adminId, networkId: fx.networkA, role: 'admin' }));
    const res = await request(dash).post(`/api/publishers/${fx.pubA1}/impersonate`).set(admin);
    expect(res.status).toBe(200);
    started = res.body.data;
    imp = bearer(started.token);
  });

  it('starts a short-lived session (no reusable credential) and audits the start with actor + expiry', async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(started).toMatchObject({ kind: 'publisher', ownerId: fx.pubA1, impersonatedBy: adminId });
    expect(started.expiresAt).toBeGreaterThan(now + 25 * 60);
    expect(started.expiresAt).toBeLessThanOrEqual(now + 30 * 60 + 5);
    expect(started).not.toHaveProperty('link');

    const [row] = await auditRows(`action = 'publisher.impersonate' AND entity_id = $2`, [fx.pubA1]);
    expect(row).toMatchObject({ actor_id: adminId, impersonated_by: null });
    expect(row!.after).toMatchObject({ impersonatedBy: adminId });
    expect(new Date(String(row!.after!['expiresAt'])).getTime() / 1000).toBeCloseTo(started.expiresAt, -1);
  });

  it('only admins can impersonate', async () => {
    for (const role of ['manager', 'finance', 'read_only']) {
      const res = await request(dash).post(`/api/publishers/${fx.pubA1}/impersonate`)
        .set(bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role })));
      expect(res.status).toBe(403);
    }
  });

  it('/api/me reports who is impersonating (for the banner); a normal portal login reports no impersonation', async () => {
    const me = await request(dash).get('/api/me').set(imp);
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({
      impersonating: true,
      impersonation: { impersonatedBy: adminId, adminEmail: 'ops-admin@example.com', account: 'Pub A1', expiresAt: started.expiresAt },
      identity: { kind: 'publisher', ownerId: fx.pubA1, networkId: fx.networkA, impersonatedBy: adminId },
    });

    const own = bearer(portalToken({ userId: randomUUID(), networkId: fx.networkA, kind: 'publisher', ownerId: fx.pubA1 }));
    const plain = await request(dash).get('/api/me').set(own);
    expect(plain.body.data).toMatchObject({ impersonating: false, impersonation: null });
  });

  it('the session sees that account’s portal and nothing admin', async () => {
    expect((await request(dash).get('/api/portal/publisher/summary').set(imp)).status).toBe(200);
    expect((await request(dash).get('/api/publishers').set(imp)).status).toBe(403);
    expect((await request(dash).get('/api/portal/advertiser/summary').set(imp)).status).toBe(403);
  });

  it('every write is audited with the impersonating admin — routes with their own audit row and without', async () => {
    // Own audit row: requesting access to an "ask" offer.
    const { rows } = await query<{ id: string }>(
      `INSERT INTO offers (network_id, advertiser_id, name, status, visibility, destination_url, default_payout, default_revenue)
       VALUES ($1, $2, 'Ask offer', 'active', 'ask', 'https://example.com/{click_id}', 1, 2) RETURNING id`, [fx.networkA, fx.advA]);
    const askOffer = rows[0]!.id;
    expect((await request(dash).post(`/api/portal/offers/${askOffer}/request`).set(imp).send({})).status).toBe(201);
    // No audit row of its own: creating a partner postback.
    const pb = await request(dash).post('/api/portal/publisher/postbacks').set(imp).send({ url: 'https://partner.example/pb?c={click_id}' });
    expect(pb.status).toBe(201);
    await settle();

    const access = await auditRows(`action = 'offer.access.request'`, []);
    expect(access).toHaveLength(1);
    expect(access[0]).toMatchObject({ impersonated_by: adminId });

    const generic = await auditRows(`action = 'impersonation.write'`, []);
    expect(generic).toHaveLength(1); // only the postback — the access request already had its own row
    expect(generic[0]).toMatchObject({ impersonated_by: adminId });
    expect(generic[0]!.after).toEqual({ method: 'POST', path: '/api/portal/publisher/postbacks', status: 201 });

    // The partner's own (non-impersonated) writes carry no impersonated_by.
    const own = bearer(portalToken({ userId: randomUUID(), networkId: fx.networkA, kind: 'publisher', ownerId: fx.pubA1 }));
    expect((await request(dash).delete(`/api/portal/offers/${askOffer}/request`).set(own)).status).toBe(200);
    expect((await auditRows(`action = 'offer.access.withdraw'`, []))[0]).toMatchObject({ impersonated_by: null });
  });

  it('credential changes are refused while impersonating (reads still work)', async () => {
    expect((await request(dash).patch('/api/me/password').set(imp).send({ password: 'a-brand-new-password-123' })).status).toBe(403);
    expect((await request(dash).patch('/api/me/email').set(imp).send({ email: 'taken-over@example.com' })).status).toBe(403);
    expect((await request(dash).post('/api/me/anonymize').set(imp)).status).toBe(403);
    expect((await request(dash).post('/api/portal/publisher/keys').set(imp).send({ name: 'sneaky key' })).status).toBe(403);
    expect((await request(dash).get('/api/portal/publisher/keys').set(imp)).status).toBe(200);
  });

  it('expired, forged or tampered sessions are rejected', async () => {
    const expired = await signImpersonationToken(
      { kind: 'publisher', networkId: fx.networkA, ownerId: fx.pubA1, userId: fx.pubA1, impersonatedBy: adminId }, -5);
    const res = await request(dash).get('/api/me').set(bearer(expired.token));
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/Impersonation session is invalid or has expired/);

    const forged = await new SignJWT({ kind: 'publisher', network_id: fx.networkA, owner_id: fx.pubA1, impersonated_by: adminId })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(fx.pubA1).setIssuer(IMPERSONATION_ISSUER).setAudience('tracker-dashboard')
      .setIssuedAt().setExpirationTime('10m').setJti(randomUUID())
      .sign(new TextEncoder().encode('not-the-impersonation-secret-at-all-0123456789'));
    expect((await request(dash).get('/api/me').set(bearer(forged))).status).toBe(401);

    const [h, p, sig] = started.token.split('.') as [string, string, string];
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    const tampered = `${h}.${Buffer.from(JSON.stringify({ ...payload, owner_id: fx.pubA2 })).toString('base64url')}.${sig}`;
    expect((await request(dash).get('/api/me').set(bearer(tampered))).status).toBe(401);
  });

  it('advertisers can be impersonated the same way', async () => {
    const res = await request(dash).post(`/api/advertisers/${fx.advA}/impersonate`).set(admin);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ kind: 'advertiser', ownerId: fx.advA, impersonatedBy: adminId });
    const advImp = bearer(res.body.data.token);
    expect((await request(dash).get('/api/portal/advertiser/summary').set(advImp)).status).toBe(200);
    expect((await request(dash).get('/api/portal/publisher/summary').set(advImp)).status).toBe(403);
    const me = await request(dash).get('/api/me').set(advImp);
    expect(me.body.data.impersonation).toMatchObject({ impersonatedBy: adminId, account: 'Adv A' });
  });
});
