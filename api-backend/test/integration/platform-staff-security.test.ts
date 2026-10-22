/**
 * Super Admin › staff security — live DB + Redis (INTEGRATION_DB=1): every sign-in attempt is recorded;
 * each token is a session that can be signed out (one, or everywhere else / by an Owner); the IP allowlist
 * gates sign-in and every request, and can't be saved without the saver's own address; the staff bell.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildPlatformAdminApp } from '../../src/surfaces/platform-admin/app.js';
import { query } from '../../src/lib/db/pool.js';
import { hashPassword } from '../../src/lib/auth/platform-admin-password.js';
import { signPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { saveSecuritySettings } from '../../src/lib/platform/twofactor.js';
import { ipAllowed, allowlistEntryError, notifyStaffInApp } from '../../src/lib/platform/staff-security.js';
import { canConnect } from '../helpers/db.js';
import { bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const OWNER = '00000000-0000-4000-a000-000000000001';
const SALES = '00000000-0000-4000-a000-000000000003';
const PW = 'correct-horse-battery-9';

d('Super Admin › staff security (live DB)', () => {
  let platform: Express;
  const member = async (role = OWNER) => {
    const id = randomUUID();
    const email = `sec-${id.slice(0, 8)}@test.local`;
    await query(`INSERT INTO platform_admins (id, email, status, auth_provider, password_hash, role_id) VALUES ($1, $2, 'active', 'local', $3, $4)`,
      [id, email, await hashPassword(PW), role]);
    return { id, email };
  };
  const login = (email: string, password = PW, ip?: string) => {
    const r = request(platform).post('/platform/login').set('user-agent', 'SecTest/1.0');
    if (ip) r.set('x-forwarded-for', ip);
    return r.send({ email, password });
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    platform = buildPlatformAdminApp();
  });
  afterEach(async () => { await saveSecuritySettings({ requireTwoFactor: false, ipAllowlist: [] }, null); });

  it('records each sign-in attempt with its outcome; members see their own, team readers everyone’s', async () => {
    const m = await member();
    expect((await login(m.email, 'wrong-password-123')).status).toBe(401);
    const ok = await login(m.email);
    expect(ok.status).toBe(200);
    const auth = bearer(ok.body.data.token);
    const mine = (await request(platform).get('/platform/me/sign-ins').set(auth)).body.data;
    expect(mine.map((e: { outcome: string }) => e.outcome).slice(0, 2)).toEqual(['success', 'bad_password']);
    expect(mine[0]).toMatchObject({ email: m.email, userAgent: 'SecTest/1.0' });
    const failed = (await request(platform).get('/platform/security/sign-ins?failed=1').set(auth)).body.data;
    expect(failed.every((e: { outcome: string }) => e.outcome !== 'success')).toBe(true);
    await login(`nobody-${randomUUID().slice(0, 6)}@test.local`);
    const all = (await request(platform).get('/platform/security/sign-ins').set(auth)).body.data;
    expect(all[0].outcome).toBe('unknown_email');
  });

  it('sessions: listed with the current one marked; signing one out ends that token at once; "everywhere else" keeps this one', async () => {
    const m = await member();
    const a = bearer((await login(m.email)).body.data.token);
    const b = bearer((await login(m.email)).body.data.token);
    const sessions = (await request(platform).get('/platform/me/sessions').set(a)).body.data;
    expect(sessions.filter((s: { active: boolean }) => s.active)).toHaveLength(2);
    expect(sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const other = sessions.find((s: { current: boolean }) => !s.current);
    expect((await request(platform).delete(`/platform/me/sessions/${other.id}`).set(a)).status).toBe(200);
    const ended = await request(platform).get('/platform/me').set(b);
    expect([ended.status, ended.body.error?.details]).toEqual([401, { reason: 'session_ended' }]);
    const c = bearer((await login(m.email)).body.data.token);
    expect((await request(platform).post('/platform/me/sessions/revoke-others').set(a)).body.data.revoked).toBe(1);
    expect((await request(platform).get('/platform/me').set(c)).status).toBe(401);
    expect((await request(platform).get('/platform/me').set(a)).status).toBe(200);
    // An Owner signs a member out everywhere; a sales member can't.
    const owner = bearer(await signPlatformAdminToken((await member()).id));
    const sales = bearer(await signPlatformAdminToken((await member(SALES)).id));
    expect((await request(platform).post(`/platform/admins/${m.id}/sessions/revoke-all`).set(sales)).status).toBe(403);
    expect((await request(platform).post(`/platform/admins/${m.id}/sessions/revoke-all`).set(owner)).body.data.revoked).toBe(1);
    expect((await request(platform).get('/platform/me').set(a)).status).toBe(401);
    // An Admin (team:full) can't sign an Owner out.
    const admin = bearer(await signPlatformAdminToken((await member('00000000-0000-4000-a000-000000000002')).id));
    expect((await request(platform).post(`/platform/admins/${m.id}/sessions/revoke-all`).set(admin)).status).toBe(403);
  });

  it('IP allowlist: refuses sign-in and requests from elsewhere; can’t be saved without your own address', async () => {
    const m = await member();
    const auth = bearer((await login(m.email)).body.data.token);
    const bad = await request(platform).put('/platform/settings/security').set(auth).send({ ipAllowlist: ['10.0.0.0/33'] });
    expect(bad.status).toBe(422);
    // Supertest connects from 127.0.0.1 (no trusted forwarded header) — a list without it would lock us out.
    const lock = await request(platform).put('/platform/settings/security').set(auth).send({ ipAllowlist: ['203.0.113.0/24'] });
    expect([lock.status, lock.body.error.details.reason]).toEqual([409, 'would_lock_out']);
    expect((await request(platform).put('/platform/settings/security').set(auth).send({ ipAllowlist: ['127.0.0.1', '203.0.113.0/24'] })).status).toBe(200);
    expect((await request(platform).get('/platform/me').set(auth)).status).toBe(200);
    expect((await request(platform).get('/platform/settings/security').set(auth)).body.data).toMatchObject({ ipAllowlist: ['127.0.0.1', '203.0.113.0/24'], yourIp: '127.0.0.1' });
    // Applied server-side: a list without this address blocks sign-in and requests.
    await saveSecuritySettings({ requireTwoFactor: false, ipAllowlist: ['203.0.113.0/24'] }, null);
    const blocked = await login(m.email);
    expect([blocked.status, blocked.body.error.details.reason]).toEqual([403, 'ip_not_allowed']);
    expect((await request(platform).get('/platform/me').set(auth)).body.error.details.reason).toBe('ip_not_allowed');
    // Pure rules.
    expect(ipAllowed([], '1.2.3.4')).toBe(true);
    expect(ipAllowed(['203.0.113.0/24'], '203.0.113.9')).toBe(true);
    expect(ipAllowed(['203.0.113.0/24'], '::ffff:203.0.113.9')).toBe(true);
    expect(ipAllowed(['2001:db8::/32'], '2001:db8::1')).toBe(true);
    expect(ipAllowed(['203.0.113.0/24'], '198.51.100.1')).toBe(false);
    expect(allowlistEntryError('nope')).toMatch(/isn't an IP/);
  });

  it('the bell: notices for a member, unread first; read one / all', async () => {
    const m = await member();
    const auth = bearer(await signPlatformAdminToken(m.id));
    await notifyStaffInApp({ emails: [m.email.toUpperCase()] }, { kind: 'task', title: 'Call Acme', link: '/admin/tasks' });
    await notifyStaffInApp({ adminIds: [m.id] }, { kind: 'ticket', title: 'New ticket' });
    let bell = (await request(platform).get('/platform/notifications').set(auth)).body.data;
    expect(bell.unread).toBe(2);
    await request(platform).post(`/platform/notifications/${bell.items[0].id}/read`).set(auth).expect(200);
    bell = (await request(platform).get('/platform/notifications').set(auth)).body.data;
    expect(bell.unread).toBe(1);
    expect((await request(platform).post('/platform/notifications/read-all').set(auth)).body.data.read).toBe(1);
    expect((await request(platform).get('/platform/notifications').set(auth)).body.data.unread).toBe(0);
  });
});
