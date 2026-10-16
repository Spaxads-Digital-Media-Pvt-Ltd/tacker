/**
 * Super Admin › Sales — on a real Postgres (INTEGRATION_DB=1), Supabase Auth faked.
 *
 * - Leads: create (the creator owns it), an open lead with the same email → 409 naming it, search /
 *   filters, stage and owner changes on the timeline, lost needs a reason, CSV.
 * - Kanban columns and the dashboard (an 'assigned' Sales role sees only its own leads — so its numbers
 *   are exact here).
 * - Convert to customer: network + owner login (temporary password once) + plan with a trial; the lead is
 *   won, linked, stays won and can't be deleted; the network knows who sold it; its export leaves the
 *   platform's sales records out.
 * - "Request a demo" (public): a lead routed to a Sales member with a follow-up task; a repeat becomes a
 *   note on the open lead; the honeypot stores nothing.
 * - Tasks: who sees and changes them; completing a lead's task notes it on the lead.
 * - Roles: Support can't see Sales; Finance reads it but can't change it.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

const sb = vi.hoisted(() => ({ created: [] as { email: string; app_metadata: Record<string, unknown> }[] }));
vi.mock('../../src/lib/supabase.js', () => ({
  getSupabaseAdmin: () => ({
    auth: {
      admin: {
        createUser: async (attrs: { email: string; app_metadata: Record<string, unknown> }) => {
          if (attrs.email.startsWith('taken-')) return { data: { user: null }, error: { message: 'A user with this email address has already been registered', code: 'email_exists' } };
          sb.created.push({ email: attrs.email, app_metadata: attrs.app_metadata });
          return { data: { user: { id: randomUUID() } }, error: null };
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
import { canConnect } from '../helpers/db.js';
import { bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const ROLE = {
  owner: '00000000-0000-4000-a000-000000000001', sales: '00000000-0000-4000-a000-000000000003',
  support: '00000000-0000-4000-a000-000000000005', finance: '00000000-0000-4000-a000-000000000006',
};
const tag = () => randomUUID().slice(0, 8);

d('Super Admin › Sales (live DB)', () => {
  let platform: Express;
  let dash: Express;
  const staff = async (roleId: string) => {
    const id = randomUUID();
    await query(`INSERT INTO platform_admins (id, email, name, status, auth_provider, password_hash, role_id) VALUES ($1, $2, $3, 'active', 'local', $4, $5)`,
      [id, `sl-${id.slice(0, 8)}@test.local`, `Staff ${id.slice(0, 4)}`, await hashPassword(`pw-${id}`), roleId]);
    return { id, auth: bearer(await signPlatformAdminToken(id)) };
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    platform = buildPlatformAdminApp();
    dash = buildDashboardApp();
  });

  it('leads: create, duplicate, filters, stage / owner on the timeline, lost needs a reason, CSV', async () => {
    const s = await staff(ROLE.sales);
    const other = await staff(ROLE.sales);
    const t = tag();
    const created = await request(platform).post('/platform/sales/leads').set(s.auth).send({
      company: `Acme ${t}`, contactName: 'Ann', email: `ann-${t}@acme.test`, source: 'referral', expectedMrr: '499.50', currency: 'usd', monthlyClicks: 2000000, tags: ['enterprise'],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const lead = created.body.data;
    expect(lead).toMatchObject({ company: `Acme ${t}`, stage: 'new', owner_id: s.id, expected_mrr: '499.50', currency: 'USD', monthly_clicks: 2000000, source: 'referral' });

    const dup = await request(platform).post('/platform/sales/leads').set(s.auth).send({ company: 'Other', email: `ANN-${t}@acme.test` });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ message: expect.stringContaining(`(Acme ${t})`), details: { reason: 'duplicate', leadId: lead.id } });
    // Amounts are text, never floats.
    expect((await request(platform).post('/platform/sales/leads').set(s.auth).send({ company: 'x', expectedMrr: '4.999' })).status).toBe(422);

    const found = await request(platform).get(`/platform/sales/leads?q=${encodeURIComponent(`acme ${t}`)}`).set(s.auth);
    expect((found.body.data as { id: string }[]).map((l) => l.id)).toEqual([lead.id]);
    expect((await request(platform).get(`/platform/sales/leads?q=${t}&source=event`).set(s.auth)).body.data).toEqual([]);
    expect((await request(platform).get(`/platform/sales/leads?q=${t}&owner=me`).set(s.auth)).body.data).toHaveLength(1);
    expect((await request(platform).get(`/platform/sales/leads?q=${t}&owner=me`).set(other.auth)).body.data).toHaveLength(0);

    const moved = await request(platform).patch(`/platform/sales/leads/${lead.id}`).set(s.auth).send({ stage: 'demo', ownerId: other.id, nextStep: 'Send proposal', nextStepAt: '2026-11-02' });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.data).toMatchObject({ stage: 'demo', owner_id: other.id, next_step: 'Send proposal' });
    const lost = await request(platform).patch(`/platform/sales/leads/${lead.id}`).set(s.auth).send({ stage: 'lost' });
    expect(lost.status).toBe(422);
    expect(lost.body.error.message).toMatch(/lost reason/);
    expect((await request(platform).patch(`/platform/sales/leads/${lead.id}`).set(s.auth).send({ stage: 'lost', lostReason: 'Went with Everflow' })).body.data)
      .toMatchObject({ stage: 'lost', lost_reason: 'Went with Everflow' });
    // Reopened: the reason goes.
    expect((await request(platform).patch(`/platform/sales/leads/${lead.id}`).set(s.auth).send({ stage: 'negotiation' })).body.data)
      .toMatchObject({ stage: 'negotiation', lost_reason: null, lost_at: null });

    expect((await request(platform).post(`/platform/sales/leads/${lead.id}/activities`).set(s.auth).send({ kind: 'call', body: 'Discussed pricing' })).status).toBe(201);
    const detail = (await request(platform).get(`/platform/sales/leads/${lead.id}`).set(s.auth)).body.data;
    const kinds = (detail.activities as { kind: string; meta: Record<string, unknown>; body: string | null }[]).map((a) => `${a.kind}:${a.meta['from'] ?? ''}>${a.meta['to'] ?? ''}`);
    expect(kinds).toEqual(['call:>', 'stage:lost>negotiation', 'stage:demo>lost', `owner:Staff ${s.id.slice(0, 4)}>Staff ${other.id.slice(0, 4)}`, 'stage:new>demo', 'created:>']);

    const csv = await request(platform).get(`/platform/sales/leads.csv?q=${t}&stage=all`).set(s.auth);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\n')[0]).toMatch(/^company,contact_name,email/);
    expect(csv.text).toContain(`Acme ${t},Ann,ann-${t}@acme.test`);
  });

  it('kanban and dashboard — an assigned Sales role sees only its own leads', async () => {
    const owner = await staff(ROLE.owner);
    const role = await request(platform).post('/platform/roles').set(owner.auth).send({
      name: `Sales rep ${tag()}`, scope: 'assigned', home: '/admin/sales', permissions: { sales: 'full', dashboard: 'read' },
    });
    expect(role.status).toBe(201);
    const rep = await staff(role.body.data.id);
    const mk = (body: Record<string, unknown>) => request(platform).post('/platform/sales/leads').set(rep.auth).send({ company: `Rep ${tag()}`, ...body });
    await mk({ stage: 'new', expectedMrr: '100' });
    await mk({ stage: 'qualified', expectedMrr: '200' });
    await mk({ stage: 'negotiation', expectedMrr: '300', currency: 'EUR' });
    const won = (await mk({ stage: 'trial', expectedMrr: '400' })).body.data;
    expect((await request(platform).patch(`/platform/sales/leads/${won.id}`).set(rep.auth).send({ stage: 'won' })).status).toBe(200);
    // Someone else's lead stays out of the rep's view.
    const foreign = (await request(platform).post('/platform/sales/leads').set(owner.auth).send({ company: `Foreign ${tag()}` })).body.data;
    expect((await request(platform).get(`/platform/sales/leads/${foreign.id}`).set(rep.auth)).status).toBe(404);

    const columns = (await request(platform).get('/platform/sales/pipeline').set(rep.auth)).body.data as { stage: string; count: number; leads: unknown[]; mrr: { currency: string; amount: string }[] }[];
    const col = (s: string) => columns.find((c) => c.stage === s)!;
    expect(columns.map((c) => c.stage)).toEqual(['new', 'contacted', 'qualified', 'demo', 'trial', 'negotiation', 'won', 'lost']);
    expect([col('new').count, col('qualified').count, col('negotiation').count, col('won').count, col('trial').count]).toEqual([1, 1, 1, 1, 0]);
    expect(col('negotiation').mrr).toEqual([{ currency: 'EUR', amount: '300.00' }]);

    const sum = (await request(platform).get('/platform/sales/summary').set(rep.auth)).body.data;
    expect(sum.kpis).toMatchObject({ open: 3, new_this_month: 4, won_this_month: 1, won_90d: 1, lost_90d: 0, win_rate_90d: 100 });
    // Forecast: open value × the stage's chance (new 10 %, qualified 40 %, negotiation 80 %) — per currency.
    expect(sum.forecast).toEqual([{ currency: 'EUR', pipeline: '300.00', weighted: '240.00' }, { currency: 'USD', pipeline: '300.00', weighted: '90.00' }]);
    expect(sum.wonThisMonth).toEqual([{ currency: 'USD', amount: '400.00', deals: 1 }]);
    expect(sum.leaderboard).toEqual([expect.objectContaining({ id: rep.id, open: 3, won_this_month: 1, won_mrr_quarter: [{ currency: 'USD', amount: '400.00' }] })]);
    expect(sum.trend).toHaveLength(12);
    expect(sum.trials).toBeNull(); // no networks:read in this role
  });

  it('convert to customer: network, owner login, plan with a trial; the lead stays won', async () => {
    const owner = await staff(ROLE.owner);
    const s = await staff(ROLE.sales);
    const t = tag();
    const plan = await request(platform).post('/platform/plans').set(owner.auth).send({ code: `sales-${t}`, name: `Growth ${t}`, priceCents: 29900, currency: 'USD', billingInterval: 'month', limits: {} });
    expect(plan.status).toBe(201);
    const lead = (await request(platform).post('/platform/sales/leads').set(s.auth).send({ company: `Conv ${t}`, email: `conv-${t}@x.test`, stage: 'trial' })).body.data;

    const taken = await request(platform).post(`/platform/sales/leads/${lead.id}/convert`).set(s.auth).send({ name: `Conv ${t}`, slug: `conv-${t}`, ownerEmail: `taken-${t}@x.test` });
    expect(taken.status).toBe(409);
    expect(taken.body.error.message).toBe(`taken-${t}@x.test already has a login — use a different email for the network's owner.`);

    const conv = await request(platform).post(`/platform/sales/leads/${lead.id}/convert`).set(s.auth).send({
      name: `Conv ${t}`, slug: `conv-${t}`, ownerEmail: `Owner-${t}@x.test`, ownerName: 'Olly', planId: plan.body.data.id, trialDays: 14,
    });
    expect(conv.status, JSON.stringify(conv.body)).toBe(201);
    const out = conv.body.data;
    expect(out.owner.email).toBe(`owner-${t}@x.test`);
    expect(out.owner.temporaryPassword).toMatch(/^[A-Za-z0-9]{5}(-[A-Za-z0-9]{5}){3}$/);
    expect(out.subscription).toMatchObject({ status: 'trialing' });
    expect(out.planError).toBeNull();
    expect(out.lead).toMatchObject({ stage: 'won', network_id: out.network.id, network_slug: `conv-${t}` });
    expect(sb.created.at(-1)).toMatchObject({ email: `owner-${t}@x.test`, app_metadata: { kind: 'admin', network_id: out.network.id, role: 'admin', must_change_password: true } });
    const net = (await query<{ sales_owner_id: string; postback_security_code: string | null }>('SELECT sales_owner_id, postback_security_code FROM networks WHERE id = $1', [out.network.id])).rows[0]!;
    expect(net.sales_owner_id).toBe(s.id);
    expect(net.postback_security_code).toBeTruthy();
    expect((await query('SELECT 1 FROM users WHERE network_id = $1 AND role = $2 AND email = $3', [out.network.id, 'admin', `owner-${t}@x.test`])).rows).toHaveLength(1);

    expect((await request(platform).post(`/platform/sales/leads/${lead.id}/convert`).set(s.auth).send({ name: 'x', slug: `x-${t}`, ownerEmail: `x-${t}@x.test` })).status).toBe(409);
    expect((await request(platform).patch(`/platform/sales/leads/${lead.id}`).set(s.auth).send({ stage: 'lost', lostReason: 'x' })).status).toBe(409);
    expect((await request(platform).delete(`/platform/sales/leads/${lead.id}`).set(s.auth)).status).toBe(409);
    const timeline = (await request(platform).get(`/platform/sales/leads/${lead.id}`).set(s.auth)).body.data.activities as { kind: string; meta: Record<string, unknown> }[];
    expect(timeline[0]).toMatchObject({ kind: 'converted', meta: { networkName: `Conv ${t}`, plan: `Growth ${t}`, trialDays: 14 } });

    // The network's export doesn't carry the platform's sales records about it.
    await request(platform).post('/platform/tasks').set(owner.auth).send({ title: 'Kickoff call', kind: 'sales', networkId: out.network.id });
    const exp = await request(platform).get(`/platform/networks/${out.network.id}/export`).set(owner.auth);
    const header = JSON.parse(exp.text.split('\n')[0]!).export as { tables: string[] };
    expect(header.tables).toContain('users');
    expect(header.tables).not.toContain('sales_leads');
    expect(header.tables).not.toContain('platform_tasks');
  });

  it('request a demo: a routed lead with a follow-up task; a repeat is a note; the honeypot stores nothing', async () => {
    const t = tag();
    const body = { name: 'Dee', email: `demo-${t}@net.test`, company: `Demo Co ${t}`, monthlyClicks: 50000, message: 'We run 40 offers' };
    const r1 = await request(dash).post('/api/signup/demo').send(body);
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r1.body.data.message).toMatch(/our team will contact you/);
    const lead = (await query<{ id: string; owner_id: string | null; source: string; stage: string; message: string }>(
      'SELECT id, owner_id, source, stage, message FROM sales_leads WHERE email = $1', [`demo-${t}@net.test`])).rows;
    expect(lead).toHaveLength(1);
    expect(lead[0]).toMatchObject({ source: 'website', stage: 'new', message: 'We run 40 offers' });
    if (lead[0]!.owner_id) {
      const owner = (await query<{ key: string }>('SELECT r.key FROM platform_admins pa JOIN platform_roles r ON r.id = pa.role_id WHERE pa.id = $1', [lead[0]!.owner_id])).rows[0];
      expect(owner?.key).toBe('sales');
      expect((await query('SELECT 1 FROM platform_tasks WHERE lead_id = $1 AND assignee_id = $2 AND priority = $3', [lead[0]!.id, lead[0]!.owner_id, 'high'])).rows).toHaveLength(1);
    }
    expect((await request(dash).post('/api/signup/demo').send({ ...body, message: 'Following up' })).status).toBe(201);
    expect((await query('SELECT 1 FROM sales_leads WHERE lower(email) = $1', [`demo-${t}@net.test`])).rows).toHaveLength(1);
    expect((await query(`SELECT 1 FROM sales_activities WHERE lead_id = $1 AND kind = 'inbound'`, [lead[0]!.id])).rows).toHaveLength(2);

    const bot = await request(dash).post('/api/signup/demo').send({ ...body, email: `bot-${t}@net.test`, website_url: 'http://spam.test' });
    expect(bot.status).toBe(201);
    expect((await query('SELECT 1 FROM sales_leads WHERE email = $1', [`bot-${t}@net.test`])).rows).toHaveLength(0);
    expect((await request(dash).post('/api/signup/demo').send({ name: 'x', email: 'nope', company: 'x' })).status).toBe(422);
  });

  it('tasks: visibility, changes, and a done lead task on the timeline', async () => {
    const s = await staff(ROLE.sales);
    const fin = await staff(ROLE.finance);
    const sup = await staff(ROLE.support);
    const lead = (await request(platform).post('/platform/sales/leads').set(s.auth).send({ company: `Tasks ${tag()}` })).body.data;
    const task = await request(platform).post('/platform/tasks').set(s.auth).send({ title: 'Send the contract', kind: 'sales', priority: 'high', dueAt: '2020-01-01', leadId: lead.id });
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    expect(task.body.data).toMatchObject({ assignee_id: s.id, lead_company: lead.company, status: 'open' });

    const mine = (await request(platform).get('/platform/tasks?due=overdue').set(s.auth)).body.data as { id: string }[];
    expect(mine.map((x) => x.id)).toContain(task.body.data.id);
    expect((await request(platform).get('/platform/tasks/summary').set(s.auth)).body.data).toMatchObject({ open: 1, overdue: 1 });
    // Finance reads Sales → sees it; Support doesn't.
    expect(((await request(platform).get('/platform/tasks?assignee=all').set(fin.auth)).body.data as { id: string }[]).map((x) => x.id)).toContain(task.body.data.id);
    expect(((await request(platform).get('/platform/tasks?assignee=all').set(sup.auth)).body.data as { id: string }[]).map((x) => x.id)).not.toContain(task.body.data.id);
    expect((await request(platform).patch(`/platform/tasks/${task.body.data.id}`).set(sup.auth).send({ status: 'done' })).status).toBe(404);
    // Finance can see it but not change someone else's Sales task, nor add one.
    expect((await request(platform).patch(`/platform/tasks/${task.body.data.id}`).set(fin.auth).send({ status: 'done' })).status).toBe(403);
    expect((await request(platform).post('/platform/tasks').set(fin.auth).send({ title: 'x', kind: 'sales' })).status).toBe(403);
    // Anyone can keep their own 'other' to-dos.
    expect((await request(platform).post('/platform/tasks').set(sup.auth).send({ title: 'Read the docs' })).status).toBe(201);

    const done = await request(platform).patch(`/platform/tasks/${task.body.data.id}`).set(s.auth).send({ status: 'done' });
    expect(done.body.data).toMatchObject({ status: 'done' });
    expect(done.body.data.completed_at).toBeTruthy();
    const timeline = (await request(platform).get(`/platform/sales/leads/${lead.id}`).set(s.auth)).body.data.activities as { kind: string; body: string }[];
    expect(timeline[0]).toMatchObject({ kind: 'task', body: 'Send the contract' });
  });

  it('roles: Support can’t see Sales; Finance reads it but can’t change it', async () => {
    const sup = await staff(ROLE.support);
    const fin = await staff(ROLE.finance);
    const denied = await request(platform).get('/platform/sales/leads').set(sup.auth);
    expect(denied.status).toBe(403);
    expect(denied.body.error.message).toMatch(/Your role \(Support\) can’t see Sales/);
    expect((await request(platform).get('/platform/sales/summary').set(fin.auth)).status).toBe(200);
    expect((await request(platform).post('/platform/sales/leads').set(fin.auth).send({ company: 'x' })).status).toBe(403);
  });
});
