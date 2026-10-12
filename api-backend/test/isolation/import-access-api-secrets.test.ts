/**
 * Live-DB regression for:
 *   - Conversion Imports create rows: the named partner must be active and allowed on the offer by the
 *     /click rules (deny / private / request-access), else a per-row error with nothing written;
 *     "Manually Approve Conversions" makes a status-less OR explicitly approved row pending with no
 *     ledger (explicit pending / rejected kept); the offer's advertiser must be in the network.
 *   - Add Conversion (POST /api/offline/conversions): the same shared policy per request (400 / 422),
 *     ledger only when the stored status is approved; imports + Add Conversion are admin/manager only.
 *   - Public API (network / advertiser / publisher keys) never returns the offer postback securityCode
 *     (recursive key + value scan), while the session-authenticated dashboard still does.
 *   - Offer groups: an omitted currency is the network's default; explicit is honoured; invalid → 422.
 *
 * Runs only when INTEGRATION_DB=1 (requires a live Postgres with migrations applied).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { buildPublicApiApp } from '../../src/surfaces/public-api/app.js';
import { generateApiKey, AUDIENCE_SCOPES } from '../../src/lib/apikeys/keys.js';
import type { ApiAudience } from '../../src/middleware/types.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, resetDb, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, portalToken, bearer } from '../helpers/tokens.js';

const run = process.env.INTEGRATION_DB === '1';
const d = run ? describe : describe.skip;

const SECRET = `SC-${randomUUID()}`;
const SECRET_KEY = /secur|secret|token|passw|api.?key|private.?key|signature|credential/i;

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

d('conversion-import access rules, API-key offer secrets, offer-group currency (live DB)', () => {
  let app: Express;
  let pub: Express;
  let fx: Fixture;
  let auth: { Authorization: string };
  let offerPriv: string;
  let offerAsk: string;
  let offerManual: string;
  let pubInactive: string;
  let offerForeignAdv: string; // network A offer whose advertiser is network B's
  let offerB: string;          // network B offer

  const ref = async (table: 'offers' | 'publishers' | 'advertisers', id: string) =>
    (await query<{ ref: string }>(`SELECT ref::text AS ref FROM ${table} WHERE id = $1`, [id])).rows[0]!.ref;
  const mkOffer = async (name: string, visibility: string, metadata: Record<string, unknown> = {}) => (await query<{ id: string }>(
    `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, default_payout, default_revenue, visibility, metadata)
     VALUES ($1, $2, $3, 'active', 'https://example.com/{click_id}', 5, 8, $4, $5) RETURNING id`,
    [fx.networkA, fx.advA, name, visibility, JSON.stringify(metadata)])).rows[0]!.id;
  const grant = (offerId: string, publisherId: string, access: string, approval: string) => query(
    `INSERT INTO offer_publisher_access (network_id, offer_id, publisher_id, access, approval_status) VALUES ($1, $2, $3, $4, $5)`,
    [fx.networkA, offerId, publisherId, access, approval]);
  const imp = (rows: Record<string, string>[]) =>
    request(app).post('/api/conversion-imports').set(auth).send({ type: 'create', rows });
  const convOf = async (offerId: string, txn: string) => (await query<{ conversion_id: string; status: string; reason: string | null; publisher_id: string | null }>(
    `SELECT conversion_id, status, reason, publisher_id FROM conversions WHERE network_id = $1 AND offer_id = $2 AND transaction_id = $3`,
    [fx.networkA, offerId, txn])).rows[0];
  const ledgerCount = async (conversionId: string) => (await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM ledger_entries WHERE network_id = $1 AND conversion_id = $2`, [fx.networkA, conversionId])).rows[0]!.n;
  const txn = () => `T-${randomUUID().slice(0, 12)}`;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    await resetDb();
    fx = await seedFixture(`iaas-${randomUUID().slice(0, 8)}`); // unique slugs: robust to a concurrent seed
    app = buildDashboardApp();
    pub = buildPublicApiApp();
    auth = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
    offerPriv = await mkOffer('Private', 'private');
    offerAsk = await mkOffer('Ask', 'ask');
    offerManual = await mkOffer('Manual', 'public', { revenue_settings: { manualApproval: true } });
    await grant(offerPriv, fx.pubA1, 'allow', 'approved');
    await grant(offerAsk, fx.pubA1, 'allow', 'pending');
    await grant(fx.offerA, fx.pubA2, 'deny', 'approved');
    pubInactive = (await query<{ id: string }>(
      `INSERT INTO publishers (network_id, name, status) VALUES ($1, 'Inactive', 'inactive') RETURNING id`, [fx.networkA])).rows[0]!.id;
    offerForeignAdv = (await query<{ id: string }>(
      `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url) VALUES ($1, $2, 'Foreign adv', 'active', 'https://example.com') RETURNING id`,
      [fx.networkA, fx.advB])).rows[0]!.id;
    offerB = (await query<{ id: string }>(
      `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url) VALUES ($1, $2, 'Offer B', 'active', 'https://example.com') RETURNING id`,
      [fx.networkB, fx.advB])).rows[0]!.id;
  });

  describe('conversion imports', () => {
    it('a denied partner is a per-row error and nothing is written', async () => {
      const t = txn();
      const res = await imp([{ offerRef: fx.offerA, publisherRef: fx.pubA2, payout: '1', revenue: '2', transactionId: t }]);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ status: 'failed', total_processed: 0, error_count: 1 });
      expect(res.body.data.errors[0].message).toMatch(/is blocked on offer/);
      expect(await convOf(fx.offerA, t)).toBeUndefined();
    });

    it('a private offer without an approved grant is a per-row error (by uuid and by ref)', async () => {
      const t = txn();
      const res = await imp([
        { offerRef: offerPriv, publisherRef: fx.pubA2, payout: '1', transactionId: t },
        { offerRef: await ref('offers', offerPriv), publisherRef: await ref('publishers', fx.pubA2), payout: '1', transactionId: t },
        { offerRef: offerAsk, publisherRef: fx.pubA1, payout: '1', transactionId: t },
      ]);
      expect(res.body.data).toMatchObject({ total_processed: 0, error_count: 3 });
      expect(res.body.data.errors[0].message).toMatch(/not approved on private offer/);
      expect(res.body.data.errors[1].message).toMatch(/not approved on private offer/);
      expect(res.body.data.errors[2].message).toMatch(/not approved on request-access offer/);
      expect(await convOf(offerPriv, t)).toBeUndefined();
      expect(await convOf(offerAsk, t)).toBeUndefined();
    });

    it('an approved grant imports: approved, partner attributed, ledger written', async () => {
      const t = txn();
      const res = await imp([{ offerRef: offerPriv, publisherRef: fx.pubA1, payout: '1', revenue: '2', transactionId: t }]);
      expect(res.body.data).toMatchObject({ status: 'completed', total_processed: 1, error_count: 0 });
      const c = (await convOf(offerPriv, t))!;
      expect(c).toMatchObject({ status: 'approved', reason: null, publisher_id: fx.pubA1 });
      expect(await ledgerCount(c.conversion_id)).toBe(2);
    });

    it('an inactive partner, and another network\'s partner, are per-row errors', async () => {
      const t = txn();
      const res = await imp([
        { offerRef: fx.offerA, publisherRef: pubInactive, payout: '1', transactionId: t },
        { offerRef: fx.offerA, publisherRef: fx.pubB1, payout: '1', transactionId: t },
      ]);
      expect(res.body.data.errors).toEqual([
        { row: 1, message: `partner "${pubInactive}" is not active (status: inactive)` },
        { row: 2, message: `partner "${fx.pubB1}" not found` },
      ]);
      expect(await convOf(fx.offerA, t)).toBeUndefined();
    });

    it('manual-approval offer: no status column → pending, reason set, no ledger', async () => {
      const t = txn();
      const res = await imp([{ offerRef: offerManual, publisherRef: fx.pubA1, payout: '1', revenue: '2', transactionId: t }]);
      expect(res.body.data).toMatchObject({ total_processed: 1, error_count: 0 });
      const c = (await convOf(offerManual, t))!;
      expect(c).toMatchObject({ status: 'pending', reason: 'manual_approval_required' });
      expect(await ledgerCount(c.conversion_id)).toBe(0);
    });

    it('manual-approval offer: explicit approved → pending (reason, no ledger); explicit pending / rejected kept', async () => {
      const ta = txn();
      const tp = txn();
      const tr = txn();
      const res = await imp([
        { offerRef: offerManual, publisherRef: fx.pubA1, payout: '1', revenue: '2', transactionId: ta, status: 'Approved' },
        { offerRef: offerManual, publisherRef: fx.pubA1, payout: '1', revenue: '2', transactionId: tp, status: 'pending' },
        { offerRef: offerManual, payout: '1', revenue: '2', transactionId: tr, status: 'rejected' },
      ]);
      expect(res.body.data).toMatchObject({ total_processed: 3, error_count: 0 });
      const a = (await convOf(offerManual, ta))!;
      expect(a).toMatchObject({ status: 'pending', reason: 'manual_approval_required' });
      expect(await ledgerCount(a.conversion_id)).toBe(0);
      const p = (await convOf(offerManual, tp))!;
      expect(p).toMatchObject({ status: 'pending', reason: null });
      expect(await ledgerCount(p.conversion_id)).toBe(0);
      const r = (await convOf(offerManual, tr))!;
      expect(r).toMatchObject({ status: 'rejected', reason: null });
      expect(await ledgerCount(r.conversion_id)).toBe(0);
    });

    it('a normal offer still honours an explicit approved (ledger written)', async () => {
      const t = txn();
      await imp([{ offerRef: fx.offerA, publisherRef: fx.pubA1, payout: '1', revenue: '2', transactionId: t, status: 'approved' }]);
      const c = (await convOf(fx.offerA, t))!;
      expect(c).toMatchObject({ status: 'approved', reason: null });
      expect(await ledgerCount(c.conversion_id)).toBe(2);
    });

    it("no-partner rows: another network's offer, an offer whose advertiser is another network's, and a foreign advertiser column are per-row errors", async () => {
      const t = txn();
      const res = await imp([
        { offerRef: offerB, payout: '1', transactionId: t },
        { offerRef: offerForeignAdv, payout: '1', transactionId: t },
        { offerRef: fx.offerA, advertiserId: fx.advB, payout: '1', transactionId: t },
        { offerRef: fx.offerA, advertiserRef: await ref('advertisers', fx.advA), payout: '1', revenue: '2', transactionId: t },
      ]);
      expect(res.body.data.errors).toEqual([
        { row: 1, message: `offer "${offerB}" not found` },
        { row: 2, message: `offer "${offerForeignAdv}" has no advertiser in this network` },
        { row: 3, message: `advertiser "${fx.advB}" not found` },
      ]);
      expect(res.body.data).toMatchObject({ total_processed: 1, error_count: 3 });
      expect(await convOf(offerForeignAdv, t)).toBeUndefined();
      const c = (await convOf(fx.offerA, t))!;
      expect(c).toMatchObject({ status: 'approved', publisher_id: null });
      expect(await ledgerCount(c.conversion_id)).toBe(1); // advertiser billing only — no partner earning
      expect((await query(`SELECT 1 FROM conversions WHERE offer_id = $1`, [offerB])).rows).toHaveLength(0);
    });
  });

  describe('Add Conversion (POST /api/offline/conversions) — same policy', () => {
    const add = (body: Record<string, unknown>, headers = auth) =>
      request(app).post('/api/offline/conversions').set(headers).send({ payout: '1.5', revenue: '3', ...body });
    const conv = async (conversionId: string) => (await query<{ status: string; reason: string | null; publisher_id: string | null; advertiser_id: string; network_id: string }>(
      `SELECT status, reason, publisher_id, advertiser_id, network_id FROM conversions WHERE network_id = $1 AND conversion_id = $2`,
      [fx.networkA, conversionId])).rows[0];
    const manualCount = async () => (await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM conversions WHERE network_id = $1 AND source = 'manual'`, [fx.networkA])).rows[0]!.n;

    it('normal offer + allowed partner → approved with ledger; response is { conversionId }', async () => {
      const res = await add({ offerId: fx.offerA, publisherId: fx.pubA1, status: 'approved' });
      expect(res.status).toBe(201);
      expect(Object.keys(res.body.data)).toEqual(['conversionId']);
      expect(await conv(res.body.data.conversionId)).toMatchObject({ status: 'approved', reason: null, publisher_id: fx.pubA1, advertiser_id: fx.advA });
      expect(await ledgerCount(res.body.data.conversionId)).toBe(2);
    });

    it('manual-approval offer → pending + reason, no ledger (explicit approved and omitted status)', async () => {
      for (const extra of [{ status: 'approved' }, {}]) {
        const res = await add({ offerId: offerManual, publisherId: fx.pubA1, ...extra });
        expect(res.status).toBe(201);
        expect(await conv(res.body.data.conversionId)).toMatchObject({ status: 'pending', reason: 'manual_approval_required' });
        expect(await ledgerCount(res.body.data.conversionId)).toBe(0);
      }
      const r = await add({ offerId: offerManual, status: 'rejected' });
      expect(await conv(r.body.data.conversionId)).toMatchObject({ status: 'rejected', reason: null });
    });

    it('denied partner, private / request-access offer without approval, inactive partner → 422; nothing written', async () => {
      const before = await manualCount();
      const cases: [string, string, string][] = [
        [fx.offerA, fx.pubA2, 'partner_denied'],
        [offerPriv, fx.pubA2, 'partner_not_approved'],
        [offerAsk, fx.pubA1, 'partner_not_approved'],
        [fx.offerA, pubInactive, 'partner_inactive'],
      ];
      for (const [offerId, publisherId, reason] of cases) {
        const res = await add({ offerId, publisherId });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('validation_failed');
        expect(res.body.error.details).toEqual({ reason });
      }
      expect(await manualCount()).toBe(before);
    });

    it('approved grant on a private offer is allowed', async () => {
      const res = await add({ offerId: offerPriv, publisherId: fx.pubA1 });
      expect(res.status).toBe(201);
      expect(await conv(res.body.data.conversionId)).toMatchObject({ status: 'approved', publisher_id: fx.pubA1 });
    });

    it("cross-network offer / partner / offer advertiser → 400; nothing written", async () => {
      const before = await manualCount();
      const bad: [Record<string, unknown>, string][] = [
        [{ offerId: offerB }, 'offerId does not belong to this network'],
        [{ offerId: fx.offerA, publisherId: fx.pubB1 }, 'publisherId does not belong to this network'],
        [{ offerId: offerForeignAdv }, "The offer's advertiser does not belong to this network."],
      ];
      for (const [body, message] of bad) {
        const res = await add(body);
        expect([res.status, res.body.error.message]).toEqual([400, message]);
      }
      expect(await manualCount()).toBe(before);
      expect((await query(`SELECT 1 FROM conversions WHERE offer_id = $1`, [offerB])).rows).toHaveLength(0);
    });

    it('no partner still works for admins on a private offer (advertiser billing only)', async () => {
      const res = await add({ offerId: offerPriv, publisherId: null });
      expect(res.status).toBe(201);
      expect(await conv(res.body.data.conversionId)).toMatchObject({ status: 'approved', publisher_id: null });
      expect(await ledgerCount(res.body.data.conversionId)).toBe(1);
    });
  });

  describe('role guards', () => {
    it('finance / read_only operators and portal users get 403 on imports and Add Conversion; a manager may create', async () => {
      const before = (await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM conversions WHERE network_id = $1`, [fx.networkA])).rows[0]!.n;
      const denied = [
        bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'finance' })),
        bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'read_only' })),
        bearer(portalToken({ userId: randomUUID(), networkId: fx.networkA, kind: 'publisher', ownerId: fx.pubA1 })),
      ];
      for (const h of denied) {
        expect((await request(app).post('/api/conversion-imports').set(h).send({ type: 'create', rows: [{ offerRef: fx.offerA, payout: '1' }] })).status).toBe(403);
        expect((await request(app).post('/api/offline/conversions').set(h).send({ offerId: fx.offerA })).status).toBe(403);
      }
      const after = (await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM conversions WHERE network_id = $1`, [fx.networkA])).rows[0]!.n;
      expect(after).toBe(before);
      const mgr = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'manager' }));
      expect((await request(app).post('/api/offline/conversions').set(mgr).send({ offerId: fx.offerA })).status).toBe(201);
      const imp2 = await request(app).post('/api/conversion-imports').set(mgr).send({ type: 'create', rows: [{ offerRef: fx.offerA, payout: '1' }] });
      expect([imp2.status, imp2.body.data.total_processed]).toEqual([201, 1]);
    });
  });

  describe('Public API never returns the offer securityCode', () => {
    async function key(audience: ApiAudience, ownerId: string): Promise<string> {
      const k = generateApiKey(audience);
      await query(
        `INSERT INTO api_keys (network_id, audience, owner_id, key_prefix, key_hash, name, scopes) VALUES ($1, $2, $3, $4, $5, 'test', $6)`,
        [fx.networkA, audience, ownerId, k.prefix, k.keyHash, AUDIENCE_SCOPES[audience]]);
      return k.fullKey;
    }

    beforeAll(async () => {
      await query(`UPDATE offers SET security_code = $1 WHERE network_id = $2`, [SECRET, fx.networkA]);
    });

    it('the session-authenticated dashboard still shows it (offer edit / postback settings)', async () => {
      const res = await request(app).get(`/api/offers/${fx.offerA}`).set(auth);
      expect(res.status).toBe(200);
      expect(res.body.data.securityCode).toBe(SECRET);
    });

    it('network key: /offers (list, paged) carries no secret key or value at any depth', async () => {
      const k = await key('network', randomUUID());
      for (const qs of ['', '?limit=2&offset=1']) {
        const res = await request(pub).get(`/api/v1/network/offers${qs}`).set('X-Api-Key', k);
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBeGreaterThan(0);
        for (const o of res.body.data) expect(o).not.toHaveProperty('securityCode');
        expect(secretFindings(res.body)).toEqual([]);
        expect(JSON.stringify(res.body)).not.toContain(SECRET);
      }
      const all = await request(pub).get('/api/v1/network/offers?limit=200').set('X-Api-Key', k);
      expect(all.body.data.map((o: { id: string }) => o.id)).toEqual(expect.arrayContaining([fx.offerA, offerPriv, offerManual]));
      // Every other network-key read: no secrets either.
      for (const path of ['/publishers', '/advertisers', '/reports/summary', '/reports']) {
        const res = await request(pub).get(`/api/v1/network${path}`).set('X-Api-Key', k);
        expect(res.status).toBe(200);
        expect(secretFindings(res.body)).toEqual([]);
      }
    });

    it('advertiser and publisher keys: offers carry no secret either', async () => {
      const adv = await request(pub).get('/api/v1/advertiser/offers').set('X-Api-Key', await key('advertiser', fx.advA));
      expect(adv.status).toBe(200);
      expect(adv.body.data.length).toBeGreaterThan(0);
      expect(secretFindings(adv.body)).toEqual([]);
      const pubRes = await request(pub).get('/api/v1/publisher/offers').set('X-Api-Key', await key('publisher', fx.pubA1));
      expect(pubRes.status).toBe(200);
      expect(pubRes.body.data.length).toBeGreaterThan(0);
      expect(secretFindings(pubRes.body)).toEqual([]);
    });
  });

  describe('offer groups currency', () => {
    beforeAll(async () => {
      await query(`UPDATE networks SET default_currency = 'EUR' WHERE id = $1`, [fx.networkA]);
    });
    const create = (body: Record<string, unknown>) =>
      request(app).post('/api/offer-groups').set(auth).send({ name: `G-${randomUUID().slice(0, 6)}`, ...body });

    it("omitted currency → the network's default (stored and read back)", async () => {
      const res = await create({});
      expect(res.status).toBe(201);
      expect(res.body.data.currency).toBe('EUR');
      const got = await request(app).get(`/api/offer-groups/${res.body.data.id}`).set(auth);
      expect(got.body.data.currency).toBe('EUR');
    });

    it('an explicit currency is honoured', async () => {
      const res = await create({ currency: 'GBP' });
      expect(res.status).toBe(201);
      expect(res.body.data.currency).toBe('GBP');
    });

    it('an invalid currency is 422 (create and update) and nothing is stored', async () => {
      const before = (await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM offer_groups WHERE network_id = $1`, [fx.networkA])).rows[0]!.n;
      for (const currency of ['usd', 'EURO', 'U$D']) expect((await create({ currency })).status).toBe(422);
      const after = (await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM offer_groups WHERE network_id = $1`, [fx.networkA])).rows[0]!.n;
      expect(after).toBe(before);
      const g = await create({});
      expect((await request(app).patch(`/api/offer-groups/${g.body.data.id}`).set(auth).send({ currency: 'eur' })).status).toBe(422);
    });
  });
});
