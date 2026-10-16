/**
 * Super Admin › Money — on a real Postgres (INTEGRATION_DB=1).
 *
 * - A renewal invoice's lines: the plan, overage for the period that ended (blocks over the limit × price),
 *   the coupon's discount; a repeating coupon counts down and ends.
 * - Coupons: codes are unique (any case); expired / used up / archived / another currency → refused.
 * - Credit notes: only on a paid invoice, never more than what's left of it; numbered CN-…; refunds count
 *   against cash collected.
 * - MRR snapshots: new → expansion → contraction (a coupon) → churn → reactivation, one movement each day.
 * - The revenue summary for an 'assigned' role (exact numbers: only its networks).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildPlatformAdminApp } from '../../src/surfaces/platform-admin/app.js';
import { query } from '../../src/lib/db/pool.js';
import { signPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { hashPassword } from '../../src/lib/auth/platform-admin-password.js';
import { runBilling } from '../../src/lib/billing/engine.js';
import { snapshotMrr } from '../../src/lib/billing/revenue.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const OWNER = '00000000-0000-4000-a000-000000000001';
const FUTURE = '2100-01-01';
const t8 = () => randomUUID().slice(0, 8);

d('Super Admin › Money (live DB)', () => {
  let platform: Express;
  let fx: Fixture;
  let owner: { id: string; auth: Record<string, string> };
  const staff = async (roleId: string) => {
    const id = randomUUID();
    await query(`INSERT INTO platform_admins (id, email, status, auth_provider, password_hash, role_id) VALUES ($1, $2, 'active', 'local', $3, $4)`,
      [id, `rv-${id.slice(0, 8)}@test.local`, await hashPassword(`pw-${id}`), roleId]);
    return { id, auth: bearer(await signPlatformAdminToken(id)) };
  };
  const plan = async (priceCents: number, extra: Record<string, unknown> = {}) => (await request(platform).post('/platform/plans').set(owner.auth)
    .send({ code: `rv-${t8()}`, name: `Plan ${priceCents}`, priceCents, currency: 'USD', billingInterval: 'month', ...extra })).body.data as { id: string };
  const coupon = async (body: Record<string, unknown>) => request(platform).post('/platform/coupons').set(owner.auth).send({ code: `C${t8()}`, name: 'Promo', ...body });

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`rev-${t8()}`);
    platform = buildPlatformAdminApp();
    owner = await staff(OWNER);
    await query(`DELETE FROM platform_mrr_movements WHERE day >= $1::date - 1`, [FUTURE]);
    await query(`DELETE FROM platform_mrr_snapshots WHERE day >= $1::date - 1`, [FUTURE]);
    await query(`DELETE FROM platform_mrr_days WHERE day >= $1::date - 1`, [FUTURE]);
  });
  afterAll(async () => {
    await query(`DELETE FROM platform_mrr_movements WHERE day >= $1::date - 1`, [FUTURE]);
    await query(`DELETE FROM platform_mrr_snapshots WHERE day >= $1::date - 1`, [FUTURE]);
    await query(`DELETE FROM platform_mrr_days WHERE day >= $1::date - 1`, [FUTURE]);
  });

  it('renewal: plan + overage + discount lines; a repeating coupon counts down and ends', async () => {
    const p = await plan(10000, { limits: { clicks: 1000 }, overage: { clicks: { per: 100, price: '2.00' } } });
    expect((await request(platform).put(`/platform/networks/${fx.networkA}/subscription`).set(owner.auth).send({ planId: p.id, trialDays: 0 })).status).toBe(200);
    const c = await coupon({ kind: 'percent', percentOff: '20', duration: 'repeating', durationCycles: 2 });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect((await request(platform).post(`/platform/networks/${fx.networkA}/discount`).set(owner.auth).send({ code: c.body.data.code.toLowerCase() })).status).toBe(201);
    // The period that just ended: 1,250 clicks against a 1,000 limit → 250 over → 3 blocks of 100 at 2.00.
    await query(`UPDATE subscriptions SET current_period_start = now() - interval '31 days', current_period_end = now() - interval '1 day' WHERE network_id = $1`, [fx.networkA]);
    await query(`INSERT INTO usage_records (network_id, metric, value, period_date) VALUES ($1, 'clicks', 1250, (now() - interval '10 days')::date)
                 ON CONFLICT (network_id, metric, period_date) DO UPDATE SET value = 1250`, [fx.networkA]);
    await runBilling();
    const inv = (await query<{ id: string; subtotal: string }>(
      `SELECT id, subtotal::text FROM platform_invoices WHERE network_id = $1 AND created_by = 'system' ORDER BY issued_at DESC LIMIT 1`, [fx.networkA])).rows[0]!;
    const detail = (await request(platform).get(`/platform/invoices/${inv.id}`).set(owner.auth)).body.data;
    expect(detail.lines.map((l: { kind: string; amount: string }) => [l.kind, l.amount])).toEqual([['plan', '100.00'], ['overage', '6.00'], ['discount', '-20.00']]);
    expect(detail.lines[1].description).toBe("Clicks over the plan's 1,000 · 1,250 used · 3 × 100 at USD 2.00");
    expect(detail.lines[1]).toMatchObject({ quantity: '3', unit_amount: '2' });
    expect(inv.subtotal).toBe('86.00');
    expect((await query<{ cycles_left: number; ended_at: Date | null }>('SELECT cycles_left, ended_at FROM subscription_discounts WHERE network_id = $1 ORDER BY applied_at DESC LIMIT 1', [fx.networkA])).rows[0])
      .toMatchObject({ cycles_left: 1, ended_at: null });
    // The second (and last) discounted invoice ends it.
    await query(`UPDATE subscriptions SET current_period_start = now() - interval '31 days', current_period_end = now() - interval '1 hour' WHERE network_id = $1`, [fx.networkA]);
    await runBilling();
    expect((await query<{ ended_at: Date | null }>('SELECT ended_at FROM subscription_discounts WHERE network_id = $1 ORDER BY applied_at DESC LIMIT 1', [fx.networkA])).rows[0]!.ended_at).not.toBeNull();
    expect((await request(platform).get(`/platform/networks/${fx.networkA}/discount`).set(owner.auth)).body.data).toBeNull();
  });

  it('coupons: unique codes; expired, used up, archived, other currency → refused', async () => {
    const code = `UNIQ${t8()}`;
    expect((await request(platform).post('/platform/coupons').set(owner.auth).send({ code, name: 'x', kind: 'percent', percentOff: '10', duration: 'once' })).status).toBe(201);
    expect((await request(platform).post('/platform/coupons').set(owner.auth).send({ code: code.toLowerCase(), name: 'x', kind: 'percent', percentOff: '10', duration: 'once' })).status).toBe(400);
    expect((await coupon({ kind: 'percent', percentOff: '120', duration: 'once' })).status).toBe(422);
    expect((await coupon({ kind: 'amount', amountOff: '5', duration: 'once' })).status).toBe(422); // no currency

    const expired = (await coupon({ kind: 'percent', percentOff: '10', duration: 'once', validUntil: '2020-01-01' })).body.data;
    const r1 = await request(platform).post(`/platform/networks/${fx.networkB}/discount`).set(owner.auth).send({ code: expired.code });
    expect(r1.status).toBe(409);
    expect(r1.body.error.message).toMatch(/expired on 2020-01-01/);
    const one = (await coupon({ kind: 'percent', percentOff: '10', duration: 'once', maxRedemptions: 1 })).body.data;
    expect((await request(platform).post(`/platform/networks/${fx.networkB}/discount`).set(owner.auth).send({ code: one.code })).status).toBe(201);
    expect((await request(platform).post(`/platform/networks/${fx.networkA}/discount`).set(owner.auth).send({ code: one.code })).body.error.message).toMatch(/its limit/);
    expect((await request(platform).patch(`/platform/coupons/${one.id}`).set(owner.auth).send({ status: 'archived' })).body.data.status).toBe('archived');
    expect((await request(platform).post(`/platform/networks/${fx.networkB}/discount`).set(owner.auth).send({ code: one.code })).body.error.message).toMatch(/archived/);
    const eur = (await coupon({ kind: 'amount', amountOff: '5', currency: 'eur', duration: 'forever' })).body.data;
    const p = await plan(5000);
    await request(platform).put(`/platform/networks/${fx.networkB}/subscription`).set(owner.auth).send({ planId: p.id, trialDays: 30 });
    const mismatch = await request(platform).post(`/platform/networks/${fx.networkB}/discount`).set(owner.auth).send({ code: eur.code });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error).toMatchObject({ details: { reason: 'currency' } });
    expect((await request(platform).delete(`/platform/networks/${fx.networkB}/discount`).set(owner.auth)).status).toBe(200);
    expect((await request(platform).delete(`/platform/networks/${fx.networkB}/discount`).set(owner.auth)).status).toBe(404);
  });

  it('credit notes: paid invoices only, up to what is left; refunds count against collected', async () => {
    const inv = (await request(platform).post(`/platform/networks/${fx.networkB}/invoices`).set(owner.auth).send({ description: 'Setup fee', amount: '50.00' })).body.data;
    expect((await request(platform).get(`/platform/invoices/${inv.id}`).set(owner.auth)).body.data.lines).toEqual([expect.objectContaining({ kind: 'one_off', amount: '50.00' })]);
    expect((await request(platform).post(`/platform/invoices/${inv.id}/credit-notes`).set(owner.auth).send({ reason: 'x' })).status).toBe(409); // still open
    await request(platform).post(`/platform/invoices/${inv.id}/mark-paid`).set(owner.auth).send({ method: 'upi' });
    const cn = await request(platform).post(`/platform/invoices/${inv.id}/credit-notes`).set(owner.auth).send({ amount: '20.00', reason: 'Goodwill', refunded: true, refundMethod: 'upi', refundReference: 'UTR123' });
    expect(cn.status, JSON.stringify(cn.body)).toBe(201);
    expect(cn.body.data).toMatchObject({ amount: '20.00', refunded: true, number: expect.stringMatching(/^CN-\d{4}-\d{5}$/) });
    const tooMuch = await request(platform).post(`/platform/invoices/${inv.id}/credit-notes`).set(owner.auth).send({ amount: '30.01', reason: 'x' });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.message).toMatch(/At most USD 30.00 is left/);
    expect((await request(platform).post(`/platform/invoices/${inv.id}/credit-notes`).set(owner.auth).send({ reason: 'The rest' })).body.data.amount).toBe('30.00');
    expect((await request(platform).post(`/platform/invoices/${inv.id}/credit-notes`).set(owner.auth).send({ reason: 'x' })).body.error.message).toMatch(/fully credited/);
    expect((await request(platform).get(`/platform/invoices/${inv.id}`).set(owner.auth)).body.data.creditNotes).toHaveLength(2);
    const csv = await request(platform).get(`/platform/invoices.csv?networkId=${fx.networkB}`).set(owner.auth);
    expect(csv.text.split('\n')[0]).toBe('number,issued_at,due_at,network,slug,description,currency,subtotal,tax_rate,tax,total,status,overdue,paid_at,paid_amount,payment_method,payment_reference,credited,voided_at,void_reason');
    expect(csv.text).toContain(`${inv.number},`);
  });

  it('MRR movements: new → expansion → contraction → churn → reactivation; the revenue summary for an assigned role', async () => {
    const net = (await seedFixture(`mrr-${t8()}`)).networkA;
    const p50 = await plan(5000);
    const p80 = await plan(8000);
    const day = (n: number) => new Date(Date.UTC(2100, 0, 1 + n, 12));
    const moves = async () => (await query<{ day: string; kind: string; amount: string }>(
      `SELECT day::text, kind, amount::text FROM platform_mrr_movements WHERE network_id = $1 ORDER BY day`, [net])).rows;

    await snapshotMrr(day(-1)); // a run before it paid (the very first run day is only a baseline)
    await request(platform).put(`/platform/networks/${net}/subscription`).set(owner.auth).send({ planId: p50.id, trialDays: 0 });
    await snapshotMrr(day(0));
    await request(platform).put(`/platform/networks/${net}/subscription`).set(owner.auth).send({ planId: p80.id });
    await snapshotMrr(day(1));
    const half = (await coupon({ kind: 'percent', percentOff: '50', duration: 'forever' })).body.data;
    await request(platform).post(`/platform/networks/${net}/discount`).set(owner.auth).send({ code: half.code });
    await snapshotMrr(day(2));
    await request(platform).post(`/platform/networks/${net}/subscription/cancel`).set(owner.auth).send({ atPeriodEnd: false });
    await snapshotMrr(day(3));
    await snapshotMrr(day(4)); // still canceled: no second churn
    await request(platform).delete(`/platform/networks/${net}/discount`).set(owner.auth);
    await request(platform).put(`/platform/networks/${net}/subscription`).set(owner.auth).send({ planId: p80.id, trialDays: 0 });
    await snapshotMrr(day(5));
    await snapshotMrr(day(5)); // the same day again: recomputed, not doubled
    expect(await moves()).toEqual([
      { day: '2100-01-01', kind: 'new', amount: '50.00' },
      { day: '2100-01-02', kind: 'expansion', amount: '30.00' },
      { day: '2100-01-03', kind: 'contraction', amount: '-40.00' },
      { day: '2100-01-04', kind: 'churn', amount: '-40.00' },
      { day: '2100-01-06', kind: 'reactivation', amount: '80.00' },
    ]);

    // A custom 'assigned' Finance role sees only its network: exact numbers.
    const role = await request(platform).post('/platform/roles').set(owner.auth).send({ name: `Fin ${t8()}`, scope: 'assigned', home: '/admin/revenue', permissions: { revenue: 'read', billing: 'read' } });
    const fin = await staff(role.body.data.id);
    await query('UPDATE networks SET account_manager_id = $1 WHERE id = $2', [fin.id, net]);
    const sum = (await request(platform).get('/platform/revenue/summary').set(fin.auth)).body.data;
    expect(sum.mrr).toEqual([{ currency: 'USD', amount: '80.00', arr: '960.00', customers: 1, arpa: '80.00' }]);
    expect(sum.byPlan).toEqual([expect.objectContaining({ plan_id: p80.id, customers: 1, mrr: '80.00' })]);
    expect(sum.topCustomers).toEqual([expect.objectContaining({ network_id: net, mrr: '80.00' })]);
    expect(sum.outstanding).toEqual([expect.objectContaining({ currency: 'USD' })]);
    expect(sum.trend).toEqual(expect.any(Array));
    expect(sum.trialConversion).toEqual(expect.objectContaining({ ended: expect.any(Number) }));
    expect((await request(platform).get('/platform/revenue/summary').set((await staff('00000000-0000-4000-a000-000000000005')).auth)).status).toBe(403); // Support: no revenue
  });
});
