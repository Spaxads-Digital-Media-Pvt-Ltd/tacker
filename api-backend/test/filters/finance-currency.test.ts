/**
 * PURE tests (pg pool mocked; no DB / Redis) for currency safety in the money ledger:
 *   1. createPayoutRun pays ONE currency per run: explicit currency → only that currency (others
 *      reported in otherCurrencies, untouched); omitted → the single present currency, the network
 *      default when none, 422 + no writes when several; invalid codes ('' legacy rows) are skipped
 *      and reported; the per-network advisory lock is taken before balances are read.
 *   2. Routes: finance POST /payouts/batches + public API POST /network/payouts pass a validated
 *      `currency` through; invalid → 422; mixed balances → 422 envelope (not 500).
 *   3. Balances: accountBalances per currency; collapseBalances; accountBalance refuses a mixed
 *      account; finance GET /publishers/:id/balance + public API /publisher/earnings additive fields.
 *   4. rebalanceConversionLedger refuses to net across currencies (no write); same currency still
 *      appends the difference. reverseConversionLedger offsets each currency (per-currency key).
 *   5. reconcileLedger joins on currency; invoices order by currency, NUMERIC amount, account.
 *   6. Add Conversion: currency defaults to the offer's; explicit validated; payout/revenue money
 *      format (≤ 4 dp, numeric(14,4), not negative) → 422.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express, type Router } from 'express';
import request from 'supertest';
import type { PoolClient } from 'pg';

const queryMock = vi.fn();
const clientQueryMock = vi.fn();
vi.mock('../../src/lib/db/pool.js', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  pool: {
    query: (...a: unknown[]) => queryMock(...a),
    connect: async () => ({ query: (...a: unknown[]) => clientQueryMock(...a), release: () => undefined }),
  },
}));
vi.mock('../../src/lib/apikeys/rate-limit.js', () => ({
  checkRateLimit: () => Promise.resolve({ allowed: true, limit: 600, remaining: 600 }),
}));

const ledger = await import('../../src/lib/ledger/ledger.js');
const { reconcileLedger } = await import('../../src/lib/ledger/reconcile.js');
const { addMoney } = await import('../../src/lib/money.js');
const { errorHandler } = await import('../../src/lib/http/envelope.js');
const { financeRoutes } = await import('../../src/surfaces/dashboard/finance/routes.js');
const { offlineRoutes } = await import('../../src/surfaces/dashboard/offline/routes.js');
const { invoiceRoutes } = await import('../../src/surfaces/dashboard/catalog/routes.js');
const { networkApi } = await import('../../src/surfaces/public-api/network.js');
const { publisherApi } = await import('../../src/surfaces/public-api/publisher.js');

const NET = '33333333-3333-4333-8333-333333333333';
const PUB1 = '55555555-5555-4555-8555-555555555551';
const PUB2 = '55555555-5555-4555-8555-555555555552';
const PUB3 = '55555555-5555-4555-8555-555555555553';
const OFFER = '44444444-4444-4444-8444-444444444444';
const ADV = '66666666-6666-4666-8666-666666666666';

const sqlOf = (c: unknown[]) => String(c[0]).replace(/\s+/g, ' ');

function appFor(router: Router, identity: Record<string, unknown>, scope: Record<string, unknown> = { networkId: NET }): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { scope: unknown }).scope = scope;
    (req as unknown as { identity: unknown }).identity = identity;
    next();
  });
  app.use('/', router);
  app.use(errorHandler);
  return app;
}
const admin = { surface: 'dashboard', kind: 'admin', role: 'admin', userId: 'u1', networkId: NET };

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
});

// ── Fake transaction for createPayoutRun ─────────────────────────────────────────────────────────
interface BalRow { account_id: string; currency: string; bal: string }
function wirePayoutTx(balances: BalRow[], networkDefault = 'GBP') {
  const payouts: unknown[][] = [];
  clientQueryMock.mockImplementation(async (text: string, params: unknown[] = []) => {
    const sql = text.replace(/\s+/g, ' ');
    if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
    if (/FROM ledger_entries/.test(sql) && /GROUP BY account_id, currency/.test(sql)) {
      expect(params[0]).toBe(NET);
      const ids = params[1] as string[] | undefined;
      return { rows: balances.filter((b) => !ids || ids.includes(b.account_id)) };
    }
    if (/SELECT default_currency FROM networks/.test(sql)) return { rows: [{ default_currency: networkDefault }] };
    if (/INSERT INTO payout_batches/.test(sql)) return { rows: [{ id: 'batch-1' }] };
    if (/INSERT INTO payouts/.test(sql)) { payouts.push(params); return { rows: [], rowCount: 1 }; }
    if (/INSERT INTO ledger_entries/.test(sql)) return { rows: [{ id: 'le' }], rowCount: 1 };
    if (/UPDATE payout_batches/.test(sql)) {
      return { rows: [{ t: payouts.reduce<string>((t, p) => addMoney(t, String(p[4])), '0.0000') }] };
    }
    return { rows: [] };
  });
}
const calls = (re: RegExp) => clientQueryMock.mock.calls.filter((c) => re.test(sqlOf(c)));
const writes = () => calls(/INSERT INTO|UPDATE /);

const MIXED: BalRow[] = [
  { account_id: PUB1, currency: 'EUR', bal: '10.0000' },
  { account_id: PUB1, currency: 'USD', bal: '7.0000' },
  { account_id: PUB2, currency: 'USD', bal: '3.5000' },
  { account_id: PUB3, currency: '', bal: '2.0000' },
];

describe('createPayoutRun — one currency per run', () => {
  it('mixed balances and no currency → 422 with the currencies, nothing written, rolled back', async () => {
    wirePayoutTx(MIXED);
    const err = await ledger.createPayoutRun(NET).catch((e: unknown) => e) as { status: number; code: string; message: string; details: unknown };
    expect([err.status, err.code]).toEqual([422, 'validation_failed']);
    expect(err.message).toBe('Payable balances are in several currencies (EUR, USD). Run one payout per currency — pass "currency".');
    expect(err.details).toEqual({ currencies: ['EUR', 'USD'] });
    expect(writes()).toHaveLength(0);
    expect(calls(/^ROLLBACK$/)).toHaveLength(1);
    expect(calls(/^COMMIT$/)).toHaveLength(0);
  });

  it('takes the per-network advisory lock inside the transaction BEFORE reading balances', async () => {
    wirePayoutTx(MIXED);
    await ledger.createPayoutRun(NET, { currency: 'EUR' });
    const order = clientQueryMock.mock.calls.map((c) => sqlOf(c));
    const lock = order.findIndex((s) => /pg_advisory_xact_lock\(hashtextextended\('payout-run:' \|\| \$1::text, 0\)\)/.test(s));
    expect(order[0]).toBe('BEGIN');
    expect(lock).toBe(1);
    expect(clientQueryMock.mock.calls[lock]![1]).toEqual([NET]);
    expect(order.findIndex((s) => /FROM ledger_entries/.test(s))).toBeGreaterThan(lock);
  });

  it('currency=EUR pays only EUR; USD is untouched and reported; invalid-code rows are skipped', async () => {
    wirePayoutTx(MIXED);
    const r = await ledger.createPayoutRun(NET, { currency: 'EUR', note: 'n' });
    expect(r).toEqual({
      batchId: 'batch-1', currency: 'EUR', total: '10.0000',
      lines: [{ publisherId: PUB1, amount: '10.0000' }],
      skipped: [{ publisherId: PUB3, currency: '', amount: '2.0000' }],
      otherCurrencies: [{ currency: 'USD', publishers: 2, total: '10.5000' }],
    });
    expect(calls(/INSERT INTO payout_batches/)[0]![1]).toEqual([NET, 'EUR', 'n', null]);
    expect(calls(/INSERT INTO payouts/).map((c) => (c[1] as unknown[]).slice(3, 6))).toEqual([[PUB1, '10.0000', 'EUR']]);
    const debits = calls(/INSERT INTO ledger_entries/).map((c) => c[1] as unknown[]);
    expect(debits).toHaveLength(1);
    expect([debits[0]![2], debits[0]![4], debits[0]![5], debits[0]![6], debits[0]![7]]).toEqual([PUB1, 'payout', 'debit', '10.0000', 'EUR']);
    expect(String(debits[0]![9])).toMatch(/^payout:/);
    // fx_rate stays 1 (no conversion) on both the batch and the line.
    expect(sqlOf(calls(/INSERT INTO payout_batches/)[0]!)).toMatch(/VALUES \(\$1, 'paid', \$2, 1, \$3, \$4\)/);
    expect(sqlOf(calls(/INSERT INTO payouts/)[0]!)).toMatch(/VALUES \(\$1,\$2,\$3,\$4,\$5,\$6,1,'paid'\)/);
  });

  it('currency=USD pays both USD publishers and reports EUR as the other currency', async () => {
    wirePayoutTx(MIXED);
    const r = await ledger.createPayoutRun(NET, { currency: 'USD' });
    expect(r.lines).toEqual([{ publisherId: PUB1, amount: '7.0000' }, { publisherId: PUB2, amount: '3.5000' }]);
    expect(r.total).toBe('10.5000');
    expect(r.otherCurrencies).toEqual([{ currency: 'EUR', publishers: 1, total: '10.0000' }]);
  });

  it('omitted currency with ONE currency present → that currency (not USD); restricted to publisherIds', async () => {
    wirePayoutTx([{ account_id: PUB1, currency: 'EUR', bal: '4.0000' }, { account_id: PUB2, currency: 'USD', bal: '1.0000' }]);
    const r = await ledger.createPayoutRun(NET, { publisherIds: [PUB1] });
    expect([r.currency, r.total, r.otherCurrencies, r.skipped]).toEqual(['EUR', '4.0000', [], []]);
    expect(sqlOf(calls(/FROM ledger_entries/)[0]!)).toMatch(/account_id = ANY\(\$2::uuid\[\]\)/);
  });

  it('no payable balance → 409 nothing_payable in the network default currency, no batch written', async () => {
    wirePayoutTx([], 'GBP');
    const err = await ledger.createPayoutRun(NET).catch((e: unknown) => e) as { status: number; message: string; details: { reason: string; currency: string } };
    expect(err.status).toBe(409);
    expect(err.details).toMatchObject({ reason: 'nothing_payable', currency: 'GBP' });
    expect(err.message).toMatch(/Nothing is payable in GBP/);
    expect(calls(/INSERT INTO payout_batches|INSERT INTO payouts|INSERT INTO ledger_entries/)).toHaveLength(0);
  });

  it('balances only in another currency → 409 naming that currency, no batch written', async () => {
    wirePayoutTx([{ account_id: PUB1, currency: 'EUR', bal: '10.0000' }], 'USD');
    const err = await ledger.createPayoutRun(NET, { currency: 'USD' }).catch((e: unknown) => e) as { status: number; message: string; details: { otherCurrencies: unknown } };
    expect(err.status).toBe(409);
    expect(err.message).toMatch(/owed in EUR/);
    expect(err.details.otherCurrencies).toEqual([{ currency: 'EUR', publishers: 1, total: '10.0000' }]);
    expect(calls(/INSERT INTO payout_batches/)).toHaveLength(0);
  });

  it('only invalid-code balances → 409, all reported as skipped (never paid)', async () => {
    wirePayoutTx([{ account_id: PUB1, currency: 'usd', bal: '5.0000' }, { account_id: PUB2, currency: '', bal: '1.0000' }], 'EUR');
    const err = await ledger.createPayoutRun(NET).catch((e: unknown) => e) as { status: number; details: { currency: string; skipped: unknown } };
    expect(err.status).toBe(409);
    expect(err.details.currency).toBe('EUR');
    expect(err.details.skipped).toEqual([
      { publisherId: PUB1, currency: 'usd', amount: '5.0000' },
      { publisherId: PUB2, currency: '', amount: '1.0000' },
    ]);
  });

  it('the balance query only takes POSITIVE approved publisher balances, per (publisher, currency), network-scoped', async () => {
    wirePayoutTx([]);
    await ledger.createPayoutRun(NET).catch(() => undefined); // nothing payable → 409 after the read
    const sql = sqlOf(calls(/FROM ledger_entries/)[0]!);
    expect(sql).toMatch(/WHERE network_id = \$1 AND account_type = 'publisher' AND status = 'approved'/);
    expect(sql).toMatch(/GROUP BY account_id, currency HAVING SUM\(CASE direction WHEN 'credit' THEN amount ELSE -amount END\) > 0/);
  });

  it('an invalid explicit currency is 422 before any connection / write', async () => {
    for (const currency of ['usd', 'US', 'EURO', '']) {
      const err = await ledger.createPayoutRun(NET, { currency }).catch((e: unknown) => e) as { status: number };
      expect(err.status).toBe(422);
    }
    expect(clientQueryMock).not.toHaveBeenCalled();
  });
});

// ── Routes: payout runs ──────────────────────────────────────────────────────────────────────────
describe('payout routes pass a validated currency through', () => {
  beforeEach(() => queryMock.mockResolvedValue({ rows: [{ id: 'audit-1' }] }));

  it('finance POST /payouts/batches: currency passes through; invalid → 422; mixed → 422 envelope', async () => {
    const app = appFor(financeRoutes(), admin);
    wirePayoutTx(MIXED);
    const ok = await request(app).post('/payouts/batches').send({ currency: 'USD' });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ currency: 'USD', total: '10.5000', otherCurrencies: [{ currency: 'EUR', publishers: 1, total: '10.0000' }] });

    clientQueryMock.mockClear();
    for (const currency of ['usd', 'EURO', 12]) {
      const bad = await request(app).post('/payouts/batches').send({ currency });
      expect(bad.status).toBe(422);
      expect(bad.body.error.code).toBe('validation_failed');
    }
    expect(clientQueryMock).not.toHaveBeenCalled();

    const mixed = await request(app).post('/payouts/batches').send({});
    expect(mixed.status).toBe(422);
    expect(mixed.body).toMatchObject({ ok: false, error: { code: 'validation_failed', details: { currencies: ['EUR', 'USD'] } } });
    expect(writes()).toHaveLength(0);
  });

  it('public API POST /payouts: currency passes through; invalid → 422 (nothing runs); mixed → 422', async () => {
    const key = { surface: 'public-api', audience: 'network', networkId: NET, ownerId: 'o', keyId: 'k1', scopes: ['payouts:write'] };
    const app = appFor(networkApi(), key);
    queryMock.mockImplementation(async (text: string, params: unknown[] = []) => {
      if (/SELECT id FROM publishers WHERE network_id = \$1 AND id = ANY\(\$2\)/.test(text)) {
        expect(params[0]).toBe(NET);
        return { rows: (params[1] as string[]).filter((id) => id !== PUB3).map((id) => ({ id })) };
      }
      return { rows: [] };
    });
    wirePayoutTx(MIXED);
    const ok = await request(app).post('/payouts').send({ currency: 'EUR', publisherIds: [PUB1] });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ currency: 'EUR', lines: [{ publisherId: PUB1, amount: '10.0000' }], otherCurrencies: [{ currency: 'USD', publishers: 1, total: '7.0000' }] });

    clientQueryMock.mockClear();
    for (const currency of ['eur', 'E', null, 5]) {
      const bad = await request(app).post('/payouts').send({ currency });
      expect([bad.status, bad.body.error.code]).toEqual([422, 'validation_failed']);
    }
    expect(clientQueryMock).not.toHaveBeenCalled();

    const mixed = await request(app).post('/payouts').send({});
    expect([mixed.status, mixed.body.error.details]).toEqual([422, { currencies: ['EUR', 'USD'] }]);
    // The cross-network publisherId check still runs first (403, no run).
    clientQueryMock.mockClear();
    const foreign = await request(app).post('/payouts').send({ currency: 'EUR', publisherIds: [PUB1, PUB3] });
    expect(foreign.status).toBe(403);
    expect(clientQueryMock).not.toHaveBeenCalled();
  });
});

// ── Balances ─────────────────────────────────────────────────────────────────────────────────────
describe('balances are per currency — never a cross-currency sum', () => {
  type Bal = { currency: string; balance: string };
  function wireBalances(byStatus: Record<string, Bal[]>, networkDefault = 'EUR') {
    queryMock.mockImplementation(async (text: string, params: unknown[] = []) => {
      const sql = text.replace(/\s+/g, ' ');
      if (/FROM ledger_entries/.test(sql) && /GROUP BY currency ORDER BY currency/.test(sql)) {
        expect(params[0]).toBe(NET);
        return { rows: byStatus[String(params[3])] ?? [] };
      }
      if (/SELECT default_currency FROM networks/.test(sql)) return { rows: [{ default_currency: networkDefault }] };
      if (/FROM ledger_entries/.test(sql)) return { rows: [] }; // statement
      return { rows: [] };
    });
  }
  const mixed = [{ currency: 'EUR', balance: '2.0000' }, { currency: 'USD', balance: '5.0000' }];

  it('accountBalances groups by currency (network-scoped, sorted); accountBalance refuses a mixed account', async () => {
    wireBalances({ approved: mixed });
    expect(await ledger.accountBalances(NET, 'publisher', PUB1)).toEqual(mixed);
    const sql = sqlOf(queryMock.mock.calls[0]!);
    expect(sql).toMatch(/WHERE network_id = \$1 AND account_type = \$2 AND account_id = \$3 AND status = \$4 GROUP BY currency ORDER BY currency/);
    await expect(ledger.accountBalance(NET, 'publisher', PUB1)).rejects.toThrow(/several currencies/);
    wireBalances({ approved: [mixed[1]!] });
    expect(await ledger.accountBalance(NET, 'publisher', PUB1)).toBe('5.0000');
    wireBalances({});
    expect(await ledger.accountBalance(NET, 'publisher', PUB1)).toBe('0.0000');
  });

  it('collapseBalances: none → 0 + default, one → it, several → null', () => {
    expect(ledger.collapseBalances([], 'EUR')).toEqual({ balance: '0.0000', currency: 'EUR' });
    expect(ledger.collapseBalances([mixed[1]!], 'EUR')).toEqual({ balance: '5.0000', currency: 'USD' });
    expect(ledger.collapseBalances(mixed, 'EUR')).toEqual({ balance: null, currency: null });
  });

  it('finance GET /publishers/:id/balance: additive currency + balances; null when mixed', async () => {
    const app = appFor(financeRoutes(), admin);
    wireBalances({ approved: mixed, pending: [{ currency: 'USD', balance: '1.0000' }] });
    let res = await request(app).get(`/publishers/${PUB1}/balance`);
    expect(res.body.data).toEqual({
      publisherId: PUB1, earned: null, payable: null, pending: '1.0000', currency: null,
      balances: { approved: mixed, pending: [{ currency: 'USD', balance: '1.0000' }] },
    });
    wireBalances({ approved: [{ currency: 'USD', balance: '5.0000' }], pending: [{ currency: 'USD', balance: '1.0000' }] });
    res = await request(app).get(`/publishers/${PUB1}/balance`);
    expect(res.body.data).toMatchObject({ earned: '5.0000', payable: '5.0000', pending: '1.0000', currency: 'USD' });
    // approved in one currency, pending in another: each value is single-currency, `currency` is null.
    wireBalances({ approved: [{ currency: 'USD', balance: '5.0000' }], pending: [{ currency: 'EUR', balance: '1.0000' }] });
    res = await request(app).get(`/publishers/${PUB1}/balance`);
    expect(res.body.data).toMatchObject({ earned: '5.0000', pending: '1.0000', currency: null });
    wireBalances({}, 'GBP');
    res = await request(app).get(`/publishers/${PUB1}/balance`);
    expect(res.body.data).toEqual({
      publisherId: PUB1, earned: '0.0000', payable: '0.0000', pending: '0.0000', currency: 'GBP', balances: { approved: [], pending: [] },
    });
  });

  it('public API GET /publisher/earnings: balance/currency null when mixed, balances always', async () => {
    const key = { surface: 'public-api', audience: 'publisher', networkId: NET, ownerId: PUB1, keyId: 'k', scopes: ['earnings:read'] };
    const app = appFor(publisherApi(), key);
    wireBalances({ approved: mixed });
    let res = await request(app).get('/earnings');
    expect(res.body.data).toEqual({ balance: null, currency: null, balances: mixed, statement: [] });
    wireBalances({ approved: [{ currency: 'EUR', balance: '2.0000' }] });
    res = await request(app).get('/earnings');
    expect(res.body.data).toMatchObject({ balance: '2.0000', currency: 'EUR' });
  });
});

// ── Rebalance / reverse ──────────────────────────────────────────────────────────────────────────
describe('conversion rebalance / reversal never net across currencies', () => {
  type Net = { account_type: string; account_id: string; currency: string; net: string };
  function fakeClient(nets: Net[]): PoolClient {
    clientQueryMock.mockImplementation(async (text: string) => {
      const sql = text.replace(/\s+/g, ' ');
      if (/GROUP BY account_type, account_id, currency/.test(sql)) return { rows: nets };
      if (/INSERT INTO ledger_entries/.test(sql)) return { rows: [{ id: 'x' }], rowCount: 1 };
      return { rows: [] };
    });
    return { query: (...a: unknown[]) => clientQueryMock(...a) } as unknown as PoolClient;
  }
  const args = { networkId: NET, conversionId: 'c1', publisherId: PUB1, advertiserId: ADV, payout: '6.0000', revenue: '9.0000', currency: 'USD', reason: 't' };
  const inserts = () => calls(/INSERT INTO ledger_entries/).map((c) => c[1] as unknown[]);

  it('existing entries in EUR + rebalance in USD → 422-style error, nothing written', async () => {
    const c = fakeClient([
      { account_type: 'publisher', account_id: PUB1, currency: 'EUR', net: '5.0000' },
      { account_type: 'advertiser', account_id: ADV, currency: 'EUR', net: '-8.0000' },
    ]);
    const err = await ledger.rebalanceConversionLedger(c, args).catch((e: unknown) => e) as { status: number; message: string };
    expect(err.status).toBe(422);
    expect(err.message).toBe('Ledger entries for this conversion are in EUR; it cannot be rebalanced in USD without FX. Reverse and re-record it instead.');
    expect(inserts()).toHaveLength(0);
  });

  it('a ZERO net in another currency does not block; the same-currency difference is appended', async () => {
    const c = fakeClient([
      { account_type: 'publisher', account_id: PUB1, currency: 'EUR', net: '0.0000' },
      { account_type: 'publisher', account_id: PUB1, currency: 'USD', net: '5.0000' },
      { account_type: 'advertiser', account_id: ADV, currency: 'USD', net: '-8.0000' },
    ]);
    await ledger.rebalanceConversionLedger(c, args);
    const rows = inserts().map((p) => [p[1], p[4], p[5], p[6], p[7]]);
    expect(rows).toEqual([
      ['publisher', 'adjustment', 'credit', '1.0000', 'USD'],
      ['advertiser', 'adjustment', 'debit', '1.0000', 'USD'],
    ]);
  });

  it('reverse offsets EVERY currency (per-currency idempotency key), skips zero nets', async () => {
    fakeClient([
      { account_type: 'publisher', account_id: PUB1, currency: 'EUR', net: '1.0000' },
      { account_type: 'publisher', account_id: PUB1, currency: 'USD', net: '5.0000' },
      { account_type: 'advertiser', account_id: ADV, currency: 'USD', net: '0.0000' },
    ]);
    await ledger.reverseConversionLedger(NET, 'c1', 'test');
    expect(inserts().map((p) => [p[1], p[5], p[6], p[7], p[9]])).toEqual([
      ['publisher', 'debit', '1.0000', 'EUR', 'conv-reversal:publisher:c1:EUR'],
      ['publisher', 'debit', '5.0000', 'USD', 'conv-reversal:publisher:c1:USD'],
    ]);
  });
});

// ── Reconcile + invoices ─────────────────────────────────────────────────────────────────────────
describe('reconciliation and invoices are per currency', () => {
  it('reconcileLedger groups and joins on currency; Drift carries it', async () => {
    queryMock.mockResolvedValue({ rows: [{ network_id: NET, publisher_id: PUB1, currency: 'EUR', ledger_payout: '1.0000', paid: '0.0000', drift: '1.0000' }] });
    expect(await reconcileLedger()).toEqual([{ networkId: NET, publisherId: PUB1, currency: 'EUR', ledgerPayout: '1.0000', payoutsTable: '0.0000', drift: '1.0000' }]);
    const sql = sqlOf(queryMock.mock.calls[0]!);
    expect(sql).toMatch(/GROUP BY network_id, account_id, currency\) l/);
    expect(sql).toMatch(/GROUP BY network_id, publisher_id, currency\) p/);
    expect(sql).toMatch(/AND l\.currency = p\.currency/);
  });

  it('invoices order by currency, the NUMERIC amount, then account — never ORDER BY the text column', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const res = await request(appFor(invoiceRoutes(), admin)).get('/');
    expect(res.status).toBe(200);
    const [adv, pub] = queryMock.mock.calls.map((c) => sqlOf(c));
    expect(adv).toMatch(/ORDER BY a\.currency, COALESCE\(SUM\(a\.amount\) FILTER \(WHERE a\.direction = 'debit'\),0\) DESC, a\.account_id$/);
    expect(pub).toMatch(/ORDER BY a\.currency, COALESCE\(SUM\(CASE WHEN a\.direction = 'credit' THEN a\.amount ELSE -a\.amount END\),0\) DESC, a\.account_id$/);
    for (const s of [adv, pub]) {
      expect(s).not.toMatch(/ORDER BY 3/);
      expect(s).toMatch(/WHERE a\.network_id = \$1/);
    }
  });
});

// ── Add Conversion ───────────────────────────────────────────────────────────────────────────────
describe('Add Conversion — currency default + money validation', () => {
  function wire(offerCurrency = 'EUR') {
    queryMock.mockImplementation(async (text: string) => {
      const sql = text.replace(/\s+/g, ' ');
      if (/FROM offers o JOIN networks n/.test(sql)) {
        return { rows: [{ id: OFFER, advertiser_id: ADV, currency: offerCurrency, visibility: 'public', metadata: {}, advertiser_in_network: true }] };
      }
      return { rows: [{ id: 'audit-1' }] };
    });
    clientQueryMock.mockImplementation(async (text: string) =>
      (/INSERT INTO ledger_entries/.test(text) ? { rows: [{ id: 'le' }], rowCount: 1 } : { rows: [] }));
  }
  const add = (body: Record<string, unknown>) =>
    request(appFor(offlineRoutes(), admin)).post('/conversions').send({ offerId: OFFER, ...body });
  const conv = () => calls(/INSERT INTO conversions/).map((c) => c[1] as unknown[]);
  const ledgerRows = () => calls(/INSERT INTO ledger_entries/).map((c) => c[1] as unknown[]);

  it('omitted currency → the offer currency on the conversion AND both ledger entries', async () => {
    wire('EUR');
    const res = await add({ payout: '1.5', revenue: '3' });
    expect(res.status).toBe(201);
    expect([conv()[0]![8], conv()[0]![9], conv()[0]![10]]).toEqual(['1.5000', '3.0000', 'EUR']);
    expect(ledgerRows().map((p) => [p[1], p[6], p[7]])).toEqual([['advertiser', '3.0000', 'EUR']]);
  });

  it('an explicit valid currency is honoured', async () => {
    wire('EUR');
    const res = await add({ payout: '2', currency: 'GBP' });
    expect(res.status).toBe(201);
    expect(conv()[0]![10]).toBe('GBP');
  });

  it('an invalid explicit currency → 422; nothing written', async () => {
    wire('EUR');
    for (const currency of ['usd', 'US', 'EURO', '', 12]) {
      const res = await add({ payout: '1', currency });
      expect([res.status, res.body.error.code]).toEqual([422, 'validation_failed']);
      expect(res.body.error.details.currency).toBeDefined();
    }
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it('a malformed stored offer currency is refused (422) instead of booking an unpayable ledger row', async () => {
    wire('usd');
    const res = await add({ payout: '1' });
    expect(res.status).toBe(422);
    expect(clientQueryMock).not.toHaveBeenCalled();
    wire('usd');
    expect((await add({ payout: '1', currency: 'USD' })).status).toBe(201);
  });

  it('bad payout / revenue formats → 422 with a field error (not a DB 22P02); nothing written', async () => {
    wire('EUR');
    const bad: [string, unknown][] = [
      ['payout', 'abc'], ['payout', '1.23456'], ['payout', '12345678901'], ['payout', '-1'], ['payout', '1,50'],
      ['payout', ''], ['payout', '1e3'], ['revenue', '-0.5'], ['revenue', 'NaN'], ['revenue', '0x10'],
    ];
    for (const [field, value] of bad) {
      const res = await add({ [field]: value });
      expect([field, value, res.status]).toEqual([field, value, 422]);
      expect(res.body.error.code).toBe('validation_failed');
      expect(res.body.error.details[field]?.length).toBeGreaterThan(0);
    }
    const neg = await add({ payout: '-1' });
    expect(neg.body.error.details.payout).toEqual(['payout must not be negative']);
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it('valid edge amounts are normalised to 4 dp (0, max numeric(14,4), JSON number, null)', async () => {
    wire('EUR');
    for (const [payout, stored] of [['0', '0.0000'], ['9999999999.9999', '9999999999.9999'], [2.5, '2.5000'], [null, null]] as const) {
      clientQueryMock.mockClear();
      const res = await add({ payout });
      expect(res.status).toBe(201);
      expect(conv()[0]![8]).toBe(stored);
    }
  });
});
