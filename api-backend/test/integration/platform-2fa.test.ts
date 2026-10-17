/**
 * Two-factor sign-in for the platform team — on a real Postgres + Redis (INTEGRATION_DB=1).
 *
 * - Setup: a secret; enabling needs a current code; 10 recovery codes (shown once, stored hashed).
 * - Sign-in: the right password → a challenge, no session; the code → the session; a used code can't be used
 *   again; a recovery code works once; wrong codes are limited like wrong passwords; the challenge is never a
 *   session token.
 * - Required for everyone: a member without it can only set it up; it can't be turned off then.
 * - An Owner resets a member who lost their phone.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildPlatformAdminApp } from '../../src/surfaces/platform-admin/app.js';
import { query } from '../../src/lib/db/pool.js';
import { signPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { hashPassword } from '../../src/lib/auth/platform-admin-password.js';
import { totp } from '../../src/lib/auth/totp.js';
import { getRedis } from '../../src/lib/redis.js';
import { canConnect } from '../helpers/db.js';
import { bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const OWNER = '00000000-0000-4000-a000-000000000001';
const SALES = '00000000-0000-4000-a000-000000000003';
const PW = 'a-strong-password-123';

d('platform two-factor sign-in (live DB)', () => {
  let platform: Express;
  const member = async (roleId: string) => {
    const id = randomUUID(); const email = `tf-${id.slice(0, 8)}@test.local`;
    await query(`INSERT INTO platform_admins (id, email, status, auth_provider, password_hash, role_id) VALUES ($1, $2, 'active', 'local', $3, $4)`,
      [id, email, await hashPassword(PW), roleId]);
    return { id, email, auth: bearer(await signPlatformAdminToken(id)) };
  };
  const enable = async (m: { auth: Record<string, string> }) => {
    const setup = await request(platform).post('/platform/me/2fa/setup').set(m.auth);
    const secret = setup.body.data.secret as string;
    const on = await request(platform).post('/platform/me/2fa/enable').set(m.auth).send({ code: totp(secret) });
    return { secret, codes: on.body.data.recoveryCodes as string[], setup };
  };
  const login = (email: string) => request(platform).post('/platform/login').send({ email, password: PW });

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    await query(`DELETE FROM platform_settings WHERE key = 'security'`);
    platform = buildPlatformAdminApp();
  });
  // Login rate-limit counters (test Redis only): wrong codes count against this address like wrong passwords.
  const clearLimits = async () => { const redis = getRedis(); const keys = await redis.keys('lr:*'); if (keys.length) await redis.del(...keys); };
  beforeEach(clearLimits);
  afterAll(async () => { await query(`DELETE FROM platform_settings WHERE key = 'security'`); await clearLimits(); });

  it('setup, the two-step sign-in, replay, recovery codes, the challenge is no session', async () => {
    const m = await member(OWNER);
    const setup = await request(platform).post('/platform/me/2fa/setup').set(m.auth);
    expect(setup.body.data.otpauthUrl).toMatch(/^otpauth:\/\/totp\/.+secret=[A-Z2-7]{32}&issuer=/);
    expect((await request(platform).post('/platform/me/2fa/enable').set(m.auth).send({ code: '000000' })).status).toBe(400);
    const secret = setup.body.data.secret as string;
    const on = await request(platform).post('/platform/me/2fa/enable').set(m.auth).send({ code: totp(secret) });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body.data.recoveryCodes).toHaveLength(10);
    expect((await query<{ totp_secret: string; recovery_code_hashes: string[] }>('SELECT totp_secret, recovery_code_hashes FROM platform_admins WHERE id = $1', [m.id])).rows[0])
      .toMatchObject({ totp_secret: expect.stringMatching(/^enc:/), recovery_code_hashes: expect.arrayContaining([expect.stringMatching(/^[0-9a-f]{64}$/)]) });
    expect((await request(platform).get('/platform/me').set(m.auth)).body.data.twoFactor).toMatchObject({ enabled: true, recoveryCodesLeft: 10, required: false });

    const step1 = await login(m.email);
    expect(step1.body.data).toMatchObject({ twoFactorRequired: true, challenge: expect.any(String) });
    expect(step1.body.data).not.toHaveProperty('token');
    // The challenge is never a session.
    expect((await request(platform).get('/platform/me').set(bearer(step1.body.data.challenge))).status).toBe(401);
    // The code that enabled it was already used (this step) — the next step's works.
    expect((await request(platform).post('/platform/login/2fa').send({ challenge: step1.body.data.challenge, code: totp(secret) })).status).toBe(401);
    const ok = await request(platform).post('/platform/login/2fa').send({ challenge: step1.body.data.challenge, code: totp(secret, Date.now() + 30_000) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ token: expect.any(String), usedRecoveryCode: false, recoveryCodesLeft: 10 });
    expect((await request(platform).get('/platform/me').set(bearer(ok.body.data.token))).status).toBe(200);

    // A recovery code: once.
    const rc = on.body.data.recoveryCodes[0] as string;
    const step2 = await login(m.email);
    const viaCode = await request(platform).post('/platform/login/2fa').send({ challenge: step2.body.data.challenge, code: rc.toUpperCase() });
    expect(viaCode.body.data).toMatchObject({ usedRecoveryCode: true, recoveryCodesLeft: 9 });
    expect((await request(platform).post('/platform/login/2fa').send({ challenge: step2.body.data.challenge, code: rc })).status).toBe(401);
    // New recovery codes need an authenticator code — a recovery code is refused there, not spent.
    const spent = await request(platform).post('/platform/me/2fa/recovery-codes').set(m.auth).send({ code: on.body.data.recoveryCodes[1] });
    expect(spent.status).toBe(400);
    expect(spent.body.error.message).toMatch(/recovery code can’t be used here/);
    expect((await request(platform).get('/platform/me').set(m.auth)).body.data.twoFactor.recoveryCodesLeft).toBe(9);
    // Turning it off needs the password.
    expect((await request(platform).post('/platform/me/2fa/disable').set(m.auth).send({ password: 'wrong' })).status).toBe(400);
  });

  it('wrong codes are limited like wrong passwords', async () => {
    const m = await member(OWNER);
    const { secret } = await enable(m);
    const ch = (await login(m.email)).body.data.challenge as string;
    for (let i = 0; i < 5; i++) expect((await request(platform).post('/platform/login/2fa').send({ challenge: ch, code: '000000' })).status).toBe(401);
    const locked = await request(platform).post('/platform/login/2fa').send({ challenge: ch, code: totp(secret, Date.now() + 30_000) });
    expect(locked.status).toBe(429);
    expect(locked.body.error.message).toMatch(/try again in/i);
  });

  it('required for everyone: a member without it can only set it up; it can’t be turned off; an Owner resets', async () => {
    const owner = await member(OWNER);
    expect((await request(platform).put('/platform/settings/security').set(owner.auth).send({ requireTwoFactor: true })).status).toBe(409); // owner first
    await enable(owner);
    expect((await request(platform).put('/platform/settings/security').set(owner.auth).send({ requireTwoFactor: true })).body.data).toEqual({ requireTwoFactor: true });
    try {
      const rep = await member(SALES);
      const blocked = await request(platform).get('/platform/sales/leads').set(rep.auth);
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.details).toMatchObject({ reason: 'two_factor_setup_required' });
      expect((await request(platform).get('/platform/me').set(rep.auth)).body.data.twoFactor).toMatchObject({ enabled: false, required: true });
      await enable(rep);
      expect((await request(platform).get('/platform/sales/leads').set(rep.auth)).status).toBe(200);
      expect((await request(platform).post('/platform/me/2fa/disable').set(rep.auth).send({ password: PW })).status).toBe(409);
      // Lost the phone: an Owner resets it — the next sign-in has no code step (and they must set it up again).
      expect((await request(platform).post(`/platform/admins/${rep.id}/2fa/reset`).set(owner.auth)).status).toBe(200);
      expect((await login(rep.email)).body.data).toHaveProperty('token');
      expect((await request(platform).get('/platform/sales/leads').set(rep.auth)).status).toBe(403);
      expect(((await request(platform).get('/platform/admins').set(owner.auth)).body.data as { id: string; two_factor: boolean }[]).find((a) => a.id === owner.id)!.two_factor).toBe(true);
    } finally {
      await query(`DELETE FROM platform_settings WHERE key = 'security'`);
      await request(platform).put('/platform/settings/security').set(owner.auth).send({ requireTwoFactor: false });
    }
  });
});
