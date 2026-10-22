/**
 * Currency safety of the money ledger — live DB (INTEGRATION_DB=1, throwaway test DB only).
 *
 *   - Payout runs pay ONE currency: mixed balances without `currency` → 422 and NOTHING written;
 *     currency=EUR pays only EUR (lines, batch, ledger debits), USD untouched + reported; then USD;
 *     a repeat run pays nothing; single-currency network → that currency (not USD); no balances →
 *     empty run in the network default; negative balances never paid; invalid-code ('' / 'usd') rows
 *     skipped and reported; concurrent runs pay each balance exactly once; ledger debits ↔ payouts.
 *   - Tenant isolation: network B's balances never appear in A's run; B's publisherIds → 403 (API).
 *   - Balances per currency on every endpoint (finance, request-balances, portal earnings/summary,
 *     public API earnings): mixed → balance null + per-currency list.
 *   - rebalance across currencies → error, no write (also as a conversion-import per-row error);
 *     same-currency rebalance still works; reverse offsets both currencies; old-key reversals are
 *     not re-reversed. Reconcile per currency. Invoices numeric order within currency.
 *   - Add Conversion: currency defaults to the offer's; explicit validated; bad money → 422.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { PoolClient } from 'pg';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { buildPublicApiApp } from '../../src/surfaces/public-api/app.js';
import { generateApiKey, AUDIENCE_SCOPES } from '../../src/lib/apikeys/keys.js';
import type { ApiAudience } from '../../src/middleware/types.js';
import { pool, query } from '../../src/lib/db/pool.js';
import {
  accountBalances, createPayoutRun, rebalanceConversionLedger, reverseConversionLedger, writeConversionLedger,
} from '../../src/lib/ledger/ledger.js';
import { reconcileLedger } from '../../src/lib/ledger/reconcile.js';
import { canConnect, resetDb, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, portalToken, bearer } from '../helpers/tokens.js';

const run = process.env.INTEGRATION_DB === '1';
const d = run ? describe : describe.skip;

async function inTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

/** One approved publisher ledger entry, written by SQL (test DB only). */
const entry = (networkId: string, publisherId: string, direction: 'credit' | 'debit', amount: string, currency: string,
  o: { conversionId?: string; type?: string; key?: string; accountType?: string } = {}) => query(
  `INSERT INTO ledger_entries (network_id, account_type, account_id, conversion_id, entry_type, direction, amount, currency, status, idempotency_key)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'approved', $9)`,
  [networkId, o.accountType ?? 'publisher', publisherId, o.conversionId ?? null, o.type ?? (direction === 'credit' ? 'earning' : 'adjustment'),
    direction, amount, currency, o.key ?? `test:${randomUUID()}`]);

const counts = async (networkId: string) => (await query<{ batches: number; payouts: number; debits: number; matched: number }>(
  `SELECT (SELECT COUNT(*)::int FROM payout_batches WHERE network_id = $1) AS batches,
          (SELECT COUNT(*)::int FROM payouts WHERE network_id = $1) AS payouts,
          (SELECT COUNT(*)::int FROM ledger_entries WHERE network_id = $1 AND entry_type = 'payout') AS debits,
          (SELECT COUNT(*)::int FROM payouts p JOIN ledger_entries l
              ON l.idempotency_key = 'payout:' || p.id::text AND l.network_id = p.network_id
             AND l.account_id = p.publisher_id AND l.amount = p.amount AND l.currency = p.currency
           WHERE p.network_id = $1) AS matched`, [networkId])).rows[0]!;

d('ledger currency safety (live DB)', () => {
  let app: Express;
  let pub: Express;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    await resetDb();
    app = buildDashboardApp();
    pub = buildPublicApiApp();
  });

  const fixture = () => seedFixture(`fc-${randomUUID().slice(0, 8)}`);
  const adminOf = (networkId: string) => bearer(operatorToken({ userId: randomUUID(), networkId, role: 'admin' }));
  async function apiKey(networkId: string, audience: ApiAudience, ownerId: string): Promise<string> {
    const k = generateApiKey(audience);
    await query(
      `INSERT INTO api_keys (network_id, audience, owner_id, key_prefix, key_hash, name, scopes) VALUES ($1, $2, $3, $4, $5, 'test', $6)`,
      [networkId, audience, ownerId, k.prefix, k.keyHash, AUDIENCE_SCOPES[audience]]);
    return k.fullKey;
  }

  describe('payout run — one currency per run', () => {
    let fx: Fixture;
    let auth: { Authorization: string };
    const runBatch = (body: Record<string, unknown>) => request(app).post('/api/finance/payouts/batches').set(auth).send(body);

    beforeAll(async () => {
      fx = await fixture();
      auth = adminOf(fx.networkA);
      await entry(fx.networkA, fx.pubA1, 'credit', '10.0000', 'EUR');
      await entry(fx.networkA, fx.pubA1, 'credit', '7.0000', 'USD');
      await entry(fx.networkA, fx.pubA2, 'credit', '3.5000', 'USD');
      await entry(fx.networkB, fx.pubB1, 'credit', '100.0000', 'USD'); // another tenant
    });

    it('mixed EUR + USD without currency → 422 (currencies listed) and NOTHING is written', async () => {
      const res = await runBatch({});
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ ok: false, error: { code: 'validation_failed', details: { currencies: ['EUR', 'USD'] } } });
      expect(res.body.error.message).toBe('Payable balances are in several currencies (EUR, USD). Run one payout per currency — pass "currency".');
      expect(await counts(fx.networkA)).toEqual({ batches: 0, payouts: 0, debits: 0, matched: 0 });
    });

    it('an invalid currency → 422, nothing written', async () => {
      for (const currency of ['eur', 'EURO', '']) expect((await runBatch({ currency })).status).toBe(422);
      expect((await counts(fx.networkA)).batches).toBe(0);
    });

    it('currency=EUR pays only EUR; USD is untouched and reported in otherCurrencies', async () => {
      const res = await runBatch({ currency: 'EUR' });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        currency: 'EUR', total: '10.0000', lines: [{ publisherId: fx.pubA1, amount: '10.0000' }],
        skipped: [], otherCurrencies: [{ currency: 'USD', publishers: 2, total: '10.5000' }],
      });
      const batch = (await query<{ currency: string; fx_rate: string; total_amount: string }>(
        `SELECT currency, fx_rate::text, total_amount::text FROM payout_batches WHERE network_id = $1 AND id = $2`,
        [fx.networkA, res.body.data.batchId])).rows[0];
      expect(batch).toEqual({ currency: 'EUR', fx_rate: '1.00000000', total_amount: '10.0000' });
      const lines = (await query<{ publisher_id: string; amount: string; currency: string }>(
        `SELECT publisher_id, amount::text, currency FROM payouts WHERE network_id = $1 AND batch_id = $2`, [fx.networkA, res.body.data.batchId])).rows;
      expect(lines).toEqual([{ publisher_id: fx.pubA1, amount: '10.0000', currency: 'EUR' }]);
      const debits = (await query<{ account_id: string; amount: string; currency: string; direction: string }>(
        `SELECT account_id, amount::text, currency, direction FROM ledger_entries WHERE network_id = $1 AND entry_type = 'payout'`, [fx.networkA])).rows;
      expect(debits).toEqual([{ account_id: fx.pubA1, amount: '10.0000', currency: 'EUR', direction: 'debit' }]);
      expect(await accountBalances(fx.networkA, 'publisher', fx.pubA1)).toEqual([
        { currency: 'EUR', balance: '0.0000' }, { currency: 'USD', balance: '7.0000' }]);
      expect(await accountBalances(fx.networkA, 'publisher', fx.pubA2)).toEqual([{ currency: 'USD', balance: '3.5000' }]);
    });

    it('then a run WITHOUT currency pays the only remaining currency (USD)', async () => {
      const res = await runBatch({});
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ currency: 'USD', total: '10.5000', otherCurrencies: [], skipped: [] });
      expect(res.body.data.lines).toEqual(expect.arrayContaining([
        { publisherId: fx.pubA1, amount: '7.0000' }, { publisherId: fx.pubA2, amount: '3.5000' }]));
      expect(res.body.data.lines).toHaveLength(2);
    });

    it('a repeat run pays nothing (409 nothing_payable, no batch); network B is never touched', async () => {
      const res = await runBatch({});
      expect(res.status).toBe(409);
      expect(res.body.error.details).toMatchObject({ reason: 'nothing_payable', currency: 'USD', skipped: [], otherCurrencies: [] });
      const c = await counts(fx.networkA);
      expect(c).toEqual({ batches: 2, payouts: 3, debits: 3, matched: 3 }); // one ledger debit per payout line
      expect(await counts(fx.networkB)).toEqual({ batches: 0, payouts: 0, debits: 0, matched: 0 });
      expect(await accountBalances(fx.networkB, 'publisher', fx.pubB1)).toEqual([{ currency: 'USD', balance: '100.0000' }]);
      expect((await reconcileLedger()).filter((r) => r.networkId === fx.networkA)).toEqual([]);
    });

    it("another network's publisherId in a restricted run pays nothing (ledger reads are network-scoped)", async () => {
      const err = await createPayoutRun(fx.networkA, { publisherIds: [fx.pubB1], currency: 'USD' }).catch((e: unknown) => e) as { status: number };
      expect(err.status).toBe(409); // nothing payable in network A for that id → no batch
      expect(await accountBalances(fx.networkB, 'publisher', fx.pubB1)).toEqual([{ currency: 'USD', balance: '100.0000' }]);
    });
  });

  describe('payout run — defaults, negatives, invalid codes', () => {
    it("single-currency network: no currency → that currency (EUR), not USD", async () => {
      const fx = await fixture();
      await entry(fx.networkA, fx.pubA1, 'credit', '4.2500', 'EUR');
      const r = await createPayoutRun(fx.networkA);
      expect([r.currency, r.total, r.lines]).toEqual(['EUR', '4.2500', [{ publisherId: fx.pubA1, amount: '4.2500' }]]);
    });

    it("no payable balance → 409 nothing_payable in the network's default currency, no batch", async () => {
      const fx = await fixture();
      await query(`UPDATE networks SET default_currency = 'GBP' WHERE id = $1`, [fx.networkA]);
      const err = await createPayoutRun(fx.networkA).catch((e: unknown) => e) as { status: number; details: unknown };
      expect(err.status).toBe(409);
      expect(err.details).toMatchObject({ reason: 'nothing_payable', currency: 'GBP', otherCurrencies: [], skipped: [] });
      expect(await counts(fx.networkA)).toMatchObject({ batches: 0, payouts: 0, debits: 0 });
    });

    it('a negative balance is never paid (nor reported as payable elsewhere)', async () => {
      const fx = await fixture();
      await entry(fx.networkA, fx.pubA1, 'credit', '5.0000', 'USD');
      await entry(fx.networkA, fx.pubA1, 'debit', '8.0000', 'USD');
      await entry(fx.networkA, fx.pubA2, 'credit', '2.0000', 'USD');
      const r = await createPayoutRun(fx.networkA);
      expect(r.lines).toEqual([{ publisherId: fx.pubA2, amount: '2.0000' }]);
      expect([r.skipped, r.otherCurrencies]).toEqual([[], []]);
      expect(await accountBalances(fx.networkA, 'publisher', fx.pubA1)).toEqual([{ currency: 'USD', balance: '-3.0000' }]);
    });

    it("rows with an invalid currency ('' / 'usd') are skipped, reported and stay unpaid", async () => {
      const fx = await fixture();
      await entry(fx.networkA, fx.pubA1, 'credit', '6.0000', '');
      await entry(fx.networkA, fx.pubA2, 'credit', '1.0000', 'usd');
      await entry(fx.networkA, fx.pubA2, 'credit', '2.0000', 'USD');
      const r = await createPayoutRun(fx.networkA);
      expect(r.currency).toBe('USD');
      expect(r.lines).toEqual([{ publisherId: fx.pubA2, amount: '2.0000' }]);
      expect(r.skipped).toEqual([
        { publisherId: fx.pubA1, currency: '', amount: '6.0000' },
        { publisherId: fx.pubA2, currency: 'usd', amount: '1.0000' },
      ]);
      const again = await createPayoutRun(fx.networkA).catch((e: unknown) => e) as { status: number; details: { skipped: unknown[] } };
      expect([again.status, again.details.skipped.length]).toEqual([409, 2]); // still unpaid, still reported
      expect((await counts(fx.networkA)).debits).toBe(1);
    });
  });

  describe('payout run — concurrency', () => {
    it('concurrent runs pay each balance exactly once (advisory lock; balances read after it)', async () => {
      const fx = await fixture();
      await entry(fx.networkA, fx.pubA1, 'credit', '50.0000', 'USD');
      await entry(fx.networkA, fx.pubA2, 'credit', '25.0000', 'USD');
      // Pre-warm the pool so every run gets a live connection at once and the runs truly overlap
      // (otherwise connection setup alone can serialise them and hide a race).
      await Promise.all(Array.from({ length: 8 }, () => query('SELECT pg_sleep(0.05)')));
      const settled = await Promise.allSettled([1, 2, 3, 4].map(() => createPayoutRun(fx.networkA, { currency: 'USD' })));
      const results = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
      // The first run pays; the other three find nothing payable (409) and write no batch.
      expect(settled.filter((s) => s.status === 'rejected').map((s) => (s as PromiseRejectedResult).reason.status)).toEqual([409, 409, 409]);
      const lines = results.flatMap((r) => r.lines);
      expect(lines).toHaveLength(2);
      expect(lines).toEqual(expect.arrayContaining([
        { publisherId: fx.pubA1, amount: '50.0000' }, { publisherId: fx.pubA2, amount: '25.0000' }]));
      expect(results).toHaveLength(1);
      expect(await counts(fx.networkA)).toEqual({ batches: 1, payouts: 2, debits: 2, matched: 2 });
      for (const p of [fx.pubA1, fx.pubA2]) {
        expect(await accountBalances(fx.networkA, 'publisher', p)).toEqual([{ currency: 'USD', balance: '0.0000' }]);
      }
      const paid = (await query<{ t: string }>(`SELECT SUM(amount)::text AS t FROM payouts WHERE network_id = $1`, [fx.networkA])).rows[0]!.t;
      expect(paid).toBe('75.0000');
    });

    it('concurrent runs on DIFFERENT networks do not block each other or mix', async () => {
      const fx = await fixture();
      await entry(fx.networkA, fx.pubA1, 'credit', '1.0000', 'USD');
      await entry(fx.networkB, fx.pubB1, 'credit', '2.0000', 'EUR');
      const [a, b] = await Promise.all([createPayoutRun(fx.networkA), createPayoutRun(fx.networkB)]);
      expect([a.currency, a.lines]).toEqual(['USD', [{ publisherId: fx.pubA1, amount: '1.0000' }]]);
      expect([b.currency, b.lines]).toEqual(['EUR', [{ publisherId: fx.pubB1, amount: '2.0000' }]]);
    });
  });

  describe('public API POST /network/payouts', () => {
    it('currency validated (422), mixed → 422, cross-network publisherIds → 403, EUR run pays EUR only', async () => {
      const fx = await fixture();
      await entry(fx.networkA, fx.pubA1, 'credit', '3.0000', 'EUR');
      await entry(fx.networkA, fx.pubA2, 'credit', '4.0000', 'USD');
      await entry(fx.networkB, fx.pubB1, 'credit', '9.0000', 'EUR');
      const k = await apiKey(fx.networkA, 'network', randomUUID());
      const post = (body: Record<string, unknown>) => request(pub).post('/api/v1/network/payouts').set('X-Api-Key', k).send(body);

      expect((await post({ currency: 'eur' })).status).toBe(422);
      const mixed = await post({});
      expect([mixed.status, mixed.body.error.details]).toEqual([422, { currencies: ['EUR', 'USD'] }]);
      expect((await post({ currency: 'EUR', publisherIds: [fx.pubB1] })).status).toBe(403);
      expect((await post({ currency: 'EUR', publisherIds: [fx.pubA1, fx.pubB1] })).status).toBe(403);
      expect(await counts(fx.networkA)).toMatchObject({ batches: 0, payouts: 0, debits: 0 });

      const ok = await post({ currency: 'EUR' });
      expect(ok.status).toBe(201);
      expect(ok.body.data).toMatchObject({
        currency: 'EUR', total: '3.0000', lines: [{ publisherId: fx.pubA1, amount: '3.0000' }],
        otherCurrencies: [{ currency: 'USD', publishers: 1, total: '4.0000' }],
      });
      expect(await accountBalances(fx.networkB, 'publisher', fx.pubB1)).toEqual([{ currency: 'EUR', balance: '9.0000' }]);
    });
  });

  describe('balances per currency on every endpoint', () => {
    let fx: Fixture;
    let auth: { Authorization: string };
    let portal: { Authorization: string };
    beforeAll(async () => {
      fx = await fixture();
      auth = adminOf(fx.networkA);
      portal = bearer(portalToken({ userId: randomUUID(), networkId: fx.networkA, kind: 'publisher', ownerId: fx.pubA1 }));
      await entry(fx.networkA, fx.pubA1, 'credit', '2.0000', 'EUR');
      await entry(fx.networkA, fx.pubA1, 'credit', '5.0000', 'USD');
      await entry(fx.networkA, fx.pubA2, 'credit', '1.2500', 'USD');
    });
    const mixed = [{ currency: 'EUR', balance: '2.0000' }, { currency: 'USD', balance: '5.0000' }];

    it('finance GET /publishers/:id/balance', async () => {
      let res = await request(app).get(`/api/finance/publishers/${fx.pubA1}/balance`).set(auth);
      expect(res.body.data).toEqual({ publisherId: fx.pubA1, earned: null, payable: null, pending: '0.0000', currency: null, balances: { approved: mixed, pending: [] } });
      res = await request(app).get(`/api/finance/publishers/${fx.pubA2}/balance`).set(auth);
      expect(res.body.data).toMatchObject({ earned: '1.2500', payable: '1.2500', currency: 'USD' });
      // another network's publisher: nothing of theirs leaks (network-scoped ledger read)
      res = await request(app).get(`/api/finance/publishers/${fx.pubB1}/balance`).set(auth);
      expect(res.body.data).toMatchObject({ earned: '0.0000', balances: { approved: [], pending: [] } });
    });

    it('POST /publishers/request-balances (+ audit after carries balances)', async () => {
      const res = await request(app).post('/api/publishers/request-balances').set(auth).send({ publisherIds: [fx.pubA1, fx.pubA2, fx.pubB1] });
      expect(res.status).toBe(200);
      // F-24: each owed balance is also emailed to the partner — these have no contact email.
      const noAddress = { sent: false, skipped: 'no_recipients', reason: 'No email address to send to.', recipients: [] };
      expect(res.body.data.requested).toEqual([
        { publisherId: fx.pubA1, balance: null, currency: null, balances: mixed, email: noAddress },
        { publisherId: fx.pubA2, balance: '1.2500', currency: 'USD', balances: [{ currency: 'USD', balance: '1.2500' }], email: noAddress },
      ]);
      const audit = (await query<{ after: Record<string, unknown> }>(
        `SELECT after FROM audit_log WHERE network_id = $1 AND action = 'publisher.request_balance' AND entity_id = $2::text ORDER BY created_at DESC LIMIT 1`,
        [fx.networkA, fx.pubA1])).rows[0];
      expect(audit?.after).toEqual({ balance: null, currency: null, balances: mixed, emailed: false, emailSkipped: 'no_recipients' });
    });

    it('portal GET /earnings and /summary', async () => {
      const e = await request(app).get('/api/portal/publisher/earnings').set(portal);
      expect(e.status).toBe(200);
      expect(e.body.data).toMatchObject({ balance: null, currency: null, balances: mixed });
      expect(e.body.data.statement).toHaveLength(2);
      const s = await request(app).get('/api/portal/publisher/summary').set(portal);
      expect(s.status).toBe(200);
      expect(s.body.data).toMatchObject({ balance: null, balanceCurrency: null, balances: mixed });
      expect(s.body.data).toHaveProperty('currencies'); // kpi field kept, not clobbered
    });

    it('public API GET /publisher/earnings', async () => {
      const k1 = await apiKey(fx.networkA, 'publisher', fx.pubA1);
      const k2 = await apiKey(fx.networkA, 'publisher', fx.pubA2);
      const a = await request(pub).get('/api/v1/publisher/earnings').set('X-Api-Key', k1);
      expect(a.body.data).toMatchObject({ balance: null, currency: null, balances: mixed });
      const b = await request(pub).get('/api/v1/publisher/earnings').set('X-Api-Key', k2);
      expect(b.body.data).toMatchObject({ balance: '1.2500', currency: 'USD', balances: [{ currency: 'USD', balance: '1.2500' }] });
    });

    it('no entries → 0.0000 in the network default currency', async () => {
      const fresh = await fixture();
      await query(`UPDATE networks SET default_currency = 'INR' WHERE id = $1`, [fresh.networkA]);
      const res = await request(app).get(`/api/finance/publishers/${fresh.pubA1}/balance`).set(adminOf(fresh.networkA));
      expect(res.body.data).toEqual({ publisherId: fresh.pubA1, earned: '0.0000', payable: '0.0000', pending: '0.0000', currency: 'INR', balances: { approved: [], pending: [] } });
    });
  });

  describe('conversion rebalance / reversal', () => {
    let fx: Fixture;
    beforeAll(async () => { fx = await fixture(); });
    const convEntries = async (conversionId: string) => (await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM ledger_entries WHERE network_id = $1 AND conversion_id = $2`, [fx.networkA, conversionId])).rows[0]!.n;
    const nets = async (conversionId: string) => (await query<{ account_type: string; currency: string; net: string }>(
      `SELECT account_type, currency, SUM(CASE direction WHEN 'credit' THEN amount ELSE -amount END)::numeric(14,4)::text AS net
         FROM ledger_entries WHERE network_id = $1 AND conversion_id = $2 AND status = 'approved'
        GROUP BY account_type, currency ORDER BY account_type, currency`, [fx.networkA, conversionId])).rows;
    const base = (conversionId: string, currency: string) => ({
      networkId: fx.networkA, conversionId, publisherId: fx.pubA1, advertiserId: fx.advA, payout: '5.0000', revenue: '8.0000', currency,
    });

    it('entries in EUR + rebalance in USD → error, nothing written', async () => {
      await inTx((c) => writeConversionLedger(c, base('rb-eur', 'EUR')));
      const before = await convEntries('rb-eur');
      await expect(inTx((c) => rebalanceConversionLedger(c, { ...base('rb-eur', 'USD'), payout: '6.0000', reason: 't' })))
        .rejects.toThrow('Ledger entries for this conversion are in EUR; it cannot be rebalanced in USD without FX. Reverse and re-record it instead.');
      expect(await convEntries('rb-eur')).toBe(before);
    });

    it('same-currency rebalance still appends the difference', async () => {
      await inTx((c) => rebalanceConversionLedger(c, { ...base('rb-eur', 'EUR'), payout: '6.5000', revenue: '7.0000', reason: 't' }));
      expect(await nets('rb-eur')).toEqual([
        { account_type: 'advertiser', currency: 'EUR', net: '-7.0000' },
        { account_type: 'publisher', currency: 'EUR', net: '6.5000' },
      ]);
    });

    it('conversion-import update on a conversion whose ledger is in another currency → per-row error, rolled back', async () => {
      const auth = adminOf(fx.networkA);
      const add = await request(app).post('/api/offline/conversions').set(auth)
        .send({ offerId: fx.offerA, publisherId: fx.pubA1, payout: '2', revenue: '3', currency: 'EUR' });
      expect(add.status).toBe(201);
      const conversionId = add.body.data.conversionId as string;
      // Legacy mismatch: the conversion row says USD but its ledger was booked in EUR.
      await query(`UPDATE conversions SET currency = 'USD' WHERE network_id = $1 AND conversion_id = $2`, [fx.networkA, conversionId]);
      const before = await convEntries(conversionId);
      const res = await request(app).post('/api/conversion-imports').set(auth)
        .send({ type: 'update_by_conversion_id', rows: [{ conversionId, payout: '9' }] });
      expect(res.status).toBe(201);
      expect(res.body.data.errors).toEqual([{ row: 1, message: expect.stringMatching(/are in EUR; it cannot be rebalanced in USD without FX/) }]);
      expect(await convEntries(conversionId)).toBe(before);
      const conv = (await query<{ payout: string }>(`SELECT payout::text FROM conversions WHERE conversion_id = $1`, [conversionId])).rows[0];
      expect(conv?.payout).toBe('2.0000'); // the UPDATE was rolled back with the refused rebalance
    });

    it('reverse with nets in two currencies reverses BOTH (per-currency key); a re-run writes nothing', async () => {
      await inTx((c) => writeConversionLedger(c, base('rv-two', 'USD')));
      await entry(fx.networkA, fx.pubA1, 'credit', '2.0000', 'EUR', { conversionId: 'rv-two', type: 'adjustment' });
      await reverseConversionLedger(fx.networkA, 'rv-two', 'test');
      expect((await nets('rv-two')).map((n) => n.net)).toEqual(['0.0000', '0.0000', '0.0000']);
      const keys = (await query<{ k: string }>(
        `SELECT idempotency_key AS k FROM ledger_entries WHERE network_id = $1 AND conversion_id = 'rv-two' AND entry_type = 'reversal' ORDER BY 1`,
        [fx.networkA])).rows.map((r) => r.k);
      expect(keys).toEqual(['conv-reversal:advertiser:rv-two:USD', 'conv-reversal:publisher:rv-two:EUR', 'conv-reversal:publisher:rv-two:USD']);
      const n = await convEntries('rv-two');
      await reverseConversionLedger(fx.networkA, 'rv-two', 'again');
      expect(await convEntries('rv-two')).toBe(n);
    });

    it('a conversion already reversed under the OLD key is not reversed again', async () => {
      await inTx((c) => writeConversionLedger(c, base('rv-old', 'USD')));
      await entry(fx.networkA, fx.pubA1, 'debit', '5.0000', 'USD', { conversionId: 'rv-old', type: 'reversal', key: 'conv-reversal:publisher:rv-old' });
      await entry(fx.networkA, fx.advA, 'credit', '8.0000', 'USD', { conversionId: 'rv-old', type: 'reversal', key: 'conv-reversal:advertiser:rv-old', accountType: 'advertiser' });
      const n = await convEntries('rv-old');
      await reverseConversionLedger(fx.networkA, 'rv-old', 'again');
      expect(await convEntries('rv-old')).toBe(n);
    });
  });

  describe('reconcile per currency', () => {
    it('a payout line in EUR against a ledger debit in USD is drift in BOTH currencies (was hidden before)', async () => {
      const fx = await fixture();
      const batch = (await query<{ id: string }>(`INSERT INTO payout_batches (network_id, currency) VALUES ($1, 'EUR') RETURNING id`, [fx.networkA])).rows[0]!.id;
      const payoutId = (await query<{ id: string }>(
        `INSERT INTO payouts (network_id, batch_id, publisher_id, amount, currency) VALUES ($1, $2, $3, 5, 'EUR') RETURNING id`,
        [fx.networkA, batch, fx.pubA1])).rows[0]!.id;
      await entry(fx.networkA, fx.pubA1, 'debit', '5.0000', 'USD', { type: 'payout', key: `payout:${payoutId}` });
      const drift = (await reconcileLedger()).filter((r) => r.networkId === fx.networkA);
      expect(drift).toEqual([
        { networkId: fx.networkA, publisherId: fx.pubA1, currency: 'EUR', ledgerPayout: '0.0000', payoutsTable: '5.0000', drift: '-5.0000' },
        { networkId: fx.networkA, publisherId: fx.pubA1, currency: 'USD', ledgerPayout: '5.0000', payoutsTable: '0.0000', drift: '5.0000' },
      ]);
    });
  });

  describe('invoices order', () => {
    it('currency ASC, then the NUMERIC amount DESC (10 before 9), then account', async () => {
      const fx = await fixture();
      const pubA3 = (await query<{ id: string }>(
        `INSERT INTO publishers (network_id, name, status) VALUES ($1, 'Pub A3', 'active') RETURNING id`, [fx.networkA])).rows[0]!.id;
      await entry(fx.networkA, fx.pubA1, 'credit', '9.0000', 'USD');
      await entry(fx.networkA, fx.pubA2, 'credit', '10.0000', 'USD');
      await entry(fx.networkA, pubA3, 'credit', '1.0000', 'EUR');
      await entry(fx.networkA, fx.advA, 'debit', '9.0000', 'USD', { accountType: 'advertiser', type: 'billing' });
      await entry(fx.networkA, fx.advA, 'debit', '100.0000', 'EUR', { accountType: 'advertiser', type: 'billing' });
      await entry(fx.networkB, fx.pubB1, 'credit', '99.0000', 'USD');
      const res = await request(app).get('/api/invoices').set(adminOf(fx.networkA));
      expect(res.status).toBe(200);
      expect(res.body.data.affiliatePayable.map((r: { id: string; currency: string; amount: string }) => [r.id, r.currency, r.amount])).toEqual([
        [pubA3, 'EUR', '1.0000'], [fx.pubA2, 'USD', '10.0000'], [fx.pubA1, 'USD', '9.0000'],
      ]);
      expect(res.body.data.advertiserBilling.map((r: { currency: string; amount: string }) => [r.currency, r.amount])).toEqual([
        ['EUR', '100.0000'], ['USD', '9.0000'],
      ]);
    });
  });

  describe('Add Conversion currency + money', () => {
    let fx: Fixture;
    let auth: { Authorization: string };
    beforeAll(async () => {
      fx = await fixture();
      auth = adminOf(fx.networkA);
      await query(`UPDATE offers SET currency = 'EUR' WHERE id = $1`, [fx.offerA]);
    });
    const add = (body: Record<string, unknown>) =>
      request(app).post('/api/offline/conversions').set(auth).send({ offerId: fx.offerA, publisherId: fx.pubA1, ...body });
    const conv = async (id: string) => (await query<{ currency: string; payout: string | null }>(
      `SELECT currency, payout::text FROM conversions WHERE network_id = $1 AND conversion_id = $2`, [fx.networkA, id])).rows[0];
    const ledgerCurrencies = async (id: string) => (await query<{ c: string }>(
      `SELECT DISTINCT currency AS c FROM ledger_entries WHERE network_id = $1 AND conversion_id = $2`, [fx.networkA, id])).rows.map((r) => r.c);
    const manual = async () => (await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM conversions WHERE network_id = $1 AND source = 'manual'`, [fx.networkA])).rows[0]!.n;

    it("omitted currency → the offer's currency on the conversion and its ledger entries", async () => {
      const res = await add({ payout: '1.5', revenue: '3' });
      expect(res.status).toBe(201);
      expect(await conv(res.body.data.conversionId)).toEqual({ currency: 'EUR', payout: '1.5000' });
      expect(await ledgerCurrencies(res.body.data.conversionId)).toEqual(['EUR']);
    });

    it('an explicit currency is honoured; an invalid one → 422', async () => {
      const res = await add({ payout: '1', currency: 'GBP' });
      expect((await conv(res.body.data.conversionId))?.currency).toBe('GBP');
      const before = await manual();
      for (const currency of ['gbp', 'GB', '']) expect((await add({ payout: '1', currency })).status).toBe(422);
      expect(await manual()).toBe(before);
    });

    it('bad payout / revenue formats → 422 (never a DB error); nothing written', async () => {
      const before = await manual();
      for (const body of [{ payout: '1.23456' }, { payout: '-1' }, { payout: 'abc' }, { revenue: '12345678901' }, { revenue: '1,5' }]) {
        const res = await add(body);
        expect([JSON.stringify(body), res.status, res.body.error?.code]).toEqual([JSON.stringify(body), 422, 'validation_failed']);
      }
      expect(await manual()).toBe(before);
    });
  });
});
