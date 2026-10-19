/**
 * Super Admin › tenants — on a real Postgres (INTEGRATION_DB=1), Supabase Auth faked.
 *
 * - Networks list: search (name / slug / a team email) and filters; never a network's settings or postback code.
 * - Network detail: subscription, owner (first admin) with last sign-in, counts, tracking domains, usage.
 * - Team: a temporary password for a member who can't get in (shown once, must change it, not audited in clear).
 * - Support session ("Open dashboard"): 30 minutes as the network's admin — scoped to that network, every
 *   write audited to the Super Admin, credential changes refused, over the moment the Super Admin is
 *   disabled; only for an active network.
 * - Activity: what Super Admins did to the network, including writes made in a support session.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

const sb = vi.hoisted(() => ({ updates: [] as { id: string; attrs: Record<string, unknown> }[] }));
vi.mock('../../src/lib/supabase.js', () => ({
  getSupabaseAdmin: () => ({
    auth: {
      admin: {
        updateUserById: async (id: string, attrs: Record<string, unknown>) => {
          sb.updates.push({ id, attrs });
          return { data: { user: { id } }, error: null };
        },
      },
    },
  }),
}));

import { buildPlatformAdminApp } from '../../src/surfaces/platform-admin/app.js';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { signPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { hashPassword } from '../../src/lib/auth/platform-admin-password.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('Super Admin › tenants (live DB)', () => {
  let platform: Express;
  let dash: Express;
  let fx: Fixture;
  let pa: Record<string, string>;
  let adminId: string;
  let adminEmail: string;
  let ownerAuthId: string;
  let ownerUserId: string;
  let slugA: string;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`tenants-${randomUUID().slice(0, 8)}`);
    slugA = (await query<{ slug: string }>('SELECT slug FROM networks WHERE id = $1', [fx.networkA])).rows[0]!.slug;
    adminId = randomUUID();
    adminEmail = `pa-${adminId.slice(0, 8)}@test.local`;
    await query(`INSERT INTO platform_admins (id, email, status, auth_provider, password_hash) VALUES ($1, $2, 'active', 'local', $3)`,
      [adminId, adminEmail, await hashPassword(`pw-${adminId}`)]);
    pa = bearer(await signPlatformAdminToken(adminId));
    ownerAuthId = randomUUID();
    ownerUserId = (await query<{ id: string }>(
      `INSERT INTO users (network_id, auth_user_id, email, name, role, status) VALUES ($1, $2, $3, 'Owner', 'admin', 'active') RETURNING id`,
      [fx.networkA, ownerAuthId, `owner-${slugA}@example.com`])).rows[0]!.id;
    await query(`INSERT INTO login_events (network_id, user_id, employee_email, created_at) VALUES ($1, $2, $3, now() - interval '2 hours')`,
      [fx.networkA, ownerAuthId, `owner-${slugA}@example.com`]);
    platform = buildPlatformAdminApp();
    dash = buildDashboardApp();
  });

  it('lists networks with search and filters — and none of their secrets', async () => {
    const bySlug = await request(platform).get(`/platform/networks?q=${slugA}`).set(pa);
    expect(bySlug.status).toBe(200);
    const row = (bySlug.body.data as Record<string, unknown>[]).find((n) => n['id'] === fx.networkA)!;
    expect(row).toMatchObject({ slug: slugA, status: 'active', owner_email: `owner-${slugA}@example.com` });
    expect(row).not.toHaveProperty('settings');
    expect(row).not.toHaveProperty('postback_security_code');
    // A team member's email finds the network too; LIKE wildcards are literal.
    const byEmail = await request(platform).get(`/platform/networks?q=${encodeURIComponent(`owner-${slugA}`)}`).set(pa);
    expect((byEmail.body.data as { id: string }[]).map((n) => n.id)).toEqual([fx.networkA]);
    expect((await request(platform).get('/platform/networks?q=%25%25%25').set(pa)).body.data).toEqual([]);
    const suspended = await request(platform).get(`/platform/networks?status=suspended&q=${slugA}`).set(pa);
    expect(suspended.body.data).toEqual([]);
    const noPlan = await request(platform).get(`/platform/networks?plan=none&q=${slugA}`).set(pa);
    expect((noPlan.body.data as { id: string }[]).map((n) => n.id)).toEqual([fx.networkA]);
    expect((await request(platform).get('/platform/networks?status=bogus').set(pa)).status).toBe(422);
  });

  it('shows one network in full: owner with last sign-in, counts, tracking domains, usage', async () => {
    const r = await request(platform).get(`/platform/networks/${fx.networkA}`).set(pa);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      id: fx.networkA, slug: slugA, subscription: null,
      owner: { id: ownerUserId, email: `owner-${slugA}@example.com`, has_login: true },
      counts: { users: 1, offers: 1, partners: 2, advertisers: 1 },
      usage: { plan: null, limits: [] },
    });
    expect(r.body.data.owner.last_sign_in_at).toBeTruthy();
    expect(Array.isArray(r.body.data.trackingDomains)).toBe(true);
    expect(r.body.data).not.toHaveProperty('settings');
    expect((await request(platform).get(`/platform/networks/${randomUUID()}`).set(pa)).status).toBe(404);
    expect((await request(platform).get('/platform/networks/not-a-uuid').set(pa)).status).toBe(404);
    const team = await request(platform).get(`/platform/networks/${fx.networkA}/users`).set(pa);
    expect(team.body.data).toEqual([expect.objectContaining({ id: ownerUserId, role: 'admin', has_login: true })]);
  });

  it('a team member who cannot get in gets a temporary password — shown once, must be changed, never logged', async () => {
    sb.updates.length = 0;
    const r = await request(platform).post(`/platform/networks/${fx.networkA}/users/${ownerUserId}/temporary-password`).set(pa);
    expect(r.status).toBe(200);
    expect(r.body.data.email).toBe(`owner-${slugA}@example.com`);
    const pw = r.body.data.temporaryPassword as string;
    expect(pw.length).toBeGreaterThanOrEqual(12);
    expect(sb.updates).toEqual([{ id: ownerAuthId, attrs: { password: pw, app_metadata: { must_change_password: true } } }]);
    const audit = (await query<{ after: unknown }>(
      `SELECT after FROM audit_log WHERE network_id = $1 AND action = 'network.user_temporary_password' ORDER BY created_at DESC LIMIT 1`, [fx.networkA])).rows[0];
    expect(JSON.stringify(audit?.after)).not.toContain(pw);
    // Another network's user is not reachable through this one.
    expect((await request(platform).post(`/platform/networks/${fx.networkB}/users/${ownerUserId}/temporary-password`).set(pa)).status).toBe(404);
  });

  it('Open dashboard: a support session as the network admin — scoped, audited to the Super Admin, no credential changes', async () => {
    const started = await request(platform).post(`/platform/networks/${fx.networkA}/support-session`).set(pa);
    expect(started.status).toBe(200);
    expect(started.body.data.expiresAt - Math.floor(Date.now() / 1000)).toBeGreaterThan(29 * 60);
    const t = bearer(started.body.data.token as string);

    const me = await request(dash).get('/api/me').set(t);
    expect(me.status).toBe(200);
    expect(me.body.data.identity).toMatchObject({ kind: 'admin', role: 'admin', networkId: fx.networkA, platformSupport: true });
    expect(me.body.data.impersonation).toMatchObject({ support: true, adminEmail, account: expect.any(String) });

    // Its own network only.
    const offers = await request(dash).get('/api/offers').set(t);
    expect(offers.status).toBe(200);
    expect((offers.body.data as { id: string }[]).map((o) => o.id)).toEqual([fx.offerA]);
    expect((await request(dash).get(`/api/publishers/${fx.pubB1}`).set(t)).status).toBe(404);

    // A write is the network admin's power, recorded under the Super Admin.
    const tag = await request(dash).post('/api/tags').set(t).send({ name: `support-${randomUUID().slice(0, 6)}` });
    expect(tag.status).toBe(201);
    const row = (await query<{ actor_type: string; actor_id: string; impersonated_by: string }>(
      `SELECT actor_type, actor_id, impersonated_by FROM audit_log WHERE network_id = $1 AND entity_id = $2`, [fx.networkA, tag.body.data.id])).rows;
    expect(row).toEqual([{ actor_type: 'platform_admin', actor_id: adminId, impersonated_by: adminId }]);

    // Credentials stay the account's own.
    const pw = await request(dash).patch('/api/me/password').set(t).send({ password: 'a-much-better-password-42' });
    expect(pw.status).toBe(403);
    expect(pw.body.error.message).toMatch(/while impersonating/);

    // The network's audit log names the Super Admin.
    const log = await request(dash).get('/api/audit-log?limit=50').set(t);
    const mine = (log.body.data as { employee: string; portal: string }[]).find((e) => e.portal === 'Platform Admin');
    expect(mine?.employee).toBe(`Super Admin ${adminEmail}`);

    // Disabling the Super Admin ends it at once.
    await query(`UPDATE platform_admins SET status = 'disabled' WHERE id = $1`, [adminId]);
    const after = await request(dash).get('/api/offers').set(t);
    expect(after.status).toBe(401);
    expect(after.body.error.message).toMatch(/Super Admin account is no longer active/);
    await query(`UPDATE platform_admins SET status = 'active' WHERE id = $1`, [adminId]);
  });

  it('a support session is only for an active network; the activity lists what Super Admins did', async () => {
    await query(`UPDATE networks SET status = 'suspended' WHERE id = $1`, [fx.networkB]);
    const refused = await request(platform).post(`/platform/networks/${fx.networkB}/support-session`).set(pa);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/suspended — activate it first/);
    await query(`UPDATE networks SET status = 'active' WHERE id = $1`, [fx.networkB]);

    const activity = await request(platform).get(`/platform/networks/${fx.networkA}/activity`).set(pa);
    expect(activity.status).toBe(200);
    const actions = (activity.body.data as { action: string; admin_email: string; in_support_session: boolean }[]);
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(['network.support_session', 'network.user_temporary_password', 'tag.create']));
    expect(actions.find((a) => a.action === 'tag.create')).toMatchObject({ admin_email: adminEmail, in_support_session: true });
    expect(actions.find((a) => a.action === 'network.support_session')).toMatchObject({ in_support_session: false });
  });
});
