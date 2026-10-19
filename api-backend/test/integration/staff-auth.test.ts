/**
 * Signing in for real (O1) — on a real Postgres (INTEGRATION_DB=1) with Supabase Auth replaced by an
 * in-memory fake (users, passwords, one-time recovery tokens) and outgoing mail captured.
 *
 * - A new team member is EMAILED an invite (sign-in + temporary password); their first sign-in must
 *   choose a new password (nothing else is allowed until then); they're `invited` until they sign in.
 * - "Resend invite" re-issues the temporary password until they've signed in; after that an admin
 *   sends a password-reset link instead.
 * - "Forgot password?" answers the same for every address, emails a one-time link (through the
 *   network's SMTP) that sets a new password and ends the login's other sessions.
 * - Switched-off accounts get no link and can't redeem one. Partner invites also force the change.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Express } from 'express';

interface FakeUser {
  id: string; email: string; password: string; banned: boolean; last_sign_in_at: string | null;
  app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown>;
}
const fake = vi.hoisted(() => ({
  users: new Map<string, unknown>(),
  tokens: new Map<string, string>(),
  refresh: new Map<string, string>(), // refresh token → user id (live sessions)
  signOuts: [] as { jwt: string; scope?: string }[],
  mails: [] as { networkId: string; to: string[]; subject: string; html: string }[],
  smtp: true,
}));

vi.mock('../../src/lib/mailer.js', () => ({
  smtpConfigError: async () => (fake.smtp ? null : 'SMTP is not fully configured yet — set Host, Username, Password and From Email in Settings › SMTP before sending.'),
  sendNetworkEmail: async (networkId: string, to: string[], subject: string, html: string) => {
    if (!fake.smtp) return { sent: 0, results: [], configError: 'SMTP is not fully configured yet — set Host, Username, Password and From Email in Settings › SMTP before sending.' };
    fake.mails.push({ networkId, to, subject, html });
    return { sent: to.length, results: to.map((recipient) => ({ recipient, ok: true })) };
  },
}));
// Emails go through the queue (O11): delivered in-process here.
vi.mock('../../src/lib/queues.js', async (importOriginal) => (await import('../helpers/inline-email-queue.js')).inlineEmailQueue(importOriginal));

vi.mock('../../src/lib/supabase.js', () => {
  const secret = process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-do-not-use-in-prod';
  const iss = `${(process.env.SUPABASE_URL ?? 'https://test.supabase.co').replace(/\/+$/, '')}/auth/v1`;
  const all = () => [...fake.users.values()] as FakeUser[];
  const byEmail = (email: string) => all().find((u) => u.email === email.toLowerCase());
  const pub = (u: FakeUser) => ({ id: u.id, email: u.email, app_metadata: { ...u.app_metadata }, user_metadata: { ...u.user_metadata }, last_sign_in_at: u.last_sign_in_at });
  const sessionFor = (u: FakeUser) => {
    const refresh_token = `rt-${randomBytes(6).toString('hex')}`;
    fake.refresh.set(refresh_token, u.id);
    return {
      access_token: jwt.sign({ iss, aud: 'authenticated', sub: u.id, email: u.email, app_metadata: u.app_metadata }, secret, { expiresIn: '1h' }),
      refresh_token, expires_at: Math.floor(Date.now() / 1000) + 3600,
    };
  };
  const admin = {
    createUser: async (a: { email: string; password: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }) => {
      if (byEmail(a.email)) return { data: { user: null }, error: { code: 'email_exists', message: 'A user with this email address has already been registered', status: 422 } };
      const u: FakeUser = { id: randomUUID(), email: a.email.toLowerCase(), password: a.password, banned: false, last_sign_in_at: null, app_metadata: { ...(a.app_metadata ?? {}) }, user_metadata: { ...(a.user_metadata ?? {}) } };
      fake.users.set(u.id, u);
      return { data: { user: pub(u) }, error: null };
    },
    getUserById: async (id: string) => {
      const u = fake.users.get(id) as FakeUser | undefined;
      return u ? { data: { user: pub(u) }, error: null } : { data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' } };
    },
    updateUserById: async (id: string, attrs: { password?: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown>; ban_duration?: string; email?: string }) => {
      const u = fake.users.get(id) as FakeUser | undefined;
      if (!u) return { data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' } };
      if (attrs.password) {
        u.password = attrs.password;
        // As GoTrue: a password set through the admin API signs the login out of every session.
        for (const [rt, uid] of fake.refresh) if (uid === id) fake.refresh.delete(rt);
      }
      if (attrs.app_metadata) u.app_metadata = { ...u.app_metadata, ...attrs.app_metadata }; // GoTrue merges
      if (attrs.user_metadata) u.user_metadata = { ...u.user_metadata, ...attrs.user_metadata };
      if (attrs.ban_duration) u.banned = attrs.ban_duration !== 'none';
      if (attrs.email) u.email = attrs.email;
      return { data: { user: pub(u) }, error: null };
    },
    deleteUser: async (id: string) => { fake.users.delete(id); return { data: {}, error: null }; },
    generateLink: async (a: { type: string; email: string }) => {
      const u = byEmail(a.email);
      if (!u) return { data: { user: null, properties: null }, error: { status: 404, code: 'user_not_found', message: 'User with this email not found' } };
      const token = randomBytes(20).toString('hex');
      fake.tokens.set(token, u.id);
      return { data: { user: pub(u), properties: { hashed_token: token, action_link: '', email_otp: '', redirect_to: '', verification_type: a.type } }, error: null };
    },
    signOut: async (token: string, scope?: string) => { fake.signOuts.push({ jwt: token, scope }); return { data: null, error: null }; },
  };
  const auth = {
    admin,
    signInWithPassword: async (a: { email: string; password: string }) => {
      const u = byEmail(a.email);
      if (!u || u.password !== a.password || u.banned) return { data: { session: null, user: null }, error: { message: 'Invalid login credentials', status: 400 } };
      u.last_sign_in_at = new Date().toISOString();
      return { data: { session: sessionFor(u), user: pub(u) }, error: null };
    },
    refreshSession: async (a: { refresh_token: string }) => {
      const id = fake.refresh.get(a.refresh_token);
      const u = id ? fake.users.get(id) as FakeUser | undefined : undefined;
      if (!u) return { data: { session: null, user: null }, error: { message: 'Invalid Refresh Token: Refresh Token Not Found', status: 400 } };
      fake.refresh.delete(a.refresh_token); // rotated
      return { data: { session: sessionFor(u), user: pub(u) }, error: null };
    },
  };
  return {
    getSupabaseAdmin: () => ({ auth }),
    createEphemeralAuthClient: () => ({
      auth: {
        verifyOtp: async (a: { token_hash: string; type: string }) => {
          const id = fake.tokens.get(a.token_hash);
          const u = id ? fake.users.get(id) as FakeUser | undefined : undefined;
          if (!u || u.banned) return { data: { user: null, session: null }, error: { message: 'Email link is invalid or has expired', status: 403 } };
          fake.tokens.delete(a.token_hash); // one-time
          return { data: { user: pub(u), session: sessionFor(u) }, error: null };
        },
      },
    }),
  };
});

import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { getRedis } from '../../src/lib/redis.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const NEW_PASSWORD = 'a-much-better-password-42';

d('signing in for real: invites, first-login password, resets (live DB, fake Supabase)', () => {
  let dash: Express;
  let fx: Fixture;
  let admin: Record<string, string>;

  const email = () => `t-${randomUUID().slice(0, 8)}@example.com`;
  const mailTo = (to: string) => fake.mails.filter((m) => m.to.includes(to));
  const tempPasswordIn = (html: string) => /Temporary password: <code>([^<]+)<\/code>/.exec(html)?.[1] ?? '';
  const resetTokenIn = (html: string) => /reset-password\?token=([0-9a-f]+)/.exec(html)?.[1] ?? '';
  const login = (address: string, password: string) => request(dash).post('/api/auth/login').send({ email: address, password });
  const createMember = (address: string, role = 'manager') =>
    request(dash).post('/api/users').set(admin).send({ name: `Member ${address.slice(2, 6)}`, email: address, role });
  const until = async (fn: () => Promise<boolean> | boolean, ms = 3000) => {
    for (let t = 0; t < ms; t += 50) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
    return false;
  };
  /** The refresh cookie a response set (`tracker_rt=…`), to send back as a Cookie header. */
  const refreshCookieOf = (res: { headers: Record<string, unknown> }) =>
    ((res.headers['set-cookie'] as string[] | undefined) ?? []).find((c) => c.startsWith('tracker_rt='))?.split(';')[0] ?? '';
  const statusOf = async (id: string) => (await query<{ status: string }>('SELECT status FROM users WHERE id = $1', [id])).rows[0]?.status;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`auth-${randomUUID().slice(0, 8)}`);
    dash = buildDashboardApp();
    admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
  });
  beforeEach(async () => {
    fake.mails.length = 0; fake.signOuts.length = 0; fake.smtp = true;
    // Rate-limit counters from earlier runs (test Redis only).
    const redis = getRedis();
    for (const pattern of ['pr:*', 'lr:*']) { const keys = await redis.keys(pattern); if (keys.length) await redis.del(...keys); }
  });

  it('a new team member is emailed an invite; their first sign-in must choose a password; then they are active', async () => {
    const address = email();
    const created = await createMember(address);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: 'invited', hasLogin: true, invite: { emailed: true } });
    const [mail] = mailTo(address);
    expect(mail?.subject).toMatch(/invited/);
    const temp = tempPasswordIn(mail!.html);
    expect(temp.length).toBeGreaterThan(12);

    const first = await login(address, temp);
    expect(first.status).toBe(200);
    expect(first.body.data.identity.mustChangePassword).toBe(true);
    expect(await until(async () => (await statusOf(created.body.data.id)) === 'active')).toBe(true);

    const t1 = bearer(first.body.data.accessToken as string);
    const blocked = await request(dash).get('/api/offers').set(t1);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.details).toEqual({ reason: 'password_change_required' });
    expect((await request(dash).get('/api/me').set(t1)).status).toBe(200);
    const signedInCookie = refreshCookieOf(first);
    expect(signedInCookie).not.toBe('');
    const changed = await request(dash).patch('/api/me/password').set(t1).send({ password: NEW_PASSWORD });
    expect(changed.status).toBe(200);

    // Supabase ends every session when the password changes: the sign-in's refresh cookie is dead —
    // so the answer is a fresh session (new token + refresh cookie) that no longer must change it.
    expect(changed.body.data.identity).toMatchObject({ kind: 'admin', mustChangePassword: false });
    expect((await request(dash).get('/api/offers').set(bearer(changed.body.data.accessToken as string))).status).toBe(200);
    expect((await request(dash).post('/api/auth/refresh').set('Cookie', signedInCookie)).status).toBe(401);
    const refreshed = await request(dash).post('/api/auth/refresh').set('Cookie', refreshCookieOf(changed));
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.identity.mustChangePassword).toBe(false);

    expect((await login(address, temp)).status).toBe(401); // the temporary password is gone
    const second = await login(address, NEW_PASSWORD);
    expect(second.body.data.identity.mustChangePassword).toBe(false);
    expect((await request(dash).get('/api/offers').set(bearer(second.body.data.accessToken as string))).status).toBe(200);
  });

  it('Resend invite re-issues the temporary password until they sign in; after that it is a password reset', async () => {
    const address = email();
    const created = await createMember(address, 'finance');
    const id = created.body.data.id as string;
    const temp1 = tempPasswordIn(mailTo(address)[0]!.html);

    const resent = await request(dash).post(`/api/users/${id}/invite`).set(admin);
    expect(resent.status).toBe(200);
    expect(resent.body.data.invite).toEqual({ emailed: true });
    const temp2 = tempPasswordIn(mailTo(address)[1]!.html);
    expect(temp2).not.toBe(temp1);
    expect((await login(address, temp1)).status).toBe(401);
    expect((await login(address, temp2)).body.data.identity.mustChangePassword).toBe(true);

    const again = await request(dash).post(`/api/users/${id}/invite`).set(admin);
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/already signed in/);

    const reset = await request(dash).post(`/api/users/${id}/password-reset`).set(admin);
    expect(reset.status).toBe(200);
    expect(reset.body.data).toEqual({ emailed: true });
    expect(resetTokenIn(mailTo(address).at(-1)!.html)).not.toBe('');
  });

  it('Forgot password answers the same for any address; its link sets a new password once and ends other sessions', async () => {
    const address = email();
    await createMember(address);
    fake.mails.length = 0;

    const unknown = await request(dash).post('/api/auth/forgot-password').send({ email: email() });
    expect(unknown.status).toBe(200);
    expect(unknown.body.data).toEqual({ ok: true });
    const known = await request(dash).post('/api/auth/forgot-password').send({ email: address.toUpperCase() });
    expect(known.status).toBe(200);
    expect(known.body.data).toEqual({ ok: true });
    expect(await until(() => mailTo(address).length === 1)).toBe(true);
    expect(fake.mails).toHaveLength(1); // nothing for the unknown address
    const mail = mailTo(address)[0]!;
    expect(mail.networkId).toBe(fx.networkA); // through the account's own network SMTP
    const token = resetTokenIn(mail.html);
    expect(mail.html).toMatch(/expires in 60 minutes/);

    expect((await request(dash).post('/api/auth/reset-password').send({ token: 'f'.repeat(40), password: NEW_PASSWORD })).status).toBe(400);
    const done = await request(dash).post('/api/auth/reset-password').send({ token, password: NEW_PASSWORD });
    expect(done.status).toBe(200);
    expect(fake.signOuts.map((s) => s.scope)).toEqual(['global']);
    const reused = await request(dash).post('/api/auth/reset-password').send({ token, password: NEW_PASSWORD });
    expect(reused.status).toBe(400);
    expect(reused.body.error.details).toEqual({ reason: 'reset_link_invalid' });

    const signedIn = await login(address, NEW_PASSWORD);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.data.identity.mustChangePassword).toBe(false); // a reset also clears the invite flag
  });

  it('switched-off accounts get no reset link and cannot redeem one', async () => {
    const address = email();
    const created = await createMember(address);
    const id = created.body.data.id as string;
    // A link issued while active…
    await request(dash).post(`/api/users/${id}/password-reset`).set(admin);
    const token = resetTokenIn(mailTo(address).at(-1)!.html);
    // …then the member is disabled.
    await request(dash).patch(`/api/control-center/users/${id}`).set(admin).send({ status: 'disabled' });
    fake.mails.length = 0;
    await request(dash).post('/api/auth/forgot-password').send({ email: address });
    await new Promise((r) => setTimeout(r, 300));
    expect(fake.mails).toHaveLength(0);
    // Disabling banned the login, so the earlier link is refused by Supabase itself…
    expect((await request(dash).post('/api/auth/reset-password').send({ token, password: NEW_PASSWORD })).status).toBe(400);
    // …and if the ban never reached Supabase, our own check refuses a fresh link too.
    const user = [...fake.users.values()].find((u) => (u as FakeUser).email === address) as FakeUser;
    user.banned = false;
    const { getSupabaseAdmin } = await import('../../src/lib/supabase.js');
    const link = await getSupabaseAdmin().auth.admin.generateLink({ type: 'recovery', email: address });
    const redeem = await request(dash).post('/api/auth/reset-password').send({ token: link.data.properties!.hashed_token, password: NEW_PASSWORD });
    expect(redeem.status).toBe(403);
    expect(user.password).not.toBe(NEW_PASSWORD);
    expect((await request(dash).post(`/api/users/${id}/password-reset`).set(admin)).status).toBe(409);
    expect((await request(dash).post(`/api/users/${id}/invite`).set(admin)).status).toBe(409);
  });

  it('partner invites force a new password at first sign-in too; without SMTP the credentials come back (non-production)', async () => {
    const address = email();
    const pub = (await query<{ id: string }>(
      `INSERT INTO publishers (network_id, name, status, contact_email) VALUES ($1, 'Invitee', 'active', $2) RETURNING id`,
      [fx.networkA, address])).rows[0]!.id;
    fake.smtp = false;
    const invite = await request(dash).post(`/api/publishers/${pub}/invite`).set(admin);
    expect(invite.status).toBe(200);
    expect(invite.body.data.emailed).toBe(false);
    expect(invite.body.data.emailError).toMatch(/SMTP is not fully configured/);
    const temp = invite.body.data.credentials.temporaryPassword as string;
    const first = await login(address, temp);
    expect(first.body.data.identity).toMatchObject({ kind: 'publisher', mustChangePassword: true });
    const t = bearer(first.body.data.accessToken as string);
    expect((await request(dash).get('/api/portal/publisher/summary').set(t)).status).toBe(403);
    const changed = await request(dash).patch('/api/me/password').set(t).send({ password: NEW_PASSWORD });
    expect(changed.status).toBe(200);
    expect(changed.body.data.identity).toMatchObject({ kind: 'publisher', mustChangePassword: false });
    expect((await request(dash).get('/api/portal/publisher/summary').set(bearer(changed.body.data.accessToken as string))).status).toBe(200);
    const second = await login(address, NEW_PASSWORD);
    expect((await request(dash).get('/api/portal/publisher/summary').set(bearer(second.body.data.accessToken as string))).status).toBe(200);

    // A team invite without SMTP: created anyway, credentials returned outside production.
    const member = email();
    const created = await createMember(member);
    expect(created.status).toBe(201);
    expect(created.body.data.invite).toMatchObject({ emailed: false, credentials: { email: member } });
  });

  it('reset requests are rate limited per address', async () => {
    const address = email();
    for (let i = 0; i < 5; i++) expect((await request(dash).post('/api/auth/forgot-password').send({ email: address })).status).toBe(200);
    const sixth = await request(dash).post('/api/auth/forgot-password').send({ email: address });
    expect(sixth.status).toBe(429);
    expect(sixth.headers['retry-after']).toBe('900');
  });
});
