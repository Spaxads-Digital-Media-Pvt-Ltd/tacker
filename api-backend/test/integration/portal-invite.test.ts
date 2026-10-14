/**
 * Partner/advertiser portal logins are provisioned in-product — on a real Postgres (INTEGRATION_DB=1,
 * as in CI) with Supabase Auth replaced by an in-memory fake of the admin API — audit F-04.
 *
 * Creating an account with a contact email (or POST /:id/invite) makes a Supabase login with the
 * portal claims and a temporary password, links it (auth_user_id) and emails it. Inviting is
 * idempotent by email (re-invite re-issues the same login; an existing login is linked, never
 * duplicated) and never takes over a login that belongs to someone else. Partners can sign up
 * themselves: a pending partner with a working portal login.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { passwordSchema } from '../../src/lib/auth/password-policy.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, portalToken, bearer } from '../helpers/tokens.js';

interface FakeUser {
  id: string;
  email: string;
  password: string;
  app_metadata: Record<string, unknown>;
  last_sign_in_at?: string;
}

// Supabase admin API fake: one user per email (like GoTrue), app_metadata merged on update.
const sb = vi.hoisted(() => {
  const users = new Map<string, FakeUser>();
  const byEmail = (email: string) => [...users.values()].find((u) => u.email === email.toLowerCase());
  const taken = { message: 'A user with this email address has already been registered', code: 'email_exists', status: 422 };
  const admin = {
    createUser: async (a: { email: string; password: string; app_metadata?: Record<string, unknown> }) => {
      if (byEmail(a.email)) return { data: { user: null }, error: taken };
      const user: FakeUser = { id: crypto.randomUUID(), email: a.email.toLowerCase(), password: a.password, app_metadata: { ...(a.app_metadata ?? {}) } };
      users.set(user.id, user);
      return { data: { user }, error: null };
    },
    getUserById: async (id: string) => {
      const user = users.get(id);
      return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'User not found', code: 'user_not_found', status: 404 } };
    },
    updateUserById: async (id: string, a: { email?: string; password?: string; app_metadata?: Record<string, unknown> }) => {
      const user = users.get(id);
      if (!user) return { data: { user: null }, error: { message: 'User not found', code: 'user_not_found', status: 404 } };
      if (a.email) {
        const other = byEmail(a.email);
        if (other && other.id !== id) return { data: { user: null }, error: taken };
        user.email = a.email.toLowerCase();
      }
      if (a.password) user.password = a.password;
      if (a.app_metadata) user.app_metadata = { ...user.app_metadata, ...a.app_metadata };
      return { data: { user }, error: null };
    },
    listUsers: async ({ page = 1, perPage = 50 }: { page?: number; perPage?: number } = {}) =>
      ({ data: { users: [...users.values()].slice((page - 1) * perPage, page * perPage) }, error: null }),
  };
  return {
    users, byEmail, admin, configured: true,
    add(u: Partial<FakeUser> & { email: string }): FakeUser {
      const user: FakeUser = { id: crypto.randomUUID(), password: 'their-own-password', app_metadata: {}, ...u, email: u.email.toLowerCase() };
      users.set(user.id, user);
      return user;
    },
  };
});

vi.mock('../../src/lib/supabase.js', () => ({
  getSupabaseAdmin: () => {
    if (!sb.configured) throw new Error('Supabase admin client requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    return { auth: { admin: sb.admin } };
  },
}));

// The real mailer by default (test networks have no SMTP → "not configured"); 'ok'/'fail' fake a send.
const mail = vi.hoisted(() => ({
  mode: 'actual' as 'actual' | 'ok' | 'fail',
  sent: [] as { networkId: string; to: string[]; subject: string; html: string }[],
}));
vi.mock('../../src/lib/mailer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/mailer.js')>();
  return {
    ...actual,
    sendNetworkEmail: async (networkId: string, to: string[], subject: string, html: string) => {
      if (mail.mode === 'actual') return actual.sendNetworkEmail(networkId, to, subject, html);
      mail.sent.push({ networkId, to, subject, html });
      return mail.mode === 'ok'
        ? { sent: to.length, results: to.map((recipient) => ({ recipient, ok: true })) }
        : { sent: 0, results: to.map((recipient) => ({ recipient, ok: false, error: 'connect ECONNREFUSED' })) };
    },
  };
});

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('portal logins are provisioned in-product (live DB, fake Supabase)', () => {
  let dash: Express;
  let fx: Fixture;
  let slugA: string;
  let admin: { Authorization: string };
  const as = (role: string) => bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role }));
  const newEmail = () => `Portal.${randomUUID().slice(0, 8)}@Example.com`;

  const authUserOf = async (table: 'publishers' | 'advertisers', id: string) =>
    (await query<{ auth_user_id: string | null }>(`SELECT auth_user_id FROM ${table} WHERE id = $1`, [id])).rows[0]!.auth_user_id;
  const createPartner = (body: Record<string, unknown>) =>
    request(dash).post('/api/publishers').set(admin).send({ name: `Partner ${randomUUID().slice(0, 6)}`, status: 'active', ...body });
  const invite = (id: string, kind: 'publishers' | 'advertisers' = 'publishers', auth = admin) =>
    request(dash).post(`/api/${kind}/${id}/invite`).set(auth);
  const signup = (body: Record<string, unknown>) =>
    request(dash).post('/api/signup/partner').send({ network: slugA, name: `Signup ${randomUUID().slice(0, 6)}`, ...body });

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`invite-${randomUUID().slice(0, 8)}`);
    slugA = (await query<{ slug: string }>('SELECT slug FROM networks WHERE id = $1', [fx.networkA])).rows[0]!.slug;
    dash = buildDashboardApp();
    admin = as('admin');
  });

  beforeEach(() => {
    sb.configured = true;
    mail.mode = 'actual';
    mail.sent.length = 0;
  });

  describe('invite on create', () => {
    it('creating a partner with a contact email provisions its portal login (claims stamped, auth_user_id linked)', async () => {
      const email = newEmail();
      const res = await createPartner({ contactEmail: email });
      expect(res.status).toBe(201);
      const { id, invited, invite: inv, hasPortalAccount } = res.body.data;
      expect(invited).toBe(true);
      expect(hasPortalAccount).toBe(true);
      expect(inv).toMatchObject({ outcome: 'created', email: email.toLowerCase(), emailed: false });
      expect(inv.emailError).toMatch(/SMTP is not fully configured/);

      expect(await authUserOf('publishers', id)).toBe(inv.authUserId);
      const user = sb.users.get(inv.authUserId)!;
      expect(user.email).toBe(email.toLowerCase());
      // A temporary password: the first sign-in must choose a new one (O1).
      expect(user.app_metadata).toEqual({ kind: 'publisher', network_id: fx.networkA, owner_id: id, must_change_password: true });

      // No SMTP outside production → the response carries the credentials, and they match the login.
      expect(inv.credentials).toMatchObject({ email: email.toLowerCase() });
      expect(inv.credentials.loginUrl).toMatch(/\/login$/);
      expect(inv.credentials.temporaryPassword).toBe(user.password);
      expect(passwordSchema.safeParse(user.password).success).toBe(true);
    });

    it('invite: false, no contact email, or an inactive partner → created without a login', async () => {
      const optedOut = newEmail();
      const a = await createPartner({ contactEmail: optedOut, invite: false });
      const b = await createPartner({});
      const inactive = newEmail();
      const c = await createPartner({ contactEmail: inactive, status: 'inactive' });
      for (const res of [a, b, c]) {
        expect(res.status).toBe(201);
        expect(res.body.data.invited).toBe(false);
        expect(await authUserOf('publishers', res.body.data.id)).toBeNull();
      }
      expect(sb.byEmail(optedOut)).toBeUndefined();
      expect(sb.byEmail(inactive)).toBeUndefined();
    });

    it('a failed invite never fails the create (Supabase not configured → invited false with the reason)', async () => {
      sb.configured = false;
      const res = await createPartner({ contactEmail: newEmail() });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ invited: false, hasPortalAccount: false });
      expect(res.body.data.inviteError).toMatch(/Supabase Auth is not configured/);
    });

    it('advertisers get the same: create with an email → advertiser portal login; invite again re-issues it', async () => {
      const email = newEmail();
      const res = await request(dash).post('/api/advertisers').set(admin).send({ name: `Adv ${randomUUID().slice(0, 6)}`, contactEmail: email });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ invited: true, hasPortalAccount: true });
      const authUserId = res.body.data.invite.authUserId as string;
      expect(await authUserOf('advertisers', res.body.data.id)).toBe(authUserId);
      expect(sb.users.get(authUserId)!.app_metadata).toEqual({ kind: 'advertiser', network_id: fx.networkA, owner_id: res.body.data.id, must_change_password: true });

      const again = await invite(res.body.data.id, 'advertisers');
      expect(again.status).toBe(200);
      expect(again.body.data).toMatchObject({ outcome: 'reissued', authUserId });
    });
  });

  describe('POST /:id/invite', () => {
    it('inviting twice re-issues the same login — no duplicate Supabase user', async () => {
      const email = newEmail();
      const pub = (await createPartner({ contactEmail: email, invite: false })).body.data.id as string;

      const first = await invite(pub);
      expect(first.status).toBe(200);
      expect(first.body.data.outcome).toBe('created');
      const second = await invite(pub);
      expect(second.status).toBe(200);
      expect(second.body.data).toMatchObject({ outcome: 'reissued', authUserId: first.body.data.authUserId });

      expect([...sb.users.values()].filter((u) => u.email === email.toLowerCase())).toHaveLength(1);
      expect(await authUserOf('publishers', pub)).toBe(first.body.data.authUserId);
      // The re-invite issued a fresh temporary password; the first one no longer works.
      expect(second.body.data.credentials.temporaryPassword).not.toBe(first.body.data.credentials.temporaryPassword);
      expect(sb.users.get(first.body.data.authUserId)!.password).toBe(second.body.data.credentials.temporaryPassword);
    });

    it('an existing login for the email is linked and re-stamped instead of failing; inviting again is "already invited"', async () => {
      const email = newEmail();
      const existing = sb.add({ email, last_sign_in_at: '2026-09-01T00:00:00Z' });
      const pub = (await createPartner({ contactEmail: email, invite: false })).body.data.id as string;

      const res = await invite(pub);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ outcome: 'linked', authUserId: existing.id, emailed: false });
      expect(res.body.data.credentials).toBeUndefined();
      expect(await authUserOf('publishers', pub)).toBe(existing.id);
      expect(existing.app_metadata).toEqual({ kind: 'publisher', network_id: fx.networkA, owner_id: pub });
      expect(existing.password).toBe('their-own-password'); // an active login keeps its password

      const again = await invite(pub);
      expect(again.status).toBe(409);
      expect(again.body.error.details).toEqual({ reason: 'already_active' });
      expect(again.body.error.message).toMatch(/Already invited/);
    });

    it("never takes over a login that belongs to someone else (other network, staff, another live partner) → 409", async () => {
      const owners: Record<string, unknown>[] = [
        { kind: 'publisher', network_id: fx.networkB, owner_id: fx.pubB1 },
        { kind: 'admin', network_id: fx.networkA, role: 'admin' },
        { kind: 'publisher', network_id: fx.networkA, owner_id: fx.pubA2 },
      ];
      for (const app_metadata of owners) {
        const email = newEmail();
        const other = sb.add({ email, app_metadata: { ...app_metadata } });
        const pub = (await createPartner({ contactEmail: email, invite: false })).body.data.id as string;
        const res = await invite(pub);
        expect(res.status).toBe(409);
        expect(res.body.error.details).toEqual({ reason: 'email_in_use' });
        expect(await authUserOf('publishers', pub)).toBeNull();
        expect(other.app_metadata).toEqual(app_metadata);
        expect(other.password).toBe('their-own-password');
      }
    });

    it('a login left over from a deleted partner of this network is free to re-use', async () => {
      const email = newEmail();
      const stale = sb.add({ email, app_metadata: { kind: 'publisher', network_id: fx.networkA, owner_id: randomUUID() } });
      const pub = (await createPartner({ contactEmail: email, invite: false })).body.data.id as string;
      const res = await invite(pub);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ outcome: 'reissued', authUserId: stale.id });
      expect(stale.app_metadata['owner_id']).toBe(pub);
    });

    it('contact email changed before they signed in → the same login moves to the new address', async () => {
      const before = newEmail();
      const created = await createPartner({ contactEmail: before });
      const pub = created.body.data.id as string;
      const authUserId = created.body.data.invite.authUserId as string;
      const after = newEmail();
      expect((await request(dash).patch(`/api/publishers/${pub}`).set(admin).send({ contactEmail: after })).status).toBe(200);

      const res = await invite(pub);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ outcome: 'reissued', authUserId, email: after.toLowerCase() });
      expect(sb.users.get(authUserId)!.email).toBe(after.toLowerCase());
      expect(sb.byEmail(before)).toBeUndefined();
    });

    it('clear errors: no contact email → 400 email_required; unknown partner → 404; Supabase not configured → 503', async () => {
      const noEmail = (await createPartner({})).body.data.id as string;
      const res = await invite(noEmail);
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual({ reason: 'email_required' });
      expect(res.body.error.message).toMatch(/contact email/);

      expect((await invite(randomUUID())).status).toBe(404);

      const pub = (await createPartner({ contactEmail: newEmail(), invite: false })).body.data.id as string;
      sb.configured = false;
      const down = await invite(pub);
      expect(down.status).toBe(503);
      expect(down.body.error.code).toBe('service_unavailable');
      expect(await authUserOf('publishers', pub)).toBeNull();
    });

    it('admin and manager can invite; finance and read_only cannot', async () => {
      const pub = (await createPartner({ contactEmail: newEmail(), invite: false })).body.data.id as string;
      expect((await invite(pub, 'publishers', as('finance'))).status).toBe(403);
      expect((await invite(pub, 'publishers', as('read_only'))).status).toBe(403);
      expect((await invite(pub, 'publishers', as('manager'))).status).toBe(200);
    });

    it('with SMTP working the email carries the login URL and temporary password (network name escaped), and the response does not', async () => {
      const { rows } = await query<{ name: string }>('SELECT name FROM networks WHERE id = $1', [fx.networkA]);
      await query('UPDATE networks SET name = $2 WHERE id = $1', [fx.networkA, 'Acme <b>&</b> Co']);
      try {
        mail.mode = 'ok';
        const email = newEmail();
        const res = await createPartner({ contactEmail: email });
        expect(res.status).toBe(201);
        expect(res.body.data.invite).toMatchObject({ emailed: true });
        expect(res.body.data.invite.credentials).toBeUndefined();
        expect(mail.sent).toHaveLength(1);
        const sent = mail.sent[0]!;
        expect(sent.to).toEqual([email.toLowerCase()]);
        expect(sent.html).toContain(sb.byEmail(email)!.password);
        expect(sent.html).toContain('/login');
        expect(sent.html).toContain('Acme &lt;b&gt;&amp;&lt;/b&gt; Co');
        expect(sent.html).not.toContain('<b>&</b>');

        // A failed send: still provisioned, the reason is returned, and (outside production) the credentials.
        mail.mode = 'fail';
        const failed = await createPartner({ contactEmail: newEmail() });
        expect(failed.status).toBe(201);
        expect(failed.body.data.invite).toMatchObject({ emailed: false, emailError: 'connect ECONNREFUSED' });
        expect(failed.body.data.invite.credentials.temporaryPassword).toBeTruthy();
      } finally {
        await query('UPDATE networks SET name = $2 WHERE id = $1', [fx.networkA, rows[0]!.name]);
      }
    });

    it("the network's Portal Invite system-email toggle applies: off → the login is made but not emailed (F-24)", async () => {
      const set = (key: string, enabled: boolean) =>
        request(dash).put(`/api/communication-hub/system-emails/${key}`).set(admin).send({ enabled });
      mail.mode = 'ok';
      expect((await set('partner_portal_invite', false)).status).toBe(200);
      try {
        const res = await createPartner({ contactEmail: newEmail() });
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ invited: true, hasPortalAccount: true });
        expect(res.body.data.invite).toMatchObject({ emailed: false, emailError: expect.stringMatching(/turned off in Communication Hub/) });
        expect(res.body.data.invite.credentials.temporaryPassword).toBeTruthy(); // outside production
        expect(mail.sent).toHaveLength(0);
        // The advertiser invite has its own toggle (still on).
        const adv = await request(dash).post('/api/advertisers').set(admin).send({ name: `Adv ${randomUUID().slice(0, 6)}`, contactEmail: newEmail() });
        expect(adv.body.data.invite).toMatchObject({ emailed: true });
        expect(mail.sent).toHaveLength(1);
      } finally {
        await set('partner_portal_invite', true);
      }
    });

    it('the audit log records the invite, never the temporary password', async () => {
      const created = await createPartner({ contactEmail: newEmail() });
      const password = created.body.data.invite.credentials.temporaryPassword as string;
      const { rows } = await query<{ after: Record<string, unknown> }>(
        `SELECT after FROM audit_log WHERE network_id = $1 AND action = 'publisher.invite' AND entity_id = $2`,
        [fx.networkA, created.body.data.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.after).toMatchObject({ outcome: 'created', emailed: false });
      expect(JSON.stringify(rows[0]!.after)).not.toContain(password);
    });
  });

  describe('POST /api/signup/partner (unauthenticated)', () => {
    it('creates a pending partner (Partners › Pending) with a portal login that reaches the partner portal', async () => {
      const email = newEmail();
      const res = await signup({ email, contactName: 'Pat Applicant', website: 'https://pat.example' });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ status: 'pending', emailed: false });
      expect(res.body.data.credentials.email).toBe(email.toLowerCase());

      const { rows } = await query<{ id: string; status: string; auth_user_id: string; contact_name: string; metadata: { signup?: { at?: string } } }>(
        `SELECT id, status, auth_user_id, contact_name, metadata FROM publishers WHERE network_id = $1 AND contact_email = $2`,
        [fx.networkA, email.toLowerCase()]);
      expect(rows).toHaveLength(1);
      const pub = rows[0]!;
      expect(pub).toMatchObject({ status: 'pending', contact_name: 'Pat Applicant' });
      expect(pub.metadata.signup?.at).toBeTruthy();

      const user = sb.users.get(pub.auth_user_id)!;
      expect(user.app_metadata).toEqual({ kind: 'publisher', network_id: fx.networkA, owner_id: pub.id, must_change_password: true });
      expect(user.password).toBe(res.body.data.credentials.temporaryPassword);

      const pending = await request(dash).get('/api/publishers').query({ paged: '1', tab: 'pending', pageSize: 200 }).set(admin);
      expect(pending.status).toBe(200);
      expect((pending.body.data.rows as { id: string }[]).map((r) => r.id)).toContain(pub.id);

      // The login's session (claims as provisioned) reaches the partner portal.
      const session = bearer(portalToken({
        userId: user.id, networkId: String(user.app_metadata['network_id']),
        kind: 'publisher', ownerId: String(user.app_metadata['owner_id']),
      }));
      const summary = await request(dash).get('/api/portal/publisher/summary').set(session);
      expect(summary.status).toBe(200);
      expect(summary.body.data).toHaveProperty('balances');

      const audit = await query<{ actor_type: string }>(
        `SELECT actor_type FROM audit_log WHERE network_id = $1 AND action = 'publisher.signup' AND entity_id = $2`, [fx.networkA, pub.id]);
      expect(audit.rows).toEqual([{ actor_type: 'system' }]);
    });

    it('one sign-up per email: again → 409, and an email with a login elsewhere → 409 with no partner left behind', async () => {
      const email = newEmail();
      expect((await signup({ email })).status).toBe(201);
      const again = await signup({ email });
      expect(again.status).toBe(409);
      expect(again.body.error.details).toEqual({ reason: 'already_registered' });

      const elsewhere = newEmail();
      sb.add({ email: elsewhere, app_metadata: { kind: 'publisher', network_id: fx.networkB, owner_id: fx.pubB1 } });
      const res = await signup({ email: elsewhere });
      expect(res.status).toBe(409);
      expect(res.body.error.details).toEqual({ reason: 'already_registered' });
      const { rows } = await query(`SELECT 1 FROM publishers WHERE network_id = $1 AND contact_email = $2`, [fx.networkA, elsewhere.toLowerCase()]);
      expect(rows).toHaveLength(0);
    });

    it('unknown network → 404; invalid body → 422; Supabase not configured → 503 and no partner', async () => {
      expect((await signup({ email: newEmail(), network: 'no-such-network' })).status).toBe(404);
      expect((await signup({ email: 'not-an-email' })).status).toBe(422);
      expect((await signup({ email: newEmail(), name: '' })).status).toBe(422);

      sb.configured = false;
      const email = newEmail();
      const res = await signup({ email });
      expect(res.status).toBe(503);
      const { rows } = await query(`SELECT 1 FROM publishers WHERE network_id = $1 AND contact_email = $2`, [fx.networkA, email.toLowerCase()]);
      expect(rows).toHaveLength(0);
    });

    it('Control Center "Auto Approve Partners" on → the sign-up is active', async () => {
      const put = (on: boolean) => request(dash).put('/api/control-center/config/partners').set(admin).send({ signup: { autoApprovePartners: on } });
      expect((await put(true)).status).toBe(200);
      try {
        const email = newEmail();
        const res = await signup({ email });
        expect(res.status).toBe(201);
        expect(res.body.data.status).toBe('active');
        const { rows } = await query<{ status: string }>(`SELECT status FROM publishers WHERE network_id = $1 AND contact_email = $2`, [fx.networkA, email.toLowerCase()]);
        expect(rows[0]!.status).toBe('active');
      } finally {
        await put(false);
      }
    });
  });
});
