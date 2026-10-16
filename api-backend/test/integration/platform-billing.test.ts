/**
 * Platform billing (Super Admin) — on a real Postgres (INTEGRATION_DB=1). Time passes by back-dating rows.
 *
 * - Plans: create (monthly / yearly, trial), edit, archive (no new subscriptions) / unarchive.
 * - Assign: no trial → active for a period, invoiced at once (taxed, numbered, due + suspension dates);
 *   a trial → no invoice until it ends; extend a trial; change plan (no new invoice); cancel at period end.
 * - The billing run: trial end → invoiced; period end → renewed + invoiced, once (idempotent); overdue →
 *   past_due; past the suspension date → suspended for billing (403 says so), once per deadline (a
 *   Super Admin's reactivation stands); more time → reactivated; paid → active again. A manual suspension
 *   is never lifted by a payment. Free plans aren't invoiced.
 * - Invoices: one-off, list filters + per-currency summary, void, mark paid (amount defaults to the total).
 * - Tenants: staff see their plan, invoices and how to pay; partners never; only their own invoice prints.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildPlatformAdminApp } from '../../src/surfaces/platform-admin/app.js';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { signPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { hashPassword } from '../../src/lib/auth/platform-admin-password.js';
import { runBilling } from '../../src/lib/billing/engine.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { bearer, operatorToken, portalToken } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

interface Inv { id: string; number: string; status: string; subtotal: string; tax: string; total: string; due_at: string; suspend_at: string; overdue: boolean; currency: string }

d('platform billing (live DB)', () => {
  let platform: Express;
  let dash: Express;
  let fx: Fixture;
  let pa: Record<string, string>;
  let staffA: Record<string, string>;
  const code = () => `p-${randomUUID().slice(0, 8)}`;
  const createPlan = async (b: Record<string, unknown>) => {
    const r = await request(platform).post('/platform/plans').set(pa).send({ code: code(), name: `Plan ${randomUUID().slice(0, 4)}`, priceCents: 9900, ...b });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.data as { id: string; code: string; name: string };
  };
  const invoicesOf = async (networkId: string) =>
    (await query<Inv>(`SELECT *, (status = 'open' AND due_at <= now()) AS overdue FROM platform_invoices WHERE network_id = $1 ORDER BY issued_at, number`, [networkId])).rows;
  const subOf = async (networkId: string) => (await query<{ status: string; trial_ends_at: Date | null; current_period_start: Date; current_period_end: Date; cancel_at_period_end: boolean }>(
    'SELECT * FROM subscriptions WHERE network_id = $1', [networkId])).rows[0];
  const netOf = async (id: string) => (await query<{ status: string; suspended_reason: string | null }>('SELECT status, suspended_reason FROM networks WHERE id = $1', [id])).rows[0];
  const freshNetwork = async () => (await seedFixture(`bill-${randomUUID().slice(0, 8)}`)).networkA;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`billing-${randomUUID().slice(0, 8)}`);
    const adminId = randomUUID();
    await query(`INSERT INTO platform_admins (id, email, status, auth_provider, password_hash) VALUES ($1, $2, 'active', 'local', $3)`,
      [adminId, `pa-${adminId.slice(0, 8)}@test.local`, await hashPassword(`pw-${adminId}`)]);
    pa = bearer(await signPlatformAdminToken(adminId));
    staffA = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
    platform = buildPlatformAdminApp();
    dash = buildDashboardApp();
    const s = await request(platform).put('/platform/settings/billing').set(pa).send({
      invoicePrefix: 'TRK', dueDays: 3, graceDays: 2, taxRate: '18', autoSuspend: true,
      seller: { name: 'Tracker Ltd', address: '1 Main St', taxId: 'GST123', email: 'billing@tracker.test' },
      paymentInstructions: 'Bank transfer to ACME Bank 0001, reference = invoice number.',
    });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
  });
  afterAll(async () => { await query(`DELETE FROM platform_settings WHERE key = 'billing'`); });

  it('plans: create, edit, archive (no new subscriptions on it) and unarchive', async () => {
    const p = await createPlan({ billingInterval: 'year', trialDays: 14, description: 'For growing networks', limits: { clicks: 1000 } });
    expect(p).toMatchObject({ billing_interval: 'year', trial_days: 14, subscribers: 0 });
    const edited = await request(platform).patch(`/platform/plans/${p.id}`).set(pa).send({ priceCents: 12000, trialDays: 0 });
    expect(edited.body.data).toMatchObject({ price_cents: 12000, trial_days: 0, code: p.code });
    expect((await request(platform).patch(`/platform/plans/${p.id}`).set(pa).send({ code: 'x' })).status).toBe(422); // the code is fixed
    expect((await request(platform).post(`/platform/plans/${p.id}/archive`).set(pa)).body.data.status).toBe('archived');
    expect((await request(platform).get('/platform/plans').set(pa)).body.data.map((x: { id: string }) => x.id)).not.toContain(p.id);
    expect((await request(platform).get('/platform/plans?status=all').set(pa)).body.data.map((x: { id: string }) => x.id)).toContain(p.id);
    const refused = await request(platform).put(`/platform/networks/${await freshNetwork()}/subscription`).set(pa).send({ planId: p.id });
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toMatch(/archived/);
    expect((await request(platform).post(`/platform/plans/${p.id}/unarchive`).set(pa)).body.data.status).toBe('active');
    expect((await request(platform).post('/platform/plans').set(pa).send({ code: p.code, name: 'dup', priceCents: 1 })).status).toBe(400);
  });

  it('assign without a trial: active for a month, invoiced at once — numbered, taxed, due and suspension dates', async () => {
    const p = await createPlan({ priceCents: 9900, currency: 'usd' });
    const r = await request(platform).put(`/platform/networks/${fx.networkA}/subscription`).set(pa).send({ planId: p.id, trialDays: 0 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.subscription.status).toBe('active');
    const inv = r.body.data.invoice as Inv;
    expect(inv.number).toMatch(/^TRK-\d{4}-\d{5}$/);
    expect(inv).toMatchObject({ status: 'open', currency: 'USD', subtotal: '99.00', tax: '17.82', total: '116.82', overdue: false });
    const issued = new Date((inv as unknown as { issued_at: string }).issued_at).getTime();
    expect(new Date(inv.due_at).getTime() - issued).toBe(3 * 86_400_000);
    expect(new Date(inv.suspend_at).getTime() - new Date(inv.due_at).getTime()).toBe(2 * 86_400_000);
    const sub = await subOf(fx.networkA);
    expect(new Date(sub!.current_period_end).getUTCMonth()).toBe((new Date(sub!.current_period_start).getUTCMonth() + 1) % 12);
    // Changing the plan of a live subscription: now, without a new invoice.
    const p2 = await createPlan({ priceCents: 19900 });
    const changed = await request(platform).put(`/platform/networks/${fx.networkA}/subscription`).set(pa).send({ planId: p2.id });
    expect(changed.body.data).toMatchObject({ changed: true, invoice: null });
    expect(await invoicesOf(fx.networkA)).toHaveLength(1);
  });

  it('the billing run: renewal invoiced once; overdue → past_due; past the deadline → suspended (once); more time → back; paid → active', async () => {
    const net = await freshNetwork();
    const p = await createPlan({ priceCents: 5000 });
    await request(platform).put(`/platform/networks/${net}/subscription`).set(pa).send({ planId: p.id, trialDays: 0 });
    const [first] = await invoicesOf(net);
    await request(platform).post(`/platform/invoices/${first!.id}/mark-paid`).set(pa).send({ method: 'bank_transfer', reference: 'UTR-1' });

    // The period ends → renewed and invoiced; a second run doesn't bill it again.
    await query(`UPDATE subscriptions SET current_period_start = now() - interval '1 month' - interval '1 hour', current_period_end = now() - interval '1 hour' WHERE network_id = $1`, [net]);
    await runBilling();
    await runBilling();
    const afterRenewal = await invoicesOf(net);
    expect(afterRenewal.map((i) => i.status)).toEqual(['paid', 'open']);
    expect(new Date((await subOf(net))!.current_period_end).getTime()).toBeGreaterThan(Date.now());
    const renewal = afterRenewal[1]!;

    // Overdue → past_due (flagged), the network still active; staff see it in /api/me.
    await query(`UPDATE platform_invoices SET due_at = now() - interval '1 hour', suspend_at = now() + interval '1 day' WHERE id = $1`, [renewal.id]);
    await runBilling();
    expect((await subOf(net))!.status).toBe('past_due');
    expect((await netOf(net))!.status).toBe('active');
    const staff = bearer(operatorToken({ userId: randomUUID(), networkId: net, role: 'admin' }));
    expect((await request(dash).get('/api/me').set(staff)).body.data.billing.overdue).toMatchObject({ number: renewal.number });

    // Past the suspension date → suspended for billing; the dashboard says why.
    await query(`UPDATE platform_invoices SET suspend_at = now() - interval '1 minute' WHERE id = $1`, [renewal.id]);
    await runBilling();
    expect(await netOf(net)).toEqual({ status: 'suspended', suspended_reason: 'billing' });
    const refused = await request(dash).get('/api/offers').set(staff);
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toMatch(/suspended for an unpaid invoice/);

    // A Super Admin reactivates by hand → the next run doesn't overrule them (once per deadline).
    await request(platform).patch(`/platform/networks/${net}`).set(pa).send({ status: 'active' });
    await runBilling();
    expect((await netOf(net))!.status).toBe('active');
    // …suspended again by hand isn't billing's: it stays even when the invoice is paid.
    await request(platform).patch(`/platform/networks/${net}`).set(pa).send({ status: 'suspended' });
    expect((await netOf(net))!.suspended_reason).toBe('manual');
    const paidWhileManual = await request(platform).post(`/platform/invoices/${renewal.id}/mark-paid`).set(pa).send({ method: 'upi', paidAt: new Date().toISOString().slice(0, 10) });
    expect(paidWhileManual.body.data).toMatchObject({ subscriptionActive: true, networkReactivated: false });
    expect(paidWhileManual.body.data.invoice).toMatchObject({ status: 'paid', paid_amount: renewal.total, payment_method: 'upi' });
    expect((await netOf(net))!.status).toBe('suspended');
  });

  it('more time lifts a billing suspension; paying it settles the subscription', async () => {
    const net = await freshNetwork();
    const p = await createPlan({ priceCents: 1000 });
    const inv = (await request(platform).put(`/platform/networks/${net}/subscription`).set(pa).send({ planId: p.id, trialDays: 0 })).body.data.invoice as Inv;
    await query(`UPDATE platform_invoices SET due_at = now() - interval '2 days', suspend_at = now() - interval '1 hour' WHERE id = $1`, [inv.id]);
    await runBilling();
    expect(await netOf(net)).toEqual({ status: 'suspended', suspended_reason: 'billing' });
    expect((await request(platform).post(`/platform/invoices/${inv.id}/extend`).set(pa).send({ suspendAt: '2001-01-01' })).status).toBe(400);
    const more = await request(platform).post(`/platform/invoices/${inv.id}/extend`).set(pa).send({ days: 7 });
    expect(more.status, JSON.stringify(more.body)).toBe(200);
    expect(more.body.data).toMatchObject({ networkReactivated: true, subscriptionActive: false });
    expect(new Date(more.body.data.invoice.suspend_at).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(await netOf(net)).toEqual({ status: 'active', suspended_reason: null });
    await runBilling();
    expect((await netOf(net))!.status).toBe('active'); // the new deadline is a week away
    expect((await subOf(net))!.status).toBe('past_due'); // still overdue — flagged
    const paid = await request(platform).post(`/platform/invoices/${inv.id}/mark-paid`).set(pa).send({ method: 'bank_transfer', amount: '11.80' });
    expect(paid.body.data).toMatchObject({ subscriptionActive: true });
    expect((await request(platform).post(`/platform/invoices/${inv.id}/mark-paid`).set(pa).send({ method: 'cash' })).status).toBe(409);
  });

  it('trials: no invoice until the trial ends; extend; then invoiced. Cancel at period end ends it without an invoice. Free plans are free', async () => {
    const net = await freshNetwork();
    const p = await createPlan({ priceCents: 2500, trialDays: 14 });
    const started = await request(platform).put(`/platform/networks/${net}/subscription`).set(pa).send({ planId: p.id });
    expect(started.body.data).toMatchObject({ invoice: null, subscription: { status: 'trialing' } });
    const before = new Date((await subOf(net))!.trial_ends_at!).getTime();
    await request(platform).post(`/platform/networks/${net}/subscription/extend-trial`).set(pa).send({ days: 7 });
    expect(new Date((await subOf(net))!.trial_ends_at!).getTime() - before).toBe(7 * 86_400_000);
    await query(`UPDATE subscriptions SET trial_ends_at = now() - interval '1 minute', current_period_end = now() - interval '1 minute' WHERE network_id = $1`, [net]);
    await runBilling();
    expect((await subOf(net))!.status).toBe('active');
    expect((await invoicesOf(net)).map((i) => i.total)).toEqual(['29.50']);

    await request(platform).post(`/platform/networks/${net}/subscription/cancel`).set(pa).send({ atPeriodEnd: true });
    expect((await subOf(net))!.cancel_at_period_end).toBe(true);
    await query(`UPDATE subscriptions SET current_period_end = now() - interval '1 minute' WHERE network_id = $1`, [net]);
    await runBilling();
    expect((await subOf(net))!.status).toBe('canceled');
    expect(await invoicesOf(net)).toHaveLength(1);

    const free = await freshNetwork();
    const fp = await createPlan({ priceCents: 0 });
    await request(platform).put(`/platform/networks/${free}/subscription`).set(pa).send({ planId: fp.id, trialDays: 0 });
    await query(`UPDATE subscriptions SET current_period_end = now() - interval '1 minute' WHERE network_id = $1`, [free]);
    await runBilling();
    expect(await invoicesOf(free)).toEqual([]);
  });

  it('invoices: one-off, filters, per-currency summary, void', async () => {
    const net = await freshNetwork();
    const oneOff = await request(platform).post(`/platform/networks/${net}/invoices`).set(pa).send({ description: 'Setup fee', amount: '250', currency: 'eur', dueDays: 0 });
    expect(oneOff.status, JSON.stringify(oneOff.body)).toBe(201);
    expect(oneOff.body.data).toMatchObject({ currency: 'EUR', subtotal: '250.00', tax: '45.00', total: '295.00' });
    expect((await request(platform).post(`/platform/networks/${net}/invoices`).set(pa).send({ description: 'x', amount: '1.234' })).status).toBe(422);
    const overdue = await request(platform).get(`/platform/invoices?status=overdue&networkId=${net}`).set(pa);
    expect(overdue.body.data.map((i: Inv) => i.number)).toEqual([oneOff.body.data.number]);
    const byNumber = await request(platform).get(`/platform/invoices?q=${oneOff.body.data.number}`).set(pa);
    expect(byNumber.body.data).toHaveLength(1);
    const summary = await request(platform).get(`/platform/invoices-summary?networkId=${net}`).set(pa);
    expect(summary.body.data).toEqual([expect.objectContaining({ currency: 'EUR', open_count: 1, open_total: '295.00', overdue_count: 1 })]);
    const voided = await request(platform).post(`/platform/invoices/${oneOff.body.data.id}/void`).set(pa).send({ reason: 'Waived' });
    expect(voided.body.data.invoice).toMatchObject({ status: 'void', void_reason: 'Waived' });
    const view = await request(platform).get(`/platform/invoices/${oneOff.body.data.id}`).set(pa);
    expect(view.body.data).toMatchObject({ seller: { name: 'Tracker Ltd' }, paymentInstructions: expect.stringContaining('ACME Bank') });
  });

  it('tenants: staff see their plan, invoices and how to pay — partners never; only their own invoice prints', async () => {
    const mine = await request(dash).get('/api/subscription').set(staffA);
    expect(mine.status).toBe(200);
    expect(mine.body.data.subscription).toMatchObject({ billing_interval: 'month' });
    expect(mine.body.data.invoices.length).toBeGreaterThan(0);
    expect(mine.body.data.billing.paymentInstructions).toMatch(/ACME Bank/);
    const inv = mine.body.data.invoices[0] as Inv;
    const printed = await request(dash).get(`/api/subscription/invoices/${inv.id}`).set(staffA);
    expect(printed.status).toBe(200);
    expect(printed.body.data.invoice).not.toHaveProperty('created_by');
    const otherStaff = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkB, role: 'admin' }));
    expect((await request(dash).get(`/api/subscription/invoices/${inv.id}`).set(otherStaff)).status).toBe(404);
    const partner = bearer(portalToken({ userId: randomUUID(), networkId: fx.networkA, kind: 'publisher', ownerId: fx.pubA1 }));
    expect((await request(dash).get('/api/subscription').set(partner)).status).toBe(403);
  });
});
