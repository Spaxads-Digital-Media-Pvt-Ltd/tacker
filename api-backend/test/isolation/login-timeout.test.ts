/**
 * Supabase login timeout. POST /api/auth/login caps the Supabase signInWithPassword call at
 * LOGIN_TIMEOUT_MS; a timeout returns 503 and must NOT count as a failed password (no lockout).
 * Wrong-password and success paths are unchanged. No DB/Redis needed — Supabase and the rate
 * limiter are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { withTimeout, TimeoutError } from '../../src/lib/timeout.js';

describe('withTimeout', () => {
  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 50, 'slow')).resolves.toBe(42);
  });
  it('passes through the original rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50, 'slow')).rejects.toThrow('boom');
  });
  it('rejects with TimeoutError when the promise is too slow', async () => {
    const never = new Promise<never>(() => {});
    const err = await withTimeout(never, 20, 'too slow').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as Error).message).toBe('too slow');
  });
});

type SignInResult = { data: { session: unknown; user: unknown }; error: unknown };
let signIn: () => Promise<SignInResult>;
const recordLoginFailure = vi.fn(async () => ({ limited: false, retryAfterSeconds: 0, ipCount: 1, accountCount: 1 }));
const resetLoginCounter = vi.fn(async () => {});

async function buildApp(opts: { timeoutFires: boolean }) {
  vi.resetModules();
  vi.doMock('../../src/lib/supabase.js', () => ({
    getSupabaseAdmin: () => ({ auth: { signInWithPassword: () => signIn() } }),
  }));
  vi.doMock('../../src/lib/auth/login-rate-limit.js', () => ({
    checkLoginRateLimit: async () => ({ limited: false, ipCount: 0, accountCount: 0, retryAfterSeconds: 0 }),
    recordLoginFailure,
    resetLoginCounter,
  }));
  vi.doMock('../../src/surfaces/dashboard/control-center/routes.js', () => ({ recordLoginEvent: async () => {} }));
  // Simulate the 5s cap elapsing without waiting 5s; the real helper is unit-tested above.
  vi.doMock('../../src/lib/timeout.js', async () => {
    const actual = await vi.importActual<typeof import('../../src/lib/timeout.js')>('../../src/lib/timeout.js');
    return {
      ...actual,
      withTimeout: opts.timeoutFires
        ? async () => { throw new actual.TimeoutError('Authentication service timed out.'); }
        : actual.withTimeout,
    };
  });
  const { authRoutes } = await import('../../src/surfaces/dashboard/auth-routes.js');
  const { errorHandler } = await import('../../src/lib/http/envelope.js');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes());
  app.use(errorHandler);
  return app;
}

const creds = { email: 'qa@example.com', password: 'correct-horse-battery' };

describe('POST /api/auth/login — Supabase timeout', () => {
  beforeEach(() => { recordLoginFailure.mockClear(); resetLoginCounter.mockClear(); });

  it('a timeout returns 503 and is not recorded as a failed login', async () => {
    signIn = () => new Promise(() => {});
    const app = await buildApp({ timeoutFires: true });
    const res = await request(app).post('/api/auth/login').send(creds);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('service_unavailable');
    expect(recordLoginFailure).not.toHaveBeenCalled();
  });

  it('wrong password is unchanged: 401 and recorded as a failure', async () => {
    signIn = async () => ({ data: { session: null, user: null }, error: { message: 'Invalid login credentials' } });
    const app = await buildApp({ timeoutFires: false });
    const res = await request(app).post('/api/auth/login').send(creds);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password.');
    expect(recordLoginFailure).toHaveBeenCalledTimes(1);
  });

  it('success is unchanged: 200 with the session, counter reset', async () => {
    signIn = async () => ({
      data: {
        session: { access_token: 'tok', refresh_token: 'rt', expires_at: 123 },
        user: { id: 'u1', email: creds.email, app_metadata: { kind: 'admin', network_id: 'n1', role: 'admin' }, user_metadata: {} },
      },
      error: null,
    });
    const app = await buildApp({ timeoutFires: false });
    const res = await request(app).post('/api/auth/login').send(creds);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBe('tok');
    expect(resetLoginCounter).toHaveBeenCalledTimes(1);
    expect(recordLoginFailure).not.toHaveBeenCalled();
  });

  it('LOGIN_TIMEOUT_MS is 5 seconds', async () => {
    vi.resetModules();
    vi.doUnmock('../../src/lib/timeout.js');
    const { LOGIN_TIMEOUT_MS } = await import('../../src/surfaces/dashboard/auth-routes.js');
    expect(LOGIN_TIMEOUT_MS).toBe(5_000);
  });
});
