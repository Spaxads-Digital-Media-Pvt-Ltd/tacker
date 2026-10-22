/**
 * Super Admin › Sales round 2 — live DB (INTEGRATION_DB=1); the SMTP faked, the email queue in-process.
 *
 * - Quote totals in integer cents (half-up); quotas vs what was won; commission = % of what the networks a
 *   salesperson sold paid, only inside the plan's window; who may see / set what.
 * - Quotes: draft → send (needs SMTP and an address) → the prospect's private page (viewed) → accept once
 *   (name needed) → timeline + the owner's bell; only drafts change / delete; duplicate; expired.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

const mail = vi.hoisted(() => ({ configured: true, sent: [] as { to: string[]; subject: string; html: string }[] }));
vi.mock('../../src/lib/mailer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/mailer.js')>();
  return {
    ...actual,
    platformSmtpConfigError: async () => (mail.configured ? null : 'The platform email isn’t set up'),
    sendPlatformEmail: async (to: string[], subject: string, html: string) => {
      mail.sent.push({ to, subject, html });
      return { sent: to.length, results: to.map((recipient) => ({ recipient, ok: true })) };
    },
  };
});
vi.mock('../../src/lib/queues.js', async (io) => (await import('../helpers/inline-email-queue.js')).inlineEmailQueue(io));

import { buildPlatformAdminApp } from '../../src/surfaces/platform-admin/app.js';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { signPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { quoteTotals } from '../../src/lib/platform/quotes.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const OWNER = '00000000-0000-4000-a000-000000000001';
const SALES = '00000000-0000-4000-a000-000000000003';
const month = new Date().toISOString().slice(0, 7);

d('Super Admin › Sales — quotas, commissions, quotes (live DB)', () => {
  let platform: Express;
  let dash: Express;
  let fx: Fixture;
  let owner: Record<string, string>;
  const T = randomUUID().slice(0, 8);
  const member = async (role: string) => {
    const id = randomUUID();
    const email = `sc-${id.slice(0, 8)}@test.local`;
    await query(`INSERT INTO platform_admins (id, email, status, auth_provider, password_hash, role_id) VALUES ($1, $2, 'active', 'local', 'x', $3)`, [id, email, role]);
    return { id, email, auth: bearer(await signPlatformAdminToken(id)) };
  };
  const lead = async (ownerId: string, extra: { stage?: string; mrr?: string; wonAt?: string; networkId?: string; email?: string } = {}) => (await query<{ id: string }>(
    `INSERT INTO sales_leads (company, email, owner_id, stage, expected_mrr, currency, won_at, network_id, contact_name)
     VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7, 'Pat') RETURNING id`,
    [`Co ${randomUUID().slice(0, 6)}`, extra.email ?? null, ownerId, extra.stage ?? 'qualified', extra.mrr ?? null, extra.wonAt ?? null, extra.networkId ?? null])).rows[0]!.id;
  const network = async (salesOwner: string) => (await query<{ id: string }>(
    `INSERT INTO networks (name, slug, postback_security_code, sales_owner_id) VALUES ($1, $2, 'x', $3) RETURNING id`,
    [`Net ${T}`, `sc-${randomUUID().slice(0, 8)}`, salesOwner])).rows[0]!.id;
  const invoice = (networkId: string, amount: string, paidAt = new Date().toISOString()) => query(
    `INSERT INTO platform_invoices (number, network_id, description, currency, subtotal, total, status, due_at, suspend_at, paid_at, paid_amount, bill_to)
     VALUES ($1, $2, 'Plan', 'USD', $3, $3, 'paid', now(), now(), $4, $3, '{}')`, [`INV-${randomUUID().slice(0, 8)}`, networkId, amount, paidAt]);
  const draft = { title: 'Growth plan', currency: 'usd', lines: [{ description: 'Growth plan', quantity: 2, unitPrice: '499.99' }, { description: 'Onboarding', quantity: 1, unitPrice: '100' }], discountPct: '10', taxRate: '18', billingInterval: 'month', validUntil: '2099-12-31', notes: 'Thanks!' };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`sc-${T}`);
    void fx;
    platform = buildPlatformAdminApp();
    dash = buildDashboardApp();
    owner = (await member(OWNER)).auth;
  });

  it('quote totals: integer cents, half-up', () => {
    expect(quoteTotals({ lines: draft.lines, discountPct: '10', taxRate: '18' })).toMatchObject({
      subtotal: '1099.98', discount: '110.00', tax: '178.20', total: '1168.18',
      lines: [{ amount: '999.98', unitPrice: '499.99' }, { amount: '100.00', unitPrice: '100.00' }],
    });
    expect(quoteTotals({ lines: [{ description: 'x', quantity: 1, unitPrice: '0.05' }], discountPct: '10', taxRate: '0' }).discount).toBe('0.01'); // 0.005 → 0.01
    expect(quoteTotals({ lines: [{ description: 'x', quantity: 1_000_000, unitPrice: '9999999999.99' }], discountPct: '0', taxRate: '0' }).total).toBe('9999999999990000.00');
  });

  it('quotas: a month’s target vs new MRR won; sales sees only itself and can’t set quotas', async () => {
    const rep = await member(SALES);
    await lead(rep.id, { stage: 'won', mrr: '400.00', wonAt: new Date().toISOString() });
    await lead(rep.id, { stage: 'won', mrr: '999.00', wonAt: '2020-01-15T00:00:00Z' }); // another month
    expect((await request(platform).put('/platform/sales/quotas').set(rep.auth).send({ adminId: rep.id, month, currency: 'USD', target: '1000' })).status).toBe(403);
    const put = await request(platform).put('/platform/sales/quotas').set(owner).send({ adminId: rep.id, month, currency: 'usd', target: '1000' });
    expect(put.status).toBe(200);
    expect(put.body.data).toMatchObject({ quota: [{ currency: 'USD', target: '1000.00' }], won: [{ currency: 'USD', amount: '400.00', deals: 1 }] });
    const mine = (await request(platform).get('/platform/sales/team').set(rep.auth)).body.data;
    expect(mine.members.map((m: { id: string }) => m.id)).toEqual([rep.id]);
    expect(mine.canManage).toBe(false);
    const all = (await request(platform).get(`/platform/sales/team?month=${month}`).set(owner)).body.data;
    expect(all.members.some((m: { id: string }) => m.id === rep.id)).toBe(true);
    expect((await request(platform).get('/platform/sales/summary').set(rep.auth)).body.data.myQuota).toEqual([{ currency: 'USD', target: '1000.00', won: '400.00' }]);
    await request(platform).put('/platform/sales/quotas').set(owner).send({ adminId: rep.id, month, currency: 'USD', target: null }).expect(200);
    expect((await request(platform).get('/platform/sales/summary').set(rep.auth)).body.data.myQuota).toEqual([]);
  });

  it('commissions: % of what their networks paid, inside the window; own statement only', async () => {
    const rep = await member(SALES);
    const other = await member(SALES);
    const fresh = await network(rep.id);
    await lead(rep.id, { stage: 'won', networkId: fresh, wonAt: new Date(Date.now() - 30 * 864e5).toISOString() });
    const old = await network(rep.id);
    await lead(rep.id, { stage: 'won', networkId: old, wonAt: new Date(Date.now() - 400 * 864e5).toISOString() }); // > 12 months ago
    await invoice(fresh, '1000.00');
    await invoice(fresh, '250.55');
    await invoice(old, '5000.00'); // outside the 12-month window → no commission
    expect((await request(platform).put(`/platform/sales/comp-plans/${rep.id}`).set(rep.auth).send({ commissionPct: '10', commissionMonths: 12 })).status).toBe(403);
    await request(platform).put(`/platform/sales/comp-plans/${rep.id}`).set(owner).send({ commissionPct: '10', commissionMonths: 12 }).expect(200);
    const st = (await request(platform).get(`/platform/sales/commissions/${rep.id}`).set(rep.auth)).body.data;
    expect(st.comp).toEqual({ commissionPct: '10.00', commissionMonths: 12 });
    expect(st.statement).toEqual([{ month, currency: 'USD', paid: '1250.55', invoices: 2, commission: '125.06' }]);
    expect((await request(platform).get(`/platform/sales/commissions/${rep.id}/${month}`).set(rep.auth)).body.data.map((i: { commission: string }) => i.commission).sort()).toEqual(['100.00', '25.06']);
    expect((await request(platform).get(`/platform/sales/commissions/${rep.id}`).set(other.auth)).status).toBe(403);
    // No window → every paid invoice counts.
    await request(platform).put(`/platform/sales/comp-plans/${rep.id}`).set(owner).send({ commissionPct: '10', commissionMonths: null }).expect(200);
    expect((await request(platform).get(`/platform/sales/commissions/${rep.id}`).set(owner)).body.data.statement[0]).toMatchObject({ paid: '6250.55', commission: '625.06' });
    const team = (await request(platform).get('/platform/sales/team').set(owner)).body.data.members.find((m: { id: string }) => m.id === rep.id);
    expect(team.commission).toEqual([{ currency: 'USD', paid: '6250.55', amount: '625.06' }]);
  });

  it('quotes: draft → send → the prospect accepts on the private page, once; the owner is told', async () => {
    const rep = await member(SALES);
    const leadId = await lead(rep.id, { email: 'buyer@prospect.test' });
    const created = await request(platform).post(`/platform/sales/leads/${leadId}/quotes`).set(rep.auth).send(draft);
    expect(created.status).toBe(201);
    const q = created.body.data;
    expect(q).toMatchObject({ status: 'draft', currency: 'USD', subtotal: '1099.98', total: '1168.18', link: null });
    expect(Number(q.number)).toBeGreaterThanOrEqual(1001);
    expect((await request(platform).post(`/platform/sales/leads/${leadId}/quotes`).set(rep.auth).send({ ...draft, lines: [] })).status).toBe(422);
    const edited = await request(platform).patch(`/platform/sales/quotes/${q.id}`).set(rep.auth).send({ ...draft, discountPct: '0', taxRate: '0' });
    expect(edited.body.data.total).toBe('1099.98');
    // A draft isn't public.
    expect((await request(dash).get(`/api/public/quotes/${q.public_token}`)).status).toBe(404);
    mail.configured = false;
    const noSmtp = await request(platform).post(`/platform/sales/quotes/${q.id}/send`).set(rep.auth).send({});
    expect([noSmtp.status, noSmtp.body.error.details.reason]).toEqual([409, 'smtp_not_configured']);
    mail.configured = true;
    mail.sent.length = 0;
    const sent = await request(platform).post(`/platform/sales/quotes/${q.id}/send`).set(rep.auth).send({ message: 'As discussed' });
    expect(sent.status).toBe(200);
    expect(sent.body.data).toMatchObject({ status: 'sent', sent_to: 'buyer@prospect.test' });
    expect(sent.body.data.link).toContain(`/quote/${q.public_token}`);
    expect(mail.sent.at(-1)!.to).toEqual(['buyer@prospect.test']);
    expect(mail.sent.at(-1)!.html).toContain(`/quote/${q.public_token}`);
    // Only drafts change.
    expect((await request(platform).patch(`/platform/sales/quotes/${q.id}`).set(rep.auth).send(draft)).status).toBe(409);
    expect((await request(platform).delete(`/platform/sales/quotes/${q.id}`).set(rep.auth)).status).toBe(409);
    // The prospect's page: no internal ids, marked viewed.
    const page = await request(dash).get(`/api/public/quotes/${q.public_token}`);
    expect(page.status).toBe(200);
    expect(page.body.data).toMatchObject({ number: q.number, status: 'sent', total: '1099.98', contactName: 'Pat', preparedBy: { email: rep.email } });
    expect(JSON.stringify(page.body.data)).not.toContain(q.public_token);
    expect((await request(platform).get(`/platform/sales/quotes/${q.id}`).set(rep.auth)).body.data.viewed_at).not.toBeNull();
    expect((await request(dash).post(`/api/public/quotes/${q.public_token}/respond`).send({ decision: 'accept' })).status).toBe(422);
    const ok = await request(dash).post(`/api/public/quotes/${q.public_token}/respond`).send({ decision: 'accept', name: 'Pat Buyer' });
    expect(ok.body.data).toMatchObject({ status: 'accepted', responderName: 'Pat Buyer' });
    const again = await request(dash).post(`/api/public/quotes/${q.public_token}/respond`).send({ decision: 'decline' });
    expect([again.status, again.body.error.details.reason]).toEqual([409, 'already_answered']);
    const timeline = (await request(platform).get(`/platform/sales/leads/${leadId}`).set(rep.auth)).body.data.activities;
    expect(timeline.filter((a: { kind: string }) => a.kind === 'quote').map((a: { meta: { event: string } }) => a.meta.event)).toEqual(['accepted', 'sent']);
    const bell = (await request(platform).get('/platform/notifications').set(rep.auth)).body.data;
    expect(bell.items[0]).toMatchObject({ kind: 'quote', link: `/admin/sales/leads/${leadId}` });
    expect(bell.items[0].title).toContain(`accepted quote Q-${q.number}`);
    expect((await request(dash).get('/api/public/quotes/not-a-real-token-at-all-xx')).status).toBe(404);
  });

  it('quotes: duplicate a sent one; an expired one can’t be answered or sent; staff mark one declined; scope', async () => {
    const rep = await member(SALES);
    const leadId = await lead(rep.id, { email: 'b@prospect.test' });
    const q = (await request(platform).post(`/platform/sales/leads/${leadId}/quotes`).set(rep.auth).send(draft)).body.data;
    await request(platform).post(`/platform/sales/quotes/${q.id}/send`).set(rep.auth).send({}).expect(200);
    await query(`UPDATE sales_quotes SET valid_until = (now() AT TIME ZONE 'UTC')::date - 1 WHERE id = $1`, [q.id]);
    expect((await request(dash).get(`/api/public/quotes/${q.public_token}`)).body.data.status).toBe('expired');
    const late = await request(dash).post(`/api/public/quotes/${q.public_token}/respond`).send({ decision: 'accept', name: 'X' });
    expect([late.status, late.body.error.details.reason]).toEqual([409, 'expired']);
    expect((await request(platform).post(`/platform/sales/quotes/${q.id}/send`).set(rep.auth).send({})).status).toBe(409);
    expect((await request(platform).get(`/platform/sales/quotes?status=expired&leadId=${leadId}`).set(rep.auth)).body.data.map((x: { id: string }) => x.id)).toEqual([q.id]);
    const copy = (await request(platform).post(`/platform/sales/quotes/${q.id}/duplicate`).set(rep.auth)).body.data;
    expect(copy).toMatchObject({ status: 'draft', total: q.total });
    expect(copy.public_token).not.toBe(q.public_token);
    expect(copy.valid_until >= new Date().toISOString().slice(0, 10)).toBe(true);
    await request(platform).post(`/platform/sales/quotes/${copy.id}/send`).set(rep.auth).send({ to: 'other@prospect.test' }).expect(200);
    const marked = await request(platform).post(`/platform/sales/quotes/${copy.id}/mark`).set(rep.auth).send({ decision: 'declined', reason: 'Too pricey' });
    expect(marked.body.data).toMatchObject({ status: 'declined', decline_reason: 'Too pricey' });
    expect((await request(platform).delete(`/platform/sales/quotes/${(await request(platform).post(`/platform/sales/leads/${leadId}/quotes`).set(rep.auth).send(draft)).body.data.id}`).set(rep.auth)).status).toBe(200);
    // An 'assigned' sales role sees only its own leads' quotes.
    const assigned = (await query<{ id: string }>(
      `INSERT INTO platform_roles (key, name, scope, home, is_system, permissions)
       SELECT $1, 'Assigned sales', 'assigned', home, false, permissions FROM platform_roles WHERE id = $2 RETURNING id`, [`sc_${T}`, SALES])).rows[0]!.id;
    const stranger = await member(assigned);
    expect((await request(platform).get(`/platform/sales/quotes/${q.id}`).set(stranger.auth)).status).toBe(404);
    expect((await request(platform).get(`/platform/sales/quotes?leadId=${leadId}`).set(stranger.auth)).body.data).toEqual([]);
    expect((await request(platform).get(`/platform/sales/quotes/${q.id}`).set(rep.auth)).status).toBe(200);
  });
});
