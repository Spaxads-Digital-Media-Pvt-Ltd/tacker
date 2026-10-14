/**
 * Behind a proxy (O2) — the dashboard on a real Postgres + Redis (INTEGRATION_DB=1), configured like
 * AWS + Cloudflare: TRUSTED_PROXIES=private (the load balancer's VPC address), Cloudflare built in.
 * supertest connects over loopback (a trusted hop), so each request looks like
 * visitor → [Cloudflare] → load balancer (10.0.0.5) → us.
 *
 * Before, the dashboard trusted no proxy: every visitor was the proxy's address, so one attacker's
 * failed logins locked everyone out, and audit logs / login history showed the proxy's IP.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

vi.hoisted(() => { process.env.TRUSTED_PROXIES = 'private'; });
vi.mock('../../src/lib/supabase.js', () => ({
  getSupabaseAdmin: () => ({
    auth: { signInWithPassword: async () => ({ data: { session: null, user: null }, error: { message: 'Invalid login credentials' } }) },
  }),
}));

import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { getRedis } from '../../src/lib/redis.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('behind a proxy: the real visitor address everywhere (live DB)', () => {
  let dash: Express;
  let fx: Fixture;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`proxy-${randomUUID().slice(0, 8)}`);
    dash = buildDashboardApp();
  });
  beforeEach(async () => {
    const redis = getRedis();
    const keys = await redis.keys('lr:*');
    if (keys.length) await redis.del(...keys);
  });

  const attempt = (visitor: string, n: number) =>
    request(dash).post('/api/auth/login')
      .set('X-Forwarded-For', `${visitor}, 10.0.0.5`)
      .send({ email: `rl-${n}-${randomUUID().slice(0, 6)}@example.com`, password: 'not-the-password-123' });

  it('each visitor has their own login rate-limit bucket (one attacker no longer locks everyone out)', async () => {
    // Fail logins from one visitor until the IP limit refuses them (how many depends on the limiter's
    // weighting — not what this checks)…
    let n = 0;
    let status = 401;
    while (status === 401 && n < 30) status = (await attempt('203.0.113.7', n++)).status;
    expect(status).toBe(429);
    expect(n).toBeGreaterThan(1);
    // …a different visitor behind the same proxy is unaffected (before O2 they shared one bucket).
    expect((await attempt('203.0.113.8', 100)).status).toBe(401);
    expect((await attempt('203.0.113.7', 101)).status).toBe(429);
  });

  it('the audit log records the visitor, and an address the client wrote itself is ignored', async () => {
    const admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
    const res = await request(dash).patch(`/api/publishers/${fx.pubA2}`).set(admin)
      .set('X-Forwarded-For', '1.1.1.1, 198.51.100.23, 10.0.0.5') // "1.1.1.1" was written by the client
      .send({ notes: `proxy check ${randomUUID().slice(0, 4)}` });
    expect(res.status).toBe(200);
    const { rows } = await query<{ ip: string }>(
      `SELECT ip FROM audit_log WHERE network_id = $1 AND entity_id = $2 AND action = 'publisher.update' ORDER BY created_at DESC LIMIT 1`,
      [fx.networkA, fx.pubA2]);
    expect(rows[0]?.ip).toBe('198.51.100.23');
  });

  it('a hop that is not a trusted proxy is the visitor (a public address is never skipped)', async () => {
    const admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
    await request(dash).patch(`/api/publishers/${fx.pubA2}`).set(admin)
      .set('X-Forwarded-For', '198.51.100.23, 203.0.113.99') // 203.0.113.99 is not a proxy we trust
      .send({ notes: `proxy check ${randomUUID().slice(0, 4)}` });
    const { rows } = await query<{ ip: string }>(
      `SELECT ip FROM audit_log WHERE network_id = $1 AND entity_id = $2 AND action = 'publisher.update' ORDER BY created_at DESC LIMIT 1`,
      [fx.networkA, fx.pubA2]);
    expect(rows[0]?.ip).toBe('203.0.113.99');
  });
});
