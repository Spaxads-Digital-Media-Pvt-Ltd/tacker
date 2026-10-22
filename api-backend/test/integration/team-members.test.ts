/**
 * Editing team members takes effect — on a real Postgres (INTEGRATION_DB=1) with Supabase Auth
 * replaced by an in-memory fake of the admin API.
 *
 * The users row is the source of truth for a team member's dashboard access (dashboardAuth reads it,
 * lib/auth/staff-state.ts): a role change applies on their next request (not when their login token
 * next refreshes) and a disabled member is refused at once. The login is updated too (role claim, a
 * ban while disabled). Nobody can disable or demote themselves, and the network keeps an active admin.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

const sb = vi.hoisted(() => ({ updates: [] as { id: string; attrs: Record<string, unknown> }[], configured: true, takenEmails: new Set<string>() }));
vi.mock('../../src/lib/supabase.js', () => ({
  getSupabaseAdmin: () => {
    if (!sb.configured) throw new Error('Supabase admin client requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    return { auth: { admin: { updateUserById: async (id: string, attrs: Record<string, unknown>) => {
      if (typeof attrs['email'] === 'string' && sb.takenEmails.has(attrs['email'])) {
        return { data: { user: null }, error: { code: 'email_exists', status: 422, message: 'A user with this email address has already been registered' } };
      }
      sb.updates.push({ id, attrs });
      return { data: { user: { id } }, error: null };
    } } } };
  },
}));

import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('team member edits take effect (live DB, fake Supabase)', () => {
  let dash: Express;
  let fx: Fixture;
  /** A team member: a users row linked to a login, and a token whose role claim is what they were created with. */
  const member = async (role: string) => {
    const authId = randomUUID();
    const id = (await query<{ id: string }>(
      `INSERT INTO users (network_id, auth_user_id, email, name, role, status) VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
      [fx.networkA, authId, `m-${authId.slice(0, 8)}@example.com`, `Member ${authId.slice(0, 4)}`, role])).rows[0]!.id;
    return { id, authId, auth: bearer(operatorToken({ userId: authId, networkId: fx.networkA, role })) };
  };
  const edit = (auth: Record<string, string>, id: string, body: Record<string, unknown>) =>
    request(dash).patch(`/api/control-center/users/${id}`).set(auth).send(body);
  /** An admin-only call, to see what someone's current role allows. */
  const adminOnly = (auth: Record<string, string>) => request(dash).get('/api/settings/security').set(auth);

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`team-${randomUUID().slice(0, 8)}`);
    dash = buildDashboardApp();
  });
  beforeEach(() => { sb.updates.length = 0; sb.configured = true; sb.takenEmails.clear(); });

  it('a role change applies on the next request (same token), and the login’s role claim follows', async () => {
    const admin = await member('admin');
    const fin = await member('finance');
    expect((await adminOnly(fin.auth)).status).toBe(403);

    const promote = await edit(admin.auth, fin.id, { role: 'manager' });
    expect(promote.status).toBe(200);
    expect(promote.body.data).toMatchObject({ role: 'manager', loginSync: 'synced' });
    expect(sb.updates).toEqual([{ id: fin.authId, attrs: { app_metadata: { role: 'manager' } } }]);
    expect((await adminOnly(fin.auth)).status).toBe(200); // the old "finance" token now acts as manager

    await edit(admin.auth, fin.id, { role: 'read_only' });
    expect((await adminOnly(fin.auth)).status).toBe(403);
  });

  it('a disabled member is refused at once and banned from signing in; re-enabling restores both', async () => {
    const admin = await member('admin');
    const mgr = await member('manager');
    expect((await request(dash).get('/api/offers').set(mgr.auth)).status).toBe(200);

    const off = await edit(admin.auth, mgr.id, { status: 'disabled' });
    expect(off.status).toBe(200);
    expect(sb.updates).toEqual([{ id: mgr.authId, attrs: { ban_duration: '876000h' } }]);
    const refused = await request(dash).get('/api/offers').set(mgr.auth);
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toMatch(/This account is disabled/);

    await edit(admin.auth, mgr.id, { status: 'active' });
    expect(sb.updates.at(-1)).toEqual({ id: mgr.authId, attrs: { ban_duration: 'none' } });
    expect((await request(dash).get('/api/offers').set(mgr.auth)).status).toBe(200);

    // Name / title edits don't touch the login.
    sb.updates.length = 0;
    const renamed = await edit(admin.auth, mgr.id, { name: 'Renamed', title: 'Lead' });
    expect(renamed.body.data).toMatchObject({ name: 'Renamed', title: 'Lead', loginSync: 'no_change' });
    expect(sb.updates).toEqual([]);
  });

  it('nobody disables or demotes themselves, and the network keeps an active admin', async () => {
    const admin = await member('admin');
    const self1 = await edit(admin.auth, admin.id, { status: 'disabled' });
    expect(self1.status).toBe(400);
    expect(self1.body.error.message).toMatch(/can't disable your own account/);
    expect((await edit(admin.auth, admin.id, { role: 'manager' })).status).toBe(400);
    expect((await edit(admin.auth, admin.id, { name: 'Me' })).status).toBe(200); // other self-edits are fine

    // Even an admin login with no users row of its own can't remove the network's last active admin.
    await query(`UPDATE users SET status = 'disabled' WHERE network_id = $1 AND role = 'admin' AND id <> $2`, [fx.networkA, admin.id]);
    const owner = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
    const last = await edit(owner, admin.id, { role: 'manager' });
    expect(last.status).toBe(409);
    expect(last.body.error.message).toMatch(/only active admin/);
  });

  it('without Supabase configured the edit still applies (the users row is what is enforced)', async () => {
    const admin = await member('admin');
    const fin = await member('finance');
    sb.configured = false;
    const res = await edit(admin.auth, fin.id, { status: 'disabled' });
    expect(res.status).toBe(200);
    expect(res.body.data.loginSync).toBe('not_configured');
    expect((await request(dash).get('/api/offers').set(fin.auth)).status).toBe(403);
  });

  it('a new email becomes their sign-in address: the login moves (confirmed), both addresses are told; duplicates and failures change nothing', async () => {
    await query(`UPDATE networks SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb WHERE id = $1`, [fx.networkA, JSON.stringify({
      smtp: { host: 'smtp.example.test', port: 587, username: 'u', password: 'p', fromEmail: 'n@example.test', fromName: 'N' } })]);
    const admin = await member('admin');
    const m = await member('manager');
    const other = await member('finance');
    const emailOf = async (id: string) => (await query<{ email: string }>('SELECT email FROM users WHERE id = $1', [id])).rows[0]!.email;
    const before = await emailOf(m.id);
    const fresh = `moved-${randomUUID().slice(0, 6)}@example.com`;

    const ok = await edit(admin.auth, m.id, { email: fresh.toUpperCase() });
    expect(ok.status).toBe(200);
    expect(ok.body.data.email).toBe(fresh);
    expect(await emailOf(m.id)).toBe(fresh);
    expect(sb.updates).toEqual([{ id: m.authId, attrs: { email: fresh, email_confirm: true } }]);
    await new Promise((r) => setTimeout(r, 100)); // the notice is queued after the response
    const told = (await query<{ recipient: string }>(`SELECT recipient FROM email_outbox WHERE network_id = $1 AND event = 'login_email_changed' ORDER BY recipient`, [fx.networkA])).rows;
    expect(told.map((r) => r.recipient).sort()).toEqual([before, fresh].sort());

    // Same address in another case: nothing to change.
    sb.updates.length = 0;
    expect((await edit(admin.auth, m.id, { email: fresh.toUpperCase() })).status).toBe(200);
    expect(sb.updates).toEqual([]);

    // Another team member's address → 409, nothing touched.
    const dup = await edit(admin.auth, m.id, { email: await emailOf(other.id) });
    expect([dup.status, dup.body.error.details]).toEqual([409, { reason: 'email_in_use' }]);
    // A login elsewhere already has it → 409, row unchanged.
    sb.takenEmails.add('someone@example.com');
    expect((await edit(admin.auth, m.id, { email: 'someone@example.com' })).status).toBe(409);
    // Supabase not configured → 503, row unchanged.
    sb.configured = false;
    const down = await edit(admin.auth, m.id, { email: 'later@example.com' });
    expect(down.status).toBe(503);
    expect(down.body.error.message).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(await emailOf(m.id)).toBe(fresh);
  });
});
