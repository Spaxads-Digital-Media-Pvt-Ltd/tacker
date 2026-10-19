/**
 * Invoices are financial records (O8) and are issued per currency (O4) — live DB.
 *
 * O8: an invoice is never deleted. An unpaid one is VOIDED (kept with who / when / why; its period is
 * free again); a paid one is final — the API refuses, and so does the database. A partner with
 * invoices can't be deleted.
 * O4: an invoice bills ONE currency: asked for → that; else the only currency with activity in the
 * period; several → 422 listing them. The preview lists per-currency amounts and overlaps; the
 * invoice's ledger breakdown shows only its own currency.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('invoices: void instead of delete, one per currency (live DB)', () => {
  let dash: Express;
  let fx: Fixture;
  let admin: Record<string, string>;

  const partner = async () => (await query<{ id: string }>(
    `INSERT INTO publishers (network_id, name, status) VALUES ($1, $2, 'active') RETURNING id`, [fx.networkA, `Inv ${randomUUID().slice(0, 5)}`])).rows[0]!.id;
  const advertiser = async (currency = 'USD') => (await query<{ id: string }>(
    `INSERT INTO advertisers (network_id, name, default_currency) VALUES ($1, $2, $3) RETURNING id`, [fx.networkA, `Adv ${randomUUID().slice(0, 5)}`, currency])).rows[0]!.id;
  const ledger = async (accountType: 'publisher' | 'advertiser', accountId: string, amount: string, currency: string, day: string) => {
    const [entryType, direction] = accountType === 'publisher' ? ['earning', 'credit'] : ['billing', 'debit'];
    await query(
      `INSERT INTO ledger_entries (network_id, account_type, account_id, entry_type, direction, amount, currency, status, idempotency_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', $8, $9::date + time '12:00')`,
      [fx.networkA, accountType, accountId, entryType, direction, amount, currency, `test:${randomUUID()}`, day]);
  };
  const createPartnerInvoice = (body: Record<string, unknown>) => request(dash).post('/api/partner-invoices').set(admin).send(body);

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`inv-${randomUUID().slice(0, 8)}`);
    dash = buildDashboardApp();
    admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
  });

  it('an unpaid invoice is voided, not deleted — kept with the reason, and its period is free again', async () => {
    const p = await partner();
    await ledger('publisher', p, '40.0000', 'USD', '2026-03-10');
    const inv = await createPartnerInvoice({ publisherId: p, periodStart: '2026-03-01', periodEnd: '2026-03-31' });
    expect(inv.status).toBe(201);
    expect(inv.body.data).toMatchObject({ currency: 'USD', billedAmount: '40.00', status: 'unpaid' });

    const del = await request(dash).delete(`/api/partner-invoices/${inv.body.data.id}`).set(admin);
    expect(del.status).toBe(409);
    expect(del.body.error.details).toEqual({ reason: 'use_void' });
    expect((await request(dash).post(`/api/partner-invoices/${inv.body.data.id}/void`).set(admin).send({ reason: 'x' })).status).toBe(422);

    const voided = await request(dash).post(`/api/partner-invoices/${inv.body.data.id}/void`).set(admin).send({ reason: 'Wrong period' });
    expect(voided.status).toBe(200);
    expect(voided.body.data).toMatchObject({ status: 'void', voidReason: 'Wrong period', billedAmount: '40.00' });
    expect(voided.body.data.voidedAt).toBeTruthy();

    // Still on record, listed under Void; out of the totals; can't be paid or edited.
    const list = await request(dash).get(`/api/partner-invoices?status=void&publisherId=${p}`).set(admin);
    expect(list.body.data.map((i: { id: string }) => i.id)).toEqual([inv.body.data.id]);
    expect((await request(dash).post(`/api/partner-invoices/${inv.body.data.id}/approve-pay`).set(admin)).status).toBe(409);
    expect((await request(dash).patch(`/api/partner-invoices/${inv.body.data.id}`).set(admin).send({ publicNotes: 'x' })).status).toBe(409);
    // …and the period is free for the corrected invoice.
    expect((await createPartnerInvoice({ publisherId: p, periodStart: '2026-03-01', periodEnd: '2026-03-31' })).status).toBe(201);
  });

  it('a paid invoice is final: no delete, no void — even straight in the database; the partner can’t be deleted', async () => {
    const p = await partner();
    await ledger('publisher', p, '25.0000', 'USD', '2026-04-05');
    const inv = await createPartnerInvoice({ publisherId: p, periodStart: '2026-04-01', periodEnd: '2026-04-30' });
    expect((await request(dash).post(`/api/partner-invoices/${inv.body.data.id}/approve-pay`).set(admin)).status).toBe(200);

    const del = await request(dash).delete(`/api/partner-invoices/${inv.body.data.id}`).set(admin);
    expect(del.status).toBe(409);
    expect(del.body.error.message).toMatch(/paid invoice is a financial record/);
    const v = await request(dash).post(`/api/partner-invoices/${inv.body.data.id}/void`).set(admin).send({ reason: 'Oops' });
    expect(v.status).toBe(409);
    await expect(query(`UPDATE partner_invoices SET status = 'deleted' WHERE id = $1`, [inv.body.data.id])).rejects.toThrow(/paid invoice is final/);

    const delPartner = await request(dash).delete(`/api/publishers/${p}`).set(admin);
    expect(delPartner.status).toBe(409);
    expect(delPartner.body.error.message).toMatch(/invoice\(s\), which are financial records/);
  });

  it('one invoice per currency: several currencies → choose; the preview, the amounts and the breakdown are per currency', async () => {
    const p = await partner();
    await ledger('publisher', p, '10.0000', 'USD', '2026-05-03');
    await ledger('publisher', p, '7.5000', 'EUR', '2026-05-04');
    await ledger('publisher', p, '2.5000', 'EUR', '2026-05-20');

    const ambiguous = await createPartnerInvoice({ publisherId: p, periodStart: '2026-05-01', periodEnd: '2026-05-31' });
    expect(ambiguous.status).toBe(422);
    expect(ambiguous.body.error.message).toMatch(/several currencies in this period \(EUR, USD\)/);

    const preview = await request(dash).get(`/api/partner-invoices/preview?publisherId=${p}&periodStart=2026-05-01&periodEnd=2026-05-31`).set(admin);
    expect(preview.body.data).toEqual({ defaultCurrency: 'USD', currencies: [
      { currency: 'EUR', billedAmount: '10.00', overlaps: null }, { currency: 'USD', billedAmount: '10.00', overlaps: null },
    ] });

    const eur = await createPartnerInvoice({ publisherId: p, periodStart: '2026-05-01', periodEnd: '2026-05-31', currency: 'EUR' });
    expect(eur.status).toBe(201);
    expect(eur.body.data).toMatchObject({ currency: 'EUR', billedAmount: '10.00' });
    const usd = await createPartnerInvoice({ publisherId: p, periodStart: '2026-05-01', periodEnd: '2026-05-31', currency: 'USD' });
    expect(usd.body.data).toMatchObject({ currency: 'USD', billedAmount: '10.00' });

    const after = await request(dash).get(`/api/partner-invoices/preview?publisherId=${p}&periodStart=2026-05-01&periodEnd=2026-05-31`).set(admin);
    expect(after.body.data.currencies.map((c: { overlaps: unknown }) => c.overlaps)).toEqual([{ ref: eur.body.data.ref }, { ref: usd.body.data.ref }]);

    const breakdown = await request(dash).get(`/api/partner-invoices/${eur.body.data.id}/ledger`).set(admin);
    expect(breakdown.body.data.map((e: { currency: string }) => e.currency)).toEqual(['EUR', 'EUR']);

    const summary = await request(dash).get('/api/partner-invoices/summary').set(admin);
    expect(summary.body.data.byCurrency.map((c: { currency: string }) => c.currency)).toEqual(expect.arrayContaining(['EUR', 'USD']));

    // A partner who only earned EUR is invoiced in EUR without asking (before: the network's USD, for 0).
    const onlyEur = await partner();
    await ledger('publisher', onlyEur, '3.0000', 'EUR', '2026-05-09');
    const inferred = await createPartnerInvoice({ publisherId: onlyEur, periodStart: '2026-05-01', periodEnd: '2026-05-31' });
    expect(inferred.body.data).toMatchObject({ currency: 'EUR', billedAmount: '3.00' });
  });

  it('advertiser invoices follow the same rules', async () => {
    const a = await advertiser('USD');
    await ledger('advertiser', a, '50.0000', 'GBP', '2026-06-02');
    const inv = await request(dash).post('/api/advertiser-invoices').set(admin).send({ advertiserId: a, periodStart: '2026-06-01', periodEnd: '2026-06-30' });
    expect(inv.status).toBe(201);
    expect(inv.body.data).toMatchObject({ currency: 'GBP', billedAmount: '50.00' }); // billed in GBP, not the USD default
    expect((await request(dash).delete(`/api/advertiser-invoices/${inv.body.data.id}`).set(admin)).status).toBe(409);
    const voided = await request(dash).post(`/api/advertiser-invoices/${inv.body.data.id}/void`).set(admin).send({ reason: 'Duplicate' });
    expect(voided.body.data).toMatchObject({ status: 'void', voidReason: 'Duplicate' });

    const again = await request(dash).post('/api/advertiser-invoices').set(admin).send({ advertiserId: a, periodStart: '2026-06-01', periodEnd: '2026-06-30' });
    expect((await request(dash).post(`/api/advertiser-invoices/${again.body.data.id}/pay`).set(admin)).status).toBe(200);
    expect((await request(dash).post(`/api/advertiser-invoices/${again.body.data.id}/void`).set(admin).send({ reason: 'Nope' })).status).toBe(409);
    await expect(query(`UPDATE advertiser_invoices SET status = 'void' WHERE id = $1`, [again.body.data.id])).rejects.toThrow(/paid invoice is final/);
  });
});
