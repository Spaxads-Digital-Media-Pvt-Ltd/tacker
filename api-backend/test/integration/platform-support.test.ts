/**
 * Super Admin › Support (help desk) — on a real Postgres (INTEGRATION_DB=1).
 *
 * - A network's staff open a ticket (first-reply deadline by priority, auto-assigned to a Support member),
 *   see only their network's tickets, never internal notes; reply (→ back to the team), resolve, rate.
 * - The team: queue filters, a reply records the first response and waits on the customer, takes an
 *   unassigned ticket; internal notes; status changes on the thread; saved replies count their uses;
 *   the summary (SLA met, CSAT); support settings.
 * - Auto-close of resolved tickets; a support session can't write as the customer; roles and scope.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildPlatformAdminApp } from '../../src/surfaces/platform-admin/app.js';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { signPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { signSupportSessionToken } from '../../src/lib/auth/impersonation-token.js';
import { hashPassword } from '../../src/lib/auth/platform-admin-password.js';
import { closeResolvedTickets } from '../../src/lib/platform/support.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { bearer, operatorToken } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const ROLE = { owner: '00000000-0000-4000-a000-000000000001', sales: '00000000-0000-4000-a000-000000000003', am: '00000000-0000-4000-a000-000000000004', support: '00000000-0000-4000-a000-000000000005' };

d('Super Admin › Support (live DB)', () => {
  let platform: Express;
  let dash: Express;
  let fx: Fixture;
  let staffA: Record<string, string>;
  let staffB: Record<string, string>;
  let authA: string;
  const staff = async (roleId: string) => {
    const id = randomUUID();
    await query(`INSERT INTO platform_admins (id, email, name, status, auth_provider, password_hash, role_id) VALUES ($1, $2, $3, 'active', 'local', $4, $5)`,
      [id, `sp-${id.slice(0, 8)}@test.local`, `Agent ${id.slice(0, 4)}`, await hashPassword(`pw-${id}`), roleId]);
    return { id, auth: bearer(await signPlatformAdminToken(id)) };
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`sup-${randomUUID().slice(0, 8)}`);
    authA = randomUUID();
    await query(`INSERT INTO users (network_id, auth_user_id, email, name, role, status) VALUES ($1, $2, $3, 'Nina', 'admin', 'active')`,
      [fx.networkA, authA, `nina-${authA.slice(0, 6)}@a.test`]);
    staffA = bearer(operatorToken({ userId: authA, networkId: fx.networkA }));
    const authB = randomUUID();
    await query(`INSERT INTO users (network_id, auth_user_id, email, name, role, status) VALUES ($1, $2, $3, 'Ben', 'admin', 'active')`,
      [fx.networkB, authB, `ben-${authB.slice(0, 6)}@b.test`]);
    staffB = bearer(operatorToken({ userId: authB, networkId: fx.networkB }));
    platform = buildPlatformAdminApp();
    dash = buildDashboardApp();
  });

  it('a network opens a ticket; the team answers; the customer resolves and rates it', async () => {
    const agent = await staff(ROLE.support);
    // Make this agent the least busy Support member so auto-assignment picks it.
    await query(`UPDATE support_tickets SET status = 'closed' WHERE status IN ('open', 'pending', 'on_hold') AND assignee_id IN
                   (SELECT pa.id FROM platform_admins pa WHERE pa.role_id = $1)`, [ROLE.support]);
    const paused = (await query<{ id: string }>(
      `UPDATE platform_admins SET status = 'disabled' WHERE role_id = $1 AND id <> $2 AND status = 'active' RETURNING id`, [ROLE.support, agent.id])).rows.map((x) => x.id);
    try {
    const created = await request(dash).post('/api/support/tickets').set(staffA).send({ subject: 'Postbacks not firing', body: 'Since 10:00 no conversions', priority: 'urgent', category: 'tracking' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;
    const row = (await query<{ assignee_id: string; requester_email: string; minutes: number; status: string }>(
      `SELECT assignee_id, requester_email, status, round(extract(epoch FROM first_response_due_at - created_at) / 60)::int AS minutes FROM support_tickets WHERE id = $1`, [id])).rows[0]!;
    expect(row).toMatchObject({ assignee_id: agent.id, status: 'open', minutes: 60 }); // urgent → 1 h
    expect(row.requester_email).toMatch(/^nina-/);

    // Another network can't see it.
    expect((await request(dash).get(`/api/support/tickets/${id}`).set(staffB)).status).toBe(404);
    expect(((await request(dash).get('/api/support/tickets').set(staffB)).body.data as { id: string }[]).map((t) => t.id)).not.toContain(id);

    // The team: an internal note, then a reply.
    expect((await request(platform).post(`/platform/support/tickets/${id}/messages`).set(agent.auth).send({ body: 'Checked their postback logs — security code mismatch', internal: true })).status).toBe(201);
    const reply = await request(platform).post(`/platform/support/tickets/${id}/messages`).set(agent.auth).send({ body: 'Your postback URL has an old security code — update it in Settings.' });
    expect(reply.body.data).toMatchObject({ status: 'pending', breached: false });
    expect(reply.body.data.last_author).toBe('staff');

    // The customer sees the reply, not the note; replying sends it back to the team.
    const thread = (await request(dash).get(`/api/support/tickets/${id}`).set(staffA)).body.data;
    expect((thread.messages as { body: string }[]).map((m) => m.body)).toEqual(['Since 10:00 no conversions', 'Your postback URL has an old security code — update it in Settings.']);
    expect(thread.messages[1].author_name).toBe(`Agent ${agent.id.slice(0, 4)}`);
    expect((await request(dash).get('/api/support/summary').set(staffA)).body.data).toMatchObject({ waiting_on_you: 1 });
    expect((await request(dash).post(`/api/support/tickets/${id}/messages`).set(staffA).send({ body: 'Fixed, thanks!' })).body.data).toMatchObject({ status: 'open' });

    // Resolve and rate.
    expect((await request(dash).post(`/api/support/tickets/${id}/rate`).set(staffA).send({ satisfaction: 5 })).status).toBe(409); // not resolved yet
    expect((await request(dash).post(`/api/support/tickets/${id}/resolve`).set(staffA)).body.data).toMatchObject({ status: 'resolved' });
    expect((await request(dash).post(`/api/support/tickets/${id}/rate`).set(staffA).send({ satisfaction: 5, comment: 'Quick!' })).body.data).toMatchObject({ satisfaction: 5 });

    const sum = (await request(platform).get('/platform/support/summary').set(agent.auth)).body.data;
    expect(sum.counts.sla_met_30d).toBeGreaterThanOrEqual(1);
    expect(sum.counts.csat).not.toBeNull();
    } finally {
      await query(`UPDATE platform_admins SET status = 'active' WHERE id = ANY($1::uuid[])`, [paused]);
    }
  });

  it('the queue: filters, assignment on reply, status changes on the thread, macros, overdue', async () => {
    const owner = await staff(ROLE.owner);
    const agent = await staff(ROLE.support);
    const t = await request(platform).post('/platform/support/tickets').set(owner.auth).send({
      networkId: fx.networkA, subject: `Phone call ${randomUUID().slice(0, 4)}`, body: 'Called about invoices', category: 'billing', priority: 'low', assigneeId: null,
    });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect(t.body.data).toMatchObject({ assignee_id: null, status: 'open', breached: false }); // opened by the team: counts as answered
    const unassigned = (await request(platform).get(`/platform/support/tickets?assignee=unassigned&networkId=${fx.networkA}`).set(agent.auth)).body.data as { id: string }[];
    expect(unassigned.map((x) => x.id)).toContain(t.body.data.id);

    const macro = await request(platform).post('/platform/support/macros').set(agent.auth).send({ title: 'Invoice copy', body: 'Find it under Settings › Billing.' });
    expect(macro.status).toBe(201);
    const r = await request(platform).post(`/platform/support/tickets/${t.body.data.id}/messages`).set(agent.auth).send({ body: macro.body.data.body, macroId: macro.body.data.id });
    expect(r.body.data).toMatchObject({ assignee_id: agent.id, status: 'pending' }); // an unassigned ticket is taken by whoever answers
    expect((await query<{ uses: number }>('SELECT uses FROM support_macros WHERE id = $1', [macro.body.data.id])).rows[0]!.uses).toBe(1);

    const changed = await request(platform).patch(`/platform/support/tickets/${t.body.data.id}`).set(agent.auth).send({ status: 'resolved', priority: 'high', tags: ['Invoices'] });
    expect(changed.body.data).toMatchObject({ status: 'resolved', priority: 'high', tags: ['invoices'] });
    const detail = (await request(platform).get(`/platform/support/tickets/${t.body.data.id}`).set(agent.auth)).body.data;
    expect((detail.messages as { author_kind: string; body: string; internal: boolean }[]).at(-1)).toMatchObject({ author_kind: 'system', internal: true, body: expect.stringMatching(/Waiting on the customer → Resolved/) });
    expect(detail.network).toMatchObject({ id: fx.networkA });

    // Overdue: an urgent customer ticket past its first-reply deadline.
    const late = await request(dash).post('/api/support/tickets').set(staffA).send({ subject: 'Late one', body: 'help', priority: 'urgent' });
    await query(`UPDATE support_tickets SET first_response_due_at = now() - interval '5 minutes' WHERE id = $1`, [late.body.data.id]);
    const overdue = (await request(platform).get('/platform/support/tickets?overdue=true').set(agent.auth)).body.data as { id: string; breached: boolean }[];
    expect(overdue.find((x) => x.id === late.body.data.id)).toMatchObject({ breached: true });
    expect((await request(platform).get(`/platform/support/tickets?q=${late.body.data.number}`).set(agent.auth)).body.data.map((x: { id: string }) => x.id)).toEqual([late.body.data.id]);
  });

  it('auto-close; a support session can’t write as the customer; roles and scope; settings', async () => {
    const t = await request(dash).post('/api/support/tickets').set(staffA).send({ subject: 'Old one', body: 'x' });
    await request(dash).post(`/api/support/tickets/${t.body.data.id}/resolve`).set(staffA);
    await query(`UPDATE support_tickets SET resolved_at = now() - interval '8 days' WHERE id = $1`, [t.body.data.id]);
    expect(await closeResolvedTickets()).toBeGreaterThanOrEqual(1);
    expect((await query<{ status: string }>('SELECT status FROM support_tickets WHERE id = $1', [t.body.data.id])).rows[0]!.status).toBe('closed');
    expect((await request(dash).post(`/api/support/tickets/${t.body.data.id}/messages`).set(staffA).send({ body: 'again' })).status).toBe(409);

    const owner = await staff(ROLE.owner);
    const { token } = await signSupportSessionToken({ networkId: fx.networkA, platformAdminId: owner.id });
    const denied = await request(dash).post('/api/support/tickets').set(bearer(token)).send({ subject: 'x', body: 'y' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.message).toMatch(/support session/);

    const sales = await staff(ROLE.sales);
    // Sales reads the queue but can't answer.
    expect((await request(platform).get('/platform/support/tickets').set(sales.auth)).status).toBe(200);
    const salesReply = await request(platform).post(`/platform/support/tickets/${t.body.data.id}/messages`).set(sales.auth).send({ body: 'x', internal: true });
    expect(salesReply.status).toBe(403);
    expect(salesReply.body.error.message).toMatch(/Your role \(Sales\) can’t change Support/);
    const am = await staff(ROLE.am); // support: full, but only its networks
    expect((await request(platform).get(`/platform/support/tickets/${t.body.data.id}`).set(am.auth)).status).toBe(404);
    await query('UPDATE networks SET account_manager_id = $1 WHERE id = $2', [am.id, fx.networkA]);
    expect((await request(platform).get(`/platform/support/tickets/${t.body.data.id}`).set(am.auth)).status).toBe(200);

    const settings = await request(platform).put('/platform/settings/support').set(owner.auth).send({ firstResponseHours: { urgent: 2, high: 4, normal: 12, low: 48 }, autoCloseDays: 5, autoAssign: false });
    expect(settings.status).toBe(200);
    const unassigned = await request(dash).post('/api/support/tickets').set(staffA).send({ subject: 'No auto-assign', body: 'x', priority: 'urgent' });
    const row = (await query<{ assignee_id: string | null; h: number }>(`SELECT assignee_id, round(extract(epoch FROM first_response_due_at - created_at) / 3600)::int AS h FROM support_tickets WHERE id = $1`, [unassigned.body.data.id])).rows[0]!;
    expect(row).toEqual({ assignee_id: null, h: 2 });
    await query(`DELETE FROM platform_settings WHERE key = 'support'`);
  });
});
