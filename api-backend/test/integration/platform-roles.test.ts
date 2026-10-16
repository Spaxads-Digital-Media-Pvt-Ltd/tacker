/**
 * Platform staff roles (Super Admin › Team › Roles) — on a real Postgres (INTEGRATION_DB=1).
 *
 * - Each built-in role sees / changes only its sections (403 names the role and the section).
 * - Account Manager is 'assigned': only the networks it manages — lists, details, invoices, usage and the
 *   overview are scoped; another network is a 404 (never "forbidden").
 * - Custom roles (Owner-only) apply at once; built-in ones can't be deleted, nor a role in use.
 * - Owner protections: nobody changes their own role; only an Owner gives / takes the Owner role; the last
 *   active Owner can't be demoted or disabled.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildPlatformAdminApp } from '../../src/surfaces/platform-admin/app.js';
import { query } from '../../src/lib/db/pool.js';
import { signPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { hashPassword } from '../../src/lib/auth/platform-admin-password.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const ROLE = {
  owner: '00000000-0000-4000-a000-000000000001', admin: '00000000-0000-4000-a000-000000000002',
  sales: '00000000-0000-4000-a000-000000000003', am: '00000000-0000-4000-a000-000000000004',
  support: '00000000-0000-4000-a000-000000000005', finance: '00000000-0000-4000-a000-000000000006',
};

d('platform staff roles (live DB)', () => {
  let platform: Express;
  let fx: Fixture;
  const staff = async (roleId: string) => {
    const id = randomUUID();
    await query(`INSERT INTO platform_admins (id, email, status, auth_provider, password_hash, role_id) VALUES ($1, $2, 'active', 'local', $3, $4)`,
      [id, `st-${id.slice(0, 8)}@test.local`, await hashPassword(`pw-${id}`), roleId]);
    return { id, auth: bearer(await signPlatformAdminToken(id)) };
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`roles-${randomUUID().slice(0, 8)}`);
    platform = buildPlatformAdminApp();
  });

  it('/me carries the role and its permissions', async () => {
    const s = await staff(ROLE.sales);
    const me = await request(platform).get('/platform/me').set(s.auth);
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ role: { key: 'sales', name: 'Sales', scope: 'all', home: '/admin/sales' }, permissions: { sales: 'full', networks: 'read', team: 'none' } });
  });

  it('Sales: reads networks and invoices, can’t change them, can’t see the team', async () => {
    const s = await staff(ROLE.sales);
    expect((await request(platform).get('/platform/networks').set(s.auth)).status).toBe(200);
    const create = await request(platform).post('/platform/networks').set(s.auth).send({ name: 'x', slug: `x-${randomUUID().slice(0, 6)}` });
    expect(create.status).toBe(403);
    expect(create.body.error).toMatchObject({ message: expect.stringMatching(/Your role \(Sales\) can’t change Networks/), details: { reason: 'permission', section: 'networks', level: 'full' } });
    expect((await request(platform).get('/platform/invoices').set(s.auth)).status).toBe(200);
    expect((await request(platform).post(`/platform/networks/${fx.networkA}/invoices`).set(s.auth).send({ description: 'x', amount: '1' })).status).toBe(403);
    expect((await request(platform).get('/platform/admins').set(s.auth)).status).toBe(403);
    expect((await request(platform).post(`/platform/networks/${fx.networkA}/support-session`).set(s.auth)).status).toBe(403);
  });

  it('Account Manager: only its assigned networks — everywhere; another one is a 404', async () => {
    const am = await staff(ROLE.am);
    await query('UPDATE networks SET account_manager_id = $1 WHERE id = $2', [am.id, fx.networkA]);
    const list = await request(platform).get('/platform/networks').set(am.auth);
    expect((list.body.data as { id: string }[]).map((n) => n.id)).toEqual([fx.networkA]);
    expect(list.body.pagination.total).toBe(1);
    expect((await request(platform).get(`/platform/networks/${fx.networkA}`).set(am.auth)).status).toBe(200);
    expect((await request(platform).get(`/platform/networks/${fx.networkB}`).set(am.auth)).status).toBe(404);
    expect((await request(platform).post(`/platform/networks/${fx.networkB}/support-session`).set(am.auth)).status).toBe(404);
    expect((await request(platform).post(`/platform/networks/${fx.networkA}/support-session`).set(am.auth)).status).toBe(200);
    const usage = await request(platform).get('/platform/usage').set(am.auth);
    expect((usage.body.data as { id: string }[]).map((n) => n.id)).toEqual([fx.networkA]);
    // Invoices of other networks are out of reach (list and by id).
    const owner = await staff(ROLE.owner);
    const other = await request(platform).post(`/platform/networks/${fx.networkB}/invoices`).set(owner.auth).send({ description: 'Other', amount: '5' });
    const mine = await request(platform).post(`/platform/networks/${fx.networkA}/invoices`).set(owner.auth).send({ description: 'Mine', amount: '5' });
    const invoices = (await request(platform).get('/platform/invoices').set(am.auth)).body.data as { id: string }[];
    expect(invoices.map((i) => i.id)).toContain(mine.body.data.id);
    expect(invoices.map((i) => i.id)).not.toContain(other.body.data.id);
    expect((await request(platform).get(`/platform/invoices/${other.body.data.id}`).set(am.auth)).status).toBe(404);
    // The overview counts only its networks; revenue isn't its to see.
    const sum = await request(platform).get('/platform/summary').set(am.auth);
    expect(sum.body.data.networks.total).toBe(1);
    expect(sum.body.data.mrr).toBeNull();
  });

  it('Finance: billing full (record a payment), networks read-only', async () => {
    const f = await staff(ROLE.finance);
    const owner = await staff(ROLE.owner);
    const inv = await request(platform).post(`/platform/networks/${fx.networkA}/invoices`).set(owner.auth).send({ description: 'Fee', amount: '10' });
    expect((await request(platform).post(`/platform/invoices/${inv.body.data.id}/mark-paid`).set(f.auth).send({ method: 'upi' })).status).toBe(200);
    expect((await request(platform).patch(`/platform/networks/${fx.networkA}`).set(f.auth).send({ name: 'nope' })).status).toBe(403);
  });

  it('custom roles: an Owner creates one, it applies at once; built-in ones and roles in use can’t be deleted', async () => {
    const owner = await staff(ROLE.owner);
    const created = await request(platform).post('/platform/roles').set(owner.auth).send({
      name: 'Support Lite', description: 'Tickets only', scope: 'all', home: '/admin/support', permissions: { support: 'full', dashboard: 'read' },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.permissions).toMatchObject({ support: 'full', dashboard: 'read', networks: 'none', team: 'none' });
    const member = await request(platform).post('/platform/admins').set(owner.auth).send({ email: `cr-${randomUUID().slice(0, 6)}@test.local`, password: 'a-strong-password-123', roleId: created.body.data.id });
    expect(member.status).toBe(201);
    const auth = bearer(await signPlatformAdminToken(member.body.data.id));
    expect((await request(platform).get('/platform/networks').set(auth)).status).toBe(403);
    // Tighten it: networks read → allowed now, at once.
    await request(platform).patch(`/platform/roles/${created.body.data.id}`).set(owner.auth).send({ permissions: { support: 'full', dashboard: 'read', networks: 'read' } });
    expect((await request(platform).get('/platform/networks').set(auth)).status).toBe(200);
    expect((await request(platform).delete(`/platform/roles/${created.body.data.id}`).set(owner.auth)).status).toBe(409); // in use
    expect((await request(platform).delete(`/platform/roles/${ROLE.sales}`).set(owner.auth)).status).toBe(409); // built in
    expect((await request(platform).patch(`/platform/roles/${ROLE.owner}`).set(owner.auth).send({ name: 'Boss' })).status).toBe(409);
    const adminMember = await staff(ROLE.admin);
    expect((await request(platform).post('/platform/roles').set(adminMember.auth).send({ name: 'x', scope: 'all', home: '/admin', permissions: {} })).status).toBe(403);
    await request(platform).patch(`/platform/admins/${member.body.data.id}`).set(owner.auth).send({ roleId: ROLE.support });
    expect((await request(platform).delete(`/platform/roles/${created.body.data.id}`).set(owner.auth)).status).toBe(200);
  });

  it('Owner protections: not your own role; only an Owner gives the Owner role; the last active Owner stays', async () => {
    const owner = await staff(ROLE.owner);
    expect((await request(platform).patch(`/platform/admins/${owner.id}`).set(owner.auth).send({ roleId: ROLE.sales })).status).toBe(409);
    // A custom role with team:full can manage staff but not hand out the Owner role.
    const teamRole = await request(platform).post('/platform/roles').set(owner.auth).send({ name: `Team ${randomUUID().slice(0, 4)}`, scope: 'all', home: '/admin', permissions: { team: 'full' } });
    const lead = await request(platform).post('/platform/admins').set(owner.auth).send({ email: `tl-${randomUUID().slice(0, 6)}@test.local`, password: 'a-strong-password-123', roleId: teamRole.body.data.id });
    const leadAuth = bearer(await signPlatformAdminToken(lead.body.data.id));
    const target = await staff(ROLE.sales);
    expect((await request(platform).patch(`/platform/admins/${target.id}`).set(leadAuth).send({ roleId: ROLE.owner })).status).toBe(403);
    expect((await request(platform).patch(`/platform/admins/${target.id}`).set(leadAuth).send({ roleId: ROLE.support })).status).toBe(200);
    // The last active Owner: every other active Owner set aside for the check, then restored.
    const others = (await query<{ id: string }>(`SELECT id FROM platform_admins WHERE status = 'active' AND role_id = $1 AND id <> $2`, [ROLE.owner, owner.id])).rows.map((x) => x.id);
    await query(`UPDATE platform_admins SET status = 'disabled' WHERE id = ANY($1::uuid[])`, [others]);
    try {
      // A team manager (not an Owner) can disable members — but not the only active Owner.
      const last = await request(platform).patch(`/platform/admins/${owner.id}`).set(leadAuth).send({ status: 'disabled' });
      expect(last.status).toBe(409);
      expect(last.body.error.message).toMatch(/last active Owner/);
      // With a second Owner, it can.
      const second = await staff(ROLE.owner);
      expect((await request(platform).patch(`/platform/admins/${owner.id}`).set(leadAuth).send({ status: 'disabled' })).status).toBe(200);
      // Nobody changes their own role — not even an Owner.
      expect((await request(platform).patch(`/platform/admins/${second.id}`).set(second.auth).send({ roleId: ROLE.sales })).status).toBe(409);
      await query(`UPDATE platform_admins SET status = 'active' WHERE id = $1`, [owner.id]);
    } finally {
      await query(`UPDATE platform_admins SET status = 'active' WHERE id = ANY($1::uuid[])`, [others]);
    }
  });
});
