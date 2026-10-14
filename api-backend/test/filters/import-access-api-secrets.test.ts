/**
 * PURE tests (pg pool + ledger + API-key rate limit mocked; no DB / Redis):
 *   1. Partner ↔ offer access rules (lib/offer-access) mirror /click steps 2b/2c.
 *   2. Conversion Imports create rows: partner must exist, be active and be allowed on the offer;
 *      the offer's advertiser (and any advertiser column) must be this network's / the offer's;
 *      "Manually Approve Conversions" makes a status-less OR explicitly approved row pending (no
 *      ledger); explicit pending / rejected are kept.
 *   2b. The shared manual-conversion policy (lib/offer-access/manual-conversion-policy.ts) truth
 *      table, and Add Conversion (POST /api/offline/conversions) applying it per request (400/422).
 *   2c. Role guards: POST imports / offline conversions are admin + manager only.
 *   3. Public API offer DTOs never carry the postback securityCode (or any secret-named key, at any
 *      depth) — network, advertiser and publisher keys.
 *   4. Offer groups: an omitted currency is the network's default; explicit is honoured; invalid → 422.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const queryMock = vi.fn();
const clientQueryMock = vi.fn();
vi.mock('../../src/lib/db/pool.js', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  pool: {
    query: (...a: unknown[]) => queryMock(...a),
    connect: async () => ({ query: (...a: unknown[]) => clientQueryMock(...a), release: () => undefined }),
  },
}));
const writeLedgerMock = vi.fn();
vi.mock('../../src/lib/ledger/ledger.js', () => ({
  writeConversionLedger: (...a: unknown[]) => writeLedgerMock(...a),
  rebalanceConversionLedger: vi.fn(),
  createPayoutRun: vi.fn(),
  accountBalance: vi.fn(async () => '0'),
}));
vi.mock('../../src/lib/apikeys/rate-limit.js', () => ({
  checkRateLimit: () => Promise.resolve({ allowed: true, limit: 600, remaining: 600 }),
}));

const { evaluatePublisherOfferAccess } = await import('../../src/lib/offer-access/publisher-access.js');
const { resolveManualConversionStatus, evaluateManualConversion } = await import('../../src/lib/offer-access/manual-conversion-policy.js');
const { offlineRoutes } = await import('../../src/surfaces/dashboard/offline/routes.js');
const { errorHandler } = await import('../../src/lib/http/envelope.js');
const { conversionImportsRoutes } = await import('../../src/surfaces/dashboard/conversion-imports/routes.js');
const { offerGroupsRoutes } = await import('../../src/surfaces/dashboard/offer-groups/routes.js');
const { toAdminDTO, toNetworkApiDTO } = await import('../../src/surfaces/dashboard/offers/dto.js');
const { buildPublicApiApp } = await import('../../src/surfaces/public-api/app.js');

const NET = '33333333-3333-4333-8333-333333333333';
const OFFER = '44444444-4444-4444-8444-444444444444';
const PUB = '55555555-5555-4555-8555-555555555555';
const ADV = '66666666-6666-4666-8666-666666666666';
const SECRET = 'SC-very-secret-postback-code-123';

function appFor(router: express.Router, identity: Record<string, unknown> = { kind: 'admin', role: 'admin' }): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { scope: unknown }).scope = { networkId: NET };
    (req as unknown as { identity: unknown }).identity = { surface: 'dashboard', userId: 'u1', networkId: NET, ...identity };
    next();
  });
  app.use('/', router);
  app.use(errorHandler);
  return app;
}

const sqlOf = (c: unknown[]) => String(c[0]).replace(/\s+/g, ' ');

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  writeLedgerMock.mockReset();
});

// ── 1. Access rules ──────────────────────────────────────────────────────────────────────────────
describe('evaluatePublisherOfferAccess (mirror of /click 2b/2c)', () => {
  const allowApproved = { access: 'allow', approvalStatus: 'approved' } as const;
  it('an explicit deny blocks on every visibility, whatever the approval status', () => {
    for (const v of ['public', 'private', 'ask']) {
      for (const s of ['approved', 'pending', 'rejected'] as const) {
        expect(evaluatePublisherOfferAccess(v, { access: 'deny', approvalStatus: s })).toBe('denied');
      }
    }
  });
  it('public offers run for any non-denied partner (no access row needed)', () => {
    expect(evaluatePublisherOfferAccess('public', null)).toBeNull();
    expect(evaluatePublisherOfferAccess(null, null)).toBeNull();
    expect(evaluatePublisherOfferAccess('public', { access: 'allow', approvalStatus: 'pending' })).toBeNull();
  });
  it('private / request-access offers need allow + approved', () => {
    for (const v of ['private', 'ask']) {
      expect(evaluatePublisherOfferAccess(v, null)).toBe('not_approved');
      expect(evaluatePublisherOfferAccess(v, { access: 'allow', approvalStatus: 'pending' })).toBe('not_approved');
      expect(evaluatePublisherOfferAccess(v, { access: 'allow', approvalStatus: 'rejected' })).toBe('not_approved');
      expect(evaluatePublisherOfferAccess(v, allowApproved)).toBeNull();
    }
  });
});

// ── 2. Conversion imports ────────────────────────────────────────────────────────────────────────
describe('conversion imports — partner access + approval default', () => {
  interface World {
    visibility?: string; manualApproval?: boolean;
    pubStatus?: string | null; // null → partner not found
    access?: { access: string; approval_status: string } | null;
    advInNetwork?: boolean;    // offers.advertiser_id is an advertiser of this network (default true)
    advLookup?: string | null; // id an advertiser-column lookup finds (null → not found)
  }
  function wire(w: World) {
    queryMock.mockImplementation(async (text: string, params: unknown[] = []) => {
      const sql = text.replace(/\s+/g, ' ');
      if (/FROM offers o JOIN networks n/.test(sql)) {
        expect(params[0]).toBe(NET);
        expect(sql).toMatch(/LEFT JOIN advertisers a ON a.id = o.advertiser_id AND a.network_id = o.network_id/);
        return { rows: [{ id: OFFER, advertiser_id: ADV, currency: 'USD', visibility: w.visibility ?? 'public',
          metadata: w.manualApproval ? { revenue_settings: { manualApproval: true } } : {}, advertiser_in_network: w.advInNetwork ?? true }] };
      }
      if (/FROM advertisers WHERE network_id/.test(sql)) {
        expect(params[0]).toBe(NET);
        return { rows: w.advLookup == null ? [] : [{ id: w.advLookup }] };
      }
      if (/FROM publishers WHERE network_id/.test(sql)) {
        expect(params[0]).toBe(NET);
        return { rows: w.pubStatus === null ? [] : [{ id: PUB, status: w.pubStatus ?? 'active' }] };
      }
      if (/FROM offer_publisher_access/.test(sql)) {
        expect(params).toEqual([NET, OFFER, PUB]);
        return { rows: w.access ? [w.access] : [] };
      }
      if (/INSERT INTO import_export_logs/.test(sql)) {
        return { rows: [{ id: 'job-1', status: params[7], total_processed: params[2], error_count: params[3], errors: JSON.parse(String(params[4])) }] };
      }
      if (/INSERT INTO audit_log/.test(sql)) return { rows: [{ id: 'audit-1' }] };
      return { rows: [], rowCount: 0 };
    });
    clientQueryMock.mockImplementation(async (text: string) =>
      (/INSERT INTO conversions/.test(text) ? { rows: [{ conversion_id: 'c1' }] } : { rows: [] }));
  }
  const post = (rows: Record<string, string>[]) =>
    request(appFor(conversionImportsRoutes())).post('/').send({ type: 'create', rows });
  const inserted = () => clientQueryMock.mock.calls.filter((c) => /INSERT INTO conversions/.test(sqlOf(c)));
  const row = { offerRef: '7', publisherRef: '9', payout: '1', revenue: '2', transactionId: 't1' };

  it('a partner explicitly denied on the offer is a per-row error; nothing is written', async () => {
    wire({ access: { access: 'deny', approval_status: 'approved' } });
    const res = await post([row]);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'failed', total_processed: 0, error_count: 1 });
    expect(res.body.data.errors).toEqual([{ row: 1, message: 'partner "9" is blocked on offer "7"' }]);
    expect(inserted()).toHaveLength(0);
    expect(writeLedgerMock).not.toHaveBeenCalled();
  });

  it('a private offer without an approved grant is a per-row error', async () => {
    wire({ visibility: 'private', access: null });
    const res = await post([row]);
    expect(res.body.data.errors).toEqual([{ row: 1, message: 'partner "9" is not approved on private offer "7"' }]);
    expect(inserted()).toHaveLength(0);
  });

  it('a request-access offer with a still-pending application is a per-row error', async () => {
    wire({ visibility: 'ask', access: { access: 'allow', approval_status: 'pending' } });
    const res = await post([row]);
    expect(res.body.data.errors).toEqual([{ row: 1, message: 'partner "9" is not approved on request-access offer "7"' }]);
  });

  it('an approved grant on a private offer imports (approved → ledger written)', async () => {
    wire({ visibility: 'private', access: { access: 'allow', approval_status: 'approved' } });
    const res = await post([row]);
    expect(res.body.data).toMatchObject({ status: 'completed', total_processed: 1, error_count: 0 });
    const ins = inserted();
    expect(ins).toHaveLength(1);
    const p = ins[0]![1] as unknown[];
    expect(p[4]).toBe(PUB);          // publisher_id
    expect(p[7]).toBe('approved');   // status
    expect(p[12]).toBeNull();        // reason
    expect(writeLedgerMock).toHaveBeenCalledTimes(1);
  });

  it('an inactive or pending partner is a per-row error; an unknown one still says not found', async () => {
    for (const s of ['inactive', 'pending']) {
      wire({ pubStatus: s });
      const res = await post([row]);
      expect(res.body.data.errors).toEqual([{ row: 1, message: `partner "9" is not active (status: ${s})` }]);
    }
    wire({ pubStatus: null });
    expect((await post([row])).body.data.errors).toEqual([{ row: 1, message: 'partner "9" not found' }]);
    expect(inserted()).toHaveLength(0);
  });

  it('manual-approval offer: a row without a status cell imports as pending, with no ledger write', async () => {
    wire({ manualApproval: true });
    const res = await post([row, { ...row, transactionId: 't2', status: '  ' }]);
    expect(res.body.data).toMatchObject({ total_processed: 2, error_count: 0 });
    for (const c of inserted()) {
      const p = c[1] as unknown[];
      expect(p[7]).toBe('pending');
      expect(p[12]).toBe('manual_approval_required');
    }
    expect(writeLedgerMock).not.toHaveBeenCalled();
  });

  it('manual-approval offer: an explicit "approved" cell cannot bypass it → pending, reason set, no ledger', async () => {
    wire({ manualApproval: true });
    const res = await post([{ ...row, status: 'Approved' }, { ...row, transactionId: 't2', status: 'approved' }]);
    expect(res.body.data).toMatchObject({ total_processed: 2, error_count: 0 });
    expect(inserted()).toHaveLength(2);
    for (const c of inserted()) {
      const p = c[1] as unknown[];
      expect(p[7]).toBe('pending');
      expect(p[12]).toBe('manual_approval_required');
    }
    expect(writeLedgerMock).not.toHaveBeenCalled();
  });

  it('manual-approval offer: explicit pending / rejected are kept as given (no reason, no ledger)', async () => {
    wire({ manualApproval: true });
    const res = await post([{ ...row, status: 'pending' }, { ...row, transactionId: 't2', status: 'REJECTED' }]);
    expect(res.body.data).toMatchObject({ total_processed: 2, error_count: 0 });
    const [p, r] = inserted().map((c) => c[1] as unknown[]);
    expect([p![7], p![12]]).toEqual(['pending', null]);
    expect([r![7], r![12]]).toEqual(['rejected', null]);
    expect(writeLedgerMock).not.toHaveBeenCalled();
  });

  it('without manual approval an explicit status is honoured (approved → ledger, rejected → none)', async () => {
    wire({});
    await post([{ ...row, status: 'approved' }, { ...row, transactionId: 't2', status: 'rejected' }]);
    expect(inserted().map((c) => (c[1] as unknown[])[7])).toEqual(['approved', 'rejected']);
    expect(writeLedgerMock).toHaveBeenCalledTimes(1);
  });

  it('an invalid status cell is a per-row error', async () => {
    wire({});
    const res = await post([{ ...row, status: 'paid' }]);
    expect(res.body.data.errors).toEqual([{ row: 1, message: 'status must be pending, approved or rejected (got "paid")' }]);
    expect(inserted()).toHaveLength(0);
  });

  it("an offer whose advertiser isn't in this network is a per-row error (with or without a partner)", async () => {
    wire({ advInNetwork: false });
    const { publisherRef: _p, ...noPub } = row;
    const res = await post([row, noPub]);
    expect(res.body.data).toMatchObject({ status: 'failed', total_processed: 0, error_count: 2 });
    expect(res.body.data.errors).toEqual([
      { row: 1, message: 'offer "7" has no advertiser in this network' },
      { row: 2, message: 'offer "7" has no advertiser in this network' },
    ]);
    expect(inserted()).toHaveLength(0);
    expect(writeLedgerMock).not.toHaveBeenCalled();
  });

  it("an advertiser column must be this network's advertiser AND the offer's", async () => {
    wire({ advLookup: null });
    expect((await post([{ ...row, advertiserRef: '12' }])).body.data.errors).toEqual([{ row: 1, message: 'advertiser "12" not found' }]);
    wire({ advLookup: 'other-adv' });
    expect((await post([{ ...row, advertiserId: '12' }])).body.data.errors)
      .toEqual([{ row: 1, message: 'advertiser "12" is not the advertiser of offer "7"' }]);
    expect(inserted()).toHaveLength(0);
    wire({ advLookup: ADV });
    const ok = await post([{ ...row, advertiser_ref: '12' }]);
    expect(ok.body.data).toMatchObject({ total_processed: 1, error_count: 0 });
    expect((inserted()[0]![1] as unknown[])[5]).toBe(ADV);
  });

  it('without manual approval a status-less row is approved (unchanged default)', async () => {
    wire({});
    await post([row]);
    expect((inserted()[0]![1] as unknown[])[7]).toBe('approved');
  });

  it('a row with no partner keeps working (no partner checks, no partner earning)', async () => {
    wire({ visibility: 'private' });
    const { publisherRef: _p, ...noPub } = row;
    const res = await post([noPub]);
    expect(res.body.data).toMatchObject({ total_processed: 1, error_count: 0 });
    expect(queryMock.mock.calls.some((c) => /offer_publisher_access|FROM publishers/.test(sqlOf(c)))).toBe(false);
    expect((inserted()[0]![1] as unknown[])[4]).toBeNull();
  });
});

// ── 2b. Shared policy + Add Conversion ───────────────────────────────────────────────────────────
describe('manual-conversion policy (shared by imports + Add Conversion)', () => {
  it('approval truth table: only an approval on a manual-approval offer is held back', () => {
    const R = 'manual_approval_required';
    const cases: [Parameters<typeof resolveManualConversionStatus>[0], boolean, string, string | null][] = [
      [undefined, false, 'approved', null],
      [undefined, true, 'pending', R],
      ['approved', false, 'approved', null],
      ['approved', true, 'pending', R],
      ['pending', false, 'pending', null],
      ['pending', true, 'pending', null],
      ['rejected', false, 'rejected', null],
      ['rejected', true, 'rejected', null],
    ];
    for (const [requested, manual, status, reason] of cases) {
      expect(resolveManualConversionStatus(requested, manual)).toEqual({ status, reason });
    }
  });

  it('evaluateManualConversion: no partner → no partner queries, policy status applied', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const offer = { id: OFFER, advertiserId: ADV, currency: 'USD', visibility: 'private', manualApproval: true, advertiserInNetwork: true };
    expect(await evaluateManualConversion({ networkId: NET, offer, offerLabel: '7', requestedStatus: 'approved' }))
      .toEqual({ ok: true, publisherId: null, status: 'pending', reason: 'manual_approval_required' });
    expect(queryMock).not.toHaveBeenCalled();
    expect(await evaluateManualConversion({ networkId: NET, offer: { ...offer, advertiserInNetwork: false }, offerLabel: '7' }))
      .toEqual({ ok: false, error: { code: 'advertiser_not_in_network', message: 'offer "7" has no advertiser in this network' } });
  });
});

describe('Add Conversion (POST /api/offline/conversions) — same policy, per-request errors', () => {
  interface W { visibility?: string; manualApproval?: boolean; offer?: boolean; advInNetwork?: boolean;
    pubStatus?: string | null; access?: { access: string; approval_status: string } | null }
  function wire(w: W) {
    queryMock.mockImplementation(async (text: string, params: unknown[] = []) => {
      const sql = text.replace(/\s+/g, ' ');
      if (/FROM offers o JOIN networks n/.test(sql)) {
        expect(params).toEqual([NET, OFFER]);
        return { rows: w.offer === false ? [] : [{ id: OFFER, advertiser_id: ADV, currency: 'EUR', visibility: w.visibility ?? 'public',
          metadata: w.manualApproval ? { revenue_settings: { manualApproval: true } } : {}, advertiser_in_network: w.advInNetwork ?? true }] };
      }
      if (/FROM publishers WHERE network_id/.test(sql)) {
        expect(params).toEqual([NET, PUB]);
        return { rows: w.pubStatus === null ? [] : [{ id: PUB, status: w.pubStatus ?? 'active' }] };
      }
      if (/FROM offer_publisher_access/.test(sql)) {
        expect(params).toEqual([NET, OFFER, PUB]);
        return { rows: w.access ? [w.access] : [] };
      }
      if (/INSERT INTO audit_log/.test(sql)) return { rows: [{ id: 'audit-1' }] };
      return { rows: [], rowCount: 0 };
    });
    clientQueryMock.mockImplementation(async () => ({ rows: [] }));
  }
  const add = (body: Record<string, unknown>, identity?: Record<string, unknown>) =>
    request(appFor(offlineRoutes(), identity)).post('/conversions').send({ offerId: OFFER, payout: '1.5', revenue: '3', ...body });
  const inserted = () => clientQueryMock.mock.calls.filter((c) => /INSERT INTO conversions/.test(sqlOf(c)));

  it('normal offer + allowed partner → approved, ledger written, response shape unchanged', async () => {
    wire({});
    const res = await add({ publisherId: PUB });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body.data)).toEqual(['conversionId']);
    const p = inserted()[0]![1] as unknown[];
    // No currency in the body → the offer's currency (EUR here), never a hard-coded USD.
    expect([p[3], p[4], p[5], p[7], p[10], p[12]]).toEqual([OFFER, PUB, ADV, 'approved', 'EUR', null]);
    expect(writeLedgerMock).toHaveBeenCalledTimes(1);
    expect(writeLedgerMock.mock.calls[0]![1]).toMatchObject({ networkId: NET, publisherId: PUB, advertiserId: ADV, currency: 'EUR' });
  });

  it('manual-approval offer: approved (explicit or omitted) → pending + reason, no ledger', async () => {
    for (const status of ['approved', undefined]) {
      wire({ manualApproval: true });
      clientQueryMock.mockClear();
      writeLedgerMock.mockClear();
      const res = await add({ publisherId: PUB, ...(status ? { status } : {}) });
      expect(res.status).toBe(201);
      const p = inserted()[0]![1] as unknown[];
      expect([p[7], p[12]]).toEqual(['pending', 'manual_approval_required']);
      expect(writeLedgerMock).not.toHaveBeenCalled();
    }
  });

  it('explicit rejected / pending are kept (no ledger)', async () => {
    wire({ manualApproval: true });
    await add({ status: 'rejected' });
    await add({ status: 'pending' });
    expect(inserted().map((c) => [(c[1] as unknown[])[7], (c[1] as unknown[])[12]])).toEqual([['rejected', null], ['pending', null]]);
    expect(writeLedgerMock).not.toHaveBeenCalled();
  });

  it('a denied partner, an unapproved partner on a private/ask offer and an inactive partner are 422; nothing written', async () => {
    const cases: [W, string, string][] = [
      [{ access: { access: 'deny', approval_status: 'approved' } }, 'partner_denied', 'This partner is blocked on this offer.'],
      [{ visibility: 'private', access: null }, 'partner_not_approved', 'This partner is not approved to run this private / request-access offer.'],
      [{ visibility: 'ask', access: { access: 'allow', approval_status: 'pending' } }, 'partner_not_approved', 'This partner is not approved to run this private / request-access offer.'],
      [{ pubStatus: 'inactive' }, 'partner_inactive', 'This partner is not active — only active partners can be credited with a conversion.'],
      [{ pubStatus: 'pending' }, 'partner_inactive', 'This partner is not active — only active partners can be credited with a conversion.'],
    ];
    for (const [w, reason, message] of cases) {
      wire(w);
      const res = await add({ publisherId: PUB });
      expect(res.status).toBe(422);
      expect(res.body.error).toEqual({ code: 'validation_failed', message, details: { reason } });
    }
    expect(inserted()).toHaveLength(0);
    expect(clientQueryMock).not.toHaveBeenCalled();
    expect(writeLedgerMock).not.toHaveBeenCalled();
  });

  it('cross-network offer / partner / advertiser are 400; nothing written', async () => {
    wire({ offer: false });
    let res = await add({ publisherId: PUB });
    expect([res.status, res.body.error.message]).toEqual([400, 'offerId does not belong to this network']);
    wire({ pubStatus: null });
    res = await add({ publisherId: PUB });
    expect([res.status, res.body.error.message]).toEqual([400, 'publisherId does not belong to this network']);
    wire({ advInNetwork: false });
    res = await add({});
    expect([res.status, res.body.error.message]).toEqual([400, "The offer's advertiser does not belong to this network."]);
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it('no partner still works for admins on a private offer (administrative record; advertiser billing only)', async () => {
    wire({ visibility: 'private' });
    const res = await add({ publisherId: null });
    expect(res.status).toBe(201);
    expect(queryMock.mock.calls.some((c) => /offer_publisher_access|FROM publishers/.test(sqlOf(c)))).toBe(false);
    expect((inserted()[0]![1] as unknown[])[4]).toBeNull();
    expect(writeLedgerMock.mock.calls[0]![1]).toMatchObject({ publisherId: null, advertiserId: ADV });
  });
});

// ── 2c. Role guards ──────────────────────────────────────────────────────────────────────────────
describe('role guards — creating conversions is admin/manager only', () => {
  const importBody = { type: 'create', rows: [{ offerRef: '7', payout: '1' }] };
  it('finance / read_only admins and portal users get 403 on imports and Add Conversion; nothing is read', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    for (const identity of [{ kind: 'admin', role: 'finance' }, { kind: 'admin', role: 'read_only' },
      { kind: 'publisher', ownerId: PUB }, { kind: 'advertiser', ownerId: ADV }]) {
      const imp = await request(appFor(conversionImportsRoutes(), identity)).post('/').send(importBody);
      expect(imp.status).toBe(403);
      const off = await request(appFor(offlineRoutes(), identity)).post('/conversions').send({ offerId: OFFER });
      expect(off.status).toBe(403);
    }
    expect(queryMock).not.toHaveBeenCalled();
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it('a manager may import and add conversions', async () => {
    queryMock.mockImplementation(async (text: string, params: unknown[] = []) => {
      const sql = text.replace(/\s+/g, ' ');
      if (/FROM offers o JOIN networks n/.test(sql)) {
        return { rows: [{ id: OFFER, advertiser_id: ADV, currency: 'USD', visibility: 'public', metadata: {}, advertiser_in_network: true }] };
      }
      if (/INSERT INTO import_export_logs/.test(sql)) return { rows: [{ id: 'job-1', status: params[7], total_processed: params[2] }] };
      return { rows: [{ id: 'audit-1' }] };
    });
    clientQueryMock.mockImplementation(async (text: string) =>
      (/INSERT INTO conversions/.test(text) ? { rows: [{ conversion_id: 'c1' }] } : { rows: [] }));
    const manager = { kind: 'admin', role: 'manager' };
    const imp = await request(appFor(conversionImportsRoutes(), manager)).post('/').send(importBody);
    expect([imp.status, imp.body.data.total_processed]).toEqual([201, 1]);
    const off = await request(appFor(offlineRoutes(), manager)).post('/conversions').send({ offerId: OFFER });
    expect(off.status).toBe(201);
  });
});

// ── 3. Public API secrets ────────────────────────────────────────────────────────────────────────
const SECRET_KEY = /secur|secret|token|passw|api.?key|private.?key|signature|credential/i;

/** Every key path (at any depth) whose name looks like a secret, plus any value equal to SECRET. */
function secretFindings(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => secretFindings(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
      ...(SECRET_KEY.test(k) ? [`${path}.${k}`] : []),
      ...secretFindings(v, `${path}.${k}`),
    ]);
  }
  return typeof value === 'string' && value.includes(SECRET) ? [`${path} (value)`] : [];
}

function offerRow(): Record<string, unknown> {
  return {
    id: OFFER, ref: 7, network_id: NET, advertiser_id: ADV, name: 'Offer', status: 'active',
    destination_url: 'https://adv.example/{click_id}', payout_model: 'CPA', default_payout: '1.0000',
    default_revenue: '2.0000', currency: 'USD', daily_conversion_cap: null, total_conversion_cap: null,
    daily_click_cap: null, attribution_window_s: 100, dedup_window_s: 100, allowed_traffic_types: [],
    fallback_url: null, objective: 'conversions', visibility: 'public', category: null, preview_url: null,
    security_code: SECRET, tracking_domain_id: null,
    metadata: { description: 'd', fire_partner_postback: true, revenue_settings: { manualApproval: true } },
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', effective_payout: '1.0000',
  };
}

describe('offer DTOs — securityCode never reaches API-key consumers', () => {
  it('the admin (dashboard) DTO keeps securityCode; the network API DTO drops it and nothing else', () => {
    const admin = toAdminDTO(offerRow() as never);
    expect(admin.securityCode).toBe(SECRET);
    const api = toNetworkApiDTO(offerRow() as never);
    expect('securityCode' in api).toBe(false);
    expect(secretFindings(api)).toEqual([]);
    const { securityCode: _s, ...rest } = admin;
    expect(api).toEqual(rest);
  });

  function wireApi(audience: 'network' | 'advertiser' | 'publisher') {
    queryMock.mockImplementation(async (text: string) => {
      const sql = text.replace(/\s+/g, ' ');
      if (/FROM api_keys/.test(sql)) {
        return { rows: [{ id: 'k1', network_id: NET, audience, owner_id: audience === 'publisher' ? PUB : ADV,
          scopes: ['offers:read'], rate_limit_tier: 'default', network_status: 'active' }], rowCount: 1 };
      }
      if (/FROM offers|JOIN offers/.test(sql)) return { rows: [offerRow()], rowCount: 1 };
      if (/INSERT INTO audit_log/.test(sql)) return { rows: [{ id: 'audit-1' }] };
      return { rows: [], rowCount: 0 };
    });
  }

  for (const audience of ['network', 'advertiser', 'publisher'] as const) {
    it(`GET /api/v1/${audience}/offers has no secret-named key or secret value anywhere`, async () => {
      wireApi(audience);
      const res = await request(buildPublicApiApp()).get(`/api/v1/${audience}/offers`).set('X-Api-Key', `${audience.slice(0, 3)}_live_abcd1234_xyz`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(OFFER);
      expect(secretFindings(res.body)).toEqual([]);
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    });
  }
});

// ── 4. Offer groups currency ─────────────────────────────────────────────────────────────────────
describe('offer groups — currency default', () => {
  function wire(networkCurrency: string | null) {
    queryMock.mockImplementation(async (text: string, params: unknown[] = []) => {
      const sql = text.replace(/\s+/g, ' ');
      if (/FROM networks WHERE id = \$1/.test(sql)) {
        expect(params).toEqual([NET]);
        return { rows: [{ default_currency: networkCurrency }] };
      }
      if (/INSERT INTO offer_groups/.test(sql)) {
        return { rows: [{ id: 'g1', ref: '1', name: 'G', advertiser_id: null, offer_ids: [], currency: insertedCurrency(sql, params),
          labels: null, notes: null, status: 'active', caps_enabled: false, caps: {}, created_at: 'x', updated_at: 'x' }] };
      }
      if (/INSERT INTO audit_log/.test(sql)) return { rows: [{ id: 'audit-1' }] };
      return { rows: [], rowCount: 0 };
    });
  }
  function insertedCurrency(sql: string, params: unknown[]): unknown {
    const cols = /\(([^)]*)\) VALUES/.exec(sql)![1]!.split(',').map((c) => c.trim().replace(/"/g, ''));
    return params[cols.indexOf('currency')];
  }
  const create = (body: Record<string, unknown>) => request(appFor(offerGroupsRoutes())).post('/').send({ name: 'G', ...body });

  it("omitted currency → the network's default currency", async () => {
    wire('EUR');
    const res = await create({});
    expect(res.status).toBe(201);
    expect(res.body.data.currency).toBe('EUR');
  });

  it("falls back to USD only when the network has no default", async () => {
    wire(null);
    expect((await create({})).body.data.currency).toBe('USD');
  });

  it('an explicit currency is honoured (no network lookup)', async () => {
    wire('EUR');
    const res = await create({ currency: 'GBP' });
    expect(res.status).toBe(201);
    expect(res.body.data.currency).toBe('GBP');
    expect(queryMock.mock.calls.some((c) => /FROM networks/.test(sqlOf(c)))).toBe(false);
  });

  it('an invalid currency is 422 on create and update', async () => {
    wire('EUR');
    for (const currency of ['usd', 'US', 'EURO', '12$', '']) {
      const res = await create({ currency });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('validation_failed');
    }
    const patch = await request(appFor(offerGroupsRoutes())).patch('/g1').send({ currency: 'eur' });
    expect(patch.status).toBe(422);
    expect(queryMock.mock.calls.some((c) => /INSERT INTO offer_groups|UPDATE offer_groups/.test(sqlOf(c)))).toBe(false);
  });
});
