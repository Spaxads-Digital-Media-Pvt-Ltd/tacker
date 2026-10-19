/**
 * Paying an invoice settles the ledger, exactly once — on a real Postgres + Redis (INTEGRATION_DB=1,
 * as in CI) — audit F-03.
 *
 * A paid partner invoice is a real payout (payout batch + payouts row + ledger 'payout' debit, the
 * same path a payout run takes), so the payable balance drops and reconciliation stays clean. A
 * period that a payout run already paid can't be paid again by an invoice (settlements count
 * oldest-first), and a payout run after an invoice pays only what's left. Invoice periods for the
 * same account + currency can't overlap. An advertiser invoice payment writes a 'receipt' credit.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { createPayoutRun } from '../../src/lib/ledger/ledger.js';
import { reconcileLedger } from '../../src/lib/ledger/reconcile.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('invoice payment settles the ledger exactly once (live DB)', () => {
  let dash: Express;
  let fx: Fixture;
  let auth: { Authorization: string };

  const MARCH = { periodStart: '2026-03-01', periodEnd: '2026-03-31' };
  const APRIL = { periodStart: '2026-04-01', periodEnd: '2026-04-30' };

  const newPublisher = async () => (await query<{ id: string }>(
    `INSERT INTO publishers (network_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
    [fx.networkA, `Settle pub ${randomUUID().slice(0, 8)}`])).rows[0]!.id;
  const newAdvertiser = async () => (await query<{ id: string }>(
    `INSERT INTO advertisers (network_id, name) VALUES ($1, $2) RETURNING id`,
    [fx.networkA, `Settle adv ${randomUUID().slice(0, 8)}`])).rows[0]!.id;
  /** An approved ledger entry at a given time (the ledger only forbids UPDATE/DELETE, not dated inserts). */
  const entry = (accountType: 'publisher' | 'advertiser', accountId: string, entryType: string, direction: 'credit' | 'debit', amount: string, at: string) =>
    query(`INSERT INTO ledger_entries (network_id, account_type, account_id, entry_type, direction, amount, currency, status, idempotency_key, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'USD', 'approved', $7, $8)`,
    [fx.networkA, accountType, accountId, entryType, direction, amount, `test:${randomUUID()}`, at]);
  const earn = (pub: string, amount: string, at: string) => entry('publisher', pub, 'earning', 'credit', amount, at);

  const payable = async (pub: string) =>
    (await request(dash).get(`/api/finance/publishers/${pub}/balance`).set(auth)).body.data.payable as string;
  const payoutDebits = async (pub: string) => (await query<{ n: number; total: string }>(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::numeric(14,4)::text AS total FROM ledger_entries
      WHERE network_id = $1 AND account_type = 'publisher' AND account_id = $2 AND entry_type = 'payout'`,
    [fx.networkA, pub])).rows[0]!;
  const partnerInvoice = async (pub: string, period: { periodStart: string; periodEnd: string }) =>
    request(dash).post('/api/partner-invoices').set(auth).send({ publisherId: pub, ...period });
  const payPartner = (id: string) => request(dash).post(`/api/partner-invoices/${id}/approve-pay`).set(auth);

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`settle-${randomUUID().slice(0, 8)}`);
    dash = buildDashboardApp();
    auth = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA }));
  });

  describe('partner invoices', () => {
    it('paying draws the payable balance down by the invoice amount, as a real payout (reconciliation stays clean)', async () => {
      const pub = await newPublisher();
      await earn(pub, '100.00', '2026-03-10T12:00:00Z');
      await earn(pub, '50.00', '2026-03-20T12:00:00Z');
      const inv = await partnerInvoice(pub, MARCH);
      expect(inv.status).toBe(201);
      expect(inv.body.data.billedAmount).toBe('150.00');
      expect(await payable(pub)).toBe('150.0000');

      const paid = await payPartner(inv.body.data.id);
      expect(paid.status).toBe(200);
      expect(paid.body.data).toMatchObject({ status: 'paid', paymentsAmount: '150.00' });
      expect(await payable(pub)).toBe('0.0000');
      expect(await payoutDebits(pub)).toEqual({ n: 1, total: '150.0000' });

      const { rows: payouts } = await query<{ amount: string; note: string }>(
        `SELECT p.amount::text AS amount, b.note FROM payouts p JOIN payout_batches b ON b.id = p.batch_id
          WHERE p.network_id = $1 AND p.publisher_id = $2`, [fx.networkA, pub]);
      expect(payouts).toEqual([{ amount: '150.0000', note: `Partner invoice #${inv.body.data.ref}` }]);
      expect((await reconcileLedger()).filter((r) => r.publisherId === pub)).toEqual([]);
    });

    it('paying the same invoice twice is refused — no second ledger debit', async () => {
      const pub = await newPublisher();
      await earn(pub, '25.00', '2026-03-05T12:00:00Z');
      const inv = await partnerInvoice(pub, MARCH);
      expect((await payPartner(inv.body.data.id)).status).toBe(200);
      const again = await payPartner(inv.body.data.id);
      expect(again.status).toBe(409); // already paid (O8: a state conflict)
      expect(await payoutDebits(pub)).toEqual({ n: 1, total: '25.0000' });
    });

    it('a payout run first, then the invoice → refused; newer earnings do not mask the paid period (FIFO)', async () => {
      const pub = await newPublisher();
      await earn(pub, '200.00', '2026-03-10T12:00:00Z');
      const inv = await partnerInvoice(pub, MARCH);
      await createPayoutRun(fx.networkA, { publisherIds: [pub], currency: 'USD' });
      expect(await payable(pub)).toBe('0.0000');

      const refused = await payPartner(inv.body.data.id);
      expect(refused.status).toBe(409);
      expect(refused.body.error.message).toMatch(/already paid/);

      // April earnings arrive: the balance (300) is now larger than the invoice (200), but March was
      // already paid by the run — paying the invoice would pay March twice.
      await earn(pub, '300.00', '2026-04-10T12:00:00Z');
      expect((await payPartner(inv.body.data.id)).status).toBe(409);
      expect(await payoutDebits(pub)).toEqual({ n: 1, total: '200.0000' });
      expect(await payable(pub)).toBe('300.0000');
    });

    it('the invoice first, then a payout run → the run pays only what is left', async () => {
      const pub = await newPublisher();
      await earn(pub, '100.00', '2026-03-10T12:00:00Z');
      await earn(pub, '40.00', '2026-04-10T12:00:00Z');
      const inv = await partnerInvoice(pub, MARCH);
      expect((await payPartner(inv.body.data.id)).status).toBe(200);
      expect(await payable(pub)).toBe('40.0000');

      const run = await createPayoutRun(fx.networkA, { publisherIds: [pub], currency: 'USD' });
      expect(run.lines).toEqual([{ publisherId: pub, amount: '40.0000' }]);
      expect(await payable(pub)).toBe('0.0000');
      expect(await payoutDebits(pub)).toEqual({ n: 2, total: '140.0000' });
    });

    it('refuses an invoice whose conversions were reversed after it was created', async () => {
      const pub = await newPublisher();
      await earn(pub, '100.00', '2026-03-10T12:00:00Z');
      const inv = await partnerInvoice(pub, MARCH);
      await entry('publisher', pub, 'reversal', 'debit', '100.00', '2026-04-02T12:00:00Z');
      const refused = await payPartner(inv.body.data.id);
      expect(refused.status).toBe(409);
      expect(refused.body.error.message).toMatch(/reversed/);
      expect(await payoutDebits(pub)).toEqual({ n: 0, total: '0.0000' });
    });

    it('a zero invoice is marked paid without touching the ledger; a negative one is refused', async () => {
      const zeroPub = await newPublisher();
      const zero = await partnerInvoice(zeroPub, MARCH);
      expect(zero.body.data.billedAmount).toBe('0.00');
      expect((await payPartner(zero.body.data.id)).body.data.status).toBe('paid');
      expect(await payoutDebits(zeroPub)).toEqual({ n: 0, total: '0.0000' });

      const negPub = await newPublisher();
      await earn(negPub, '50.00', '2026-02-10T12:00:00Z');
      await entry('publisher', negPub, 'reversal', 'debit', '50.00', '2026-03-10T12:00:00Z');
      const neg = await partnerInvoice(negPub, MARCH);
      expect(neg.body.data.billedAmount).toBe('-50.00');
      expect((await payPartner(neg.body.data.id)).status).toBe(409);
    });

    it('bulk approve-pay pays what it can and reports every skipped invoice with its reason', async () => {
      const okPub = await newPublisher();
      await earn(okPub, '60.00', '2026-03-10T12:00:00Z');
      const ok = await partnerInvoice(okPub, MARCH);
      const paidPub = await newPublisher();
      await earn(paidPub, '70.00', '2026-03-10T12:00:00Z');
      const alreadyPaid = await partnerInvoice(paidPub, MARCH);
      await createPayoutRun(fx.networkA, { publisherIds: [paidPub], currency: 'USD' });
      const missing = randomUUID();

      const res = await request(dash).post('/api/partner-invoices/bulk-approve-pay').set(auth)
        .send({ ids: [ok.body.data.id, alreadyPaid.body.data.id, missing] });
      expect(res.status).toBe(200);
      expect(res.body.data.updated).toBe(1);
      expect(res.body.data.skipped).toEqual([
        { id: alreadyPaid.body.data.id, reason: expect.stringMatching(/already paid/) },
        { id: missing, reason: 'Invoice not found' },
      ]);
      expect(await payable(okPub)).toBe('0.0000');
      expect(await payoutDebits(paidPub)).toEqual({ n: 1, total: '70.0000' });
    });

    it('overlapping periods for the same partner → 409; an adjacent period is fine; voiding frees the period', async () => {
      const pub = await newPublisher();
      await earn(pub, '10.00', '2026-03-15T12:00:00Z');
      const march = await partnerInvoice(pub, MARCH);
      expect(march.status).toBe(201);

      const overlap = await partnerInvoice(pub, { periodStart: '2026-03-15', periodEnd: '2026-04-15' });
      expect(overlap.status).toBe(409);
      expect(overlap.body.error.message).toContain(`Invoice #${march.body.data.ref} already covers 2026-03-01 to 2026-03-31`);
      expect((await partnerInvoice(pub, APRIL)).status).toBe(201);

      // Invoices aren't deleted (O8) — voiding the unpaid one frees its period.
      expect((await request(dash).post(`/api/partner-invoices/${march.body.data.id}/void`).set(auth).send({ reason: 'Wrong dates' })).status).toBe(200);
      expect((await partnerInvoice(pub, MARCH)).status).toBe(201);
    });

    it('the database itself refuses overlapping live invoices (exclusion constraint), not just the route', async () => {
      const pub = await newPublisher();
      const insert = () => query(
        `INSERT INTO partner_invoices (network_id, publisher_id, currency, period_start, period_end) VALUES ($1, $2, 'USD', '2026-05-01', '2026-05-31')`,
        [fx.networkA, pub]);
      await insert();
      await expect(insert()).rejects.toMatchObject({ code: '23P01' });
    });
  });

  describe('advertiser invoices', () => {
    it("paying writes a 'receipt' credit against the billing; a later invoice's billed amount ignores receipts", async () => {
      const adv = await newAdvertiser();
      await entry('advertiser', adv, 'billing', 'debit', '80.00', '2026-03-10T12:00:00Z');
      const inv = await request(dash).post('/api/advertiser-invoices').set(auth).send({ advertiserId: adv, ...MARCH });
      expect(inv.body.data.billedAmount).toBe('80.00');

      const paid = await request(dash).post(`/api/advertiser-invoices/${inv.body.data.id}/pay`).set(auth);
      expect(paid.status).toBe(200);
      expect(paid.body.data).toMatchObject({ status: 'paid', paidAmount: '80.00' });
      const { rows } = await query<{ entry_type: string; direction: string; amount: string }>(
        `SELECT entry_type, direction, amount::text AS amount FROM ledger_entries
          WHERE network_id = $1 AND account_type = 'advertiser' AND account_id = $2 ORDER BY created_at`, [fx.networkA, adv]);
      expect(rows).toEqual([
        { entry_type: 'billing', direction: 'debit', amount: '80.0000' },
        { entry_type: 'receipt', direction: 'credit', amount: '80.0000' },
      ]);

      // The receipt is dated today; an invoice for a period containing today bills nothing (not −80).
      const today = new Date().toISOString().slice(0, 10);
      const later = await request(dash).post('/api/advertiser-invoices').set(auth)
        .send({ advertiserId: adv, periodStart: today, periodEnd: today });
      expect(later.body.data.billedAmount).toBe('0.00');

      expect((await request(dash).post(`/api/advertiser-invoices/${inv.body.data.id}/pay`).set(auth)).status).toBe(409); // already paid
      expect((await request(dash).post('/api/advertiser-invoices').set(auth).send({ advertiserId: adv, ...MARCH })).status).toBe(409);
    });
  });
});
