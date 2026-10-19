/**
 * Super Admin › System health and global search — on a real Postgres + Redis (INTEGRATION_DB=1).
 *
 * - /system: server, Postgres (round trip, pool, migration), Redis, every queue with counts and workers.
 * - Failed jobs: list (no payloads), retry / clean — platform:full only; an unknown queue is a 404.
 * - /search: grouped results, only the groups a role may read; an 'assigned' role only its networks.
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
const ROLE = { owner: '00000000-0000-4000-a000-000000000001', sales: '00000000-0000-4000-a000-000000000003', am: '00000000-0000-4000-a000-000000000004', read_only: '00000000-0000-4000-a000-000000000007' };

d('Super Admin › System & search (live DB)', () => {
  let platform: Express;
  let fx: Fixture;
  const staff = async (roleId: string) => {
    const id = randomUUID();
    await query(`INSERT INTO platform_admins (id, email, name, status, auth_provider, password_hash, role_id) VALUES ($1, $2, $3, 'active', 'local', $4, $5)`,
      [id, `sy-${id.slice(0, 8)}@test.local`, `Sy ${id.slice(0, 4)}`, await hashPassword(`pw-${id}`), roleId]);
    return { id, auth: bearer(await signPlatformAdminToken(id)) };
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`sys-${randomUUID().slice(0, 8)}`);
    platform = buildPlatformAdminApp();
  });

  it('system health: server, Postgres, Redis, queues; failed jobs actions need platform:full', async () => {
    const owner = await staff(ROLE.owner);
    const s = await request(platform).get('/platform/system').set(owner.auth);
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.data.database).toMatchObject({ ok: true, latestMigration: { name: expect.stringMatching(/^\d+_/) } });
    expect(s.body.data.database.roundTripMs).toEqual(expect.any(Number));
    expect(s.body.data.server).toMatchObject({ node: process.version });
    expect(s.body.data.redis).toMatchObject({ ok: true });
    const billing = (s.body.data.queues as { name: string; counts: Record<string, number> | null }[]).find((q) => q.name === 'platform-billing');
    expect(billing?.counts).toEqual(expect.objectContaining({ waiting: expect.any(Number), failed: expect.any(Number) }));
    expect((await request(platform).get('/platform/system/queues/platform-health/failed').set(owner.auth)).body.data).toEqual(expect.any(Array));
    expect((await request(platform).get('/platform/system/queues/nope/failed').set(owner.auth)).status).toBe(404);
    expect((await request(platform).post('/platform/system/queues/platform-health/retry-failed').set(owner.auth)).body.data).toEqual({ retried: expect.any(Number) });
    const ro = await staff(ROLE.read_only);
    expect((await request(platform).get('/platform/system').set(ro.auth)).status).toBe(200);
    expect((await request(platform).post('/platform/system/queues/platform-health/clean-failed').set(ro.auth)).status).toBe(403);
  });

  it('search: grouped, per role; an assigned role only its networks', async () => {
    const owner = await staff(ROLE.owner);
    const t = randomUUID().slice(0, 6);
    await query(`UPDATE networks SET name = $2 WHERE id = $1`, [fx.networkA, `Zeta ${t} Media`]);
    await query(`INSERT INTO sales_leads (company, email, stage) VALUES ($1, $2, 'new')`, [`Zeta ${t} Leads`, `z-${t}@lead.test`]);
    const ticket = (await query<{ number: string }>(`INSERT INTO support_tickets (network_id, subject) VALUES ($1, $2) RETURNING number::text`, [fx.networkA, `Zeta ${t} postbacks`])).rows[0]!;
    const all = (await request(platform).get(`/platform/search?q=${encodeURIComponent(`Zeta ${t}`)}`).set(owner.auth)).body.data;
    expect(all.networks.map((n: { id: string }) => n.id)).toEqual([fx.networkA]);
    expect(all.leads).toHaveLength(1);
    expect(all.tickets).toHaveLength(1);
    expect(Object.keys(all).sort()).toEqual(['invoices', 'leads', 'networks', 'staff', 'tickets']);
    expect((await request(platform).get(`/platform/search?q=%23${ticket.number}`).set(owner.auth)).body.data.tickets.map((x: { number: string }) => x.number)).toContain(ticket.number);

    const sales = await staff(ROLE.sales);
    const sres = (await request(platform).get(`/platform/search?q=${encodeURIComponent(`Zeta ${t}`)}`).set(sales.auth)).body.data;
    expect(sres).not.toHaveProperty('staff'); // Sales can't see the team
    expect(sres.leads).toHaveLength(1);

    const am = await staff(ROLE.am);
    expect((await request(platform).get(`/platform/search?q=${encodeURIComponent(`Zeta ${t}`)}`).set(am.auth)).body.data.networks).toEqual([]);
    await query('UPDATE networks SET account_manager_id = $1 WHERE id = $2', [am.id, fx.networkA]);
    expect((await request(platform).get(`/platform/search?q=${encodeURIComponent(`Zeta ${t}`)}`).set(am.auth)).body.data.networks).toHaveLength(1);
  });
});
