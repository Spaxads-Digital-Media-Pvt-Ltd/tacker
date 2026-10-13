/**
 * Offers / Partners (publishers) / Advertisers — tenant isolation of every write path, related-id
 * ownership, malformed-vs-missing id handling, and optional contact/terms fields.
 *
 *  - A network can't list, read, edit or delete another network's records, and can't create or edit
 *    its own records pointing at another network's advertiser / user / channel / referrer / domain.
 *  - A malformed path id is the standard 422 validation envelope on every route; a well-formed id
 *    that doesn't exist and one that belongs to another network get the SAME 404 (no existence leak).
 *  - contactEmail / billingTerms / payoutTerms are optional (nullable columns, nullable API schema):
 *    a record created without them can be saved again with them still empty (the edit forms' payload).
 *
 * Runs only when INTEGRATION_DB=1 (requires a live Postgres with migrations applied).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { canConnect, resetDb, seedFixture, type Fixture } from '../helpers/db.js';
import { query } from '../../src/lib/db/pool.js';
import { operatorToken, bearer } from '../helpers/tokens.js';
import { MALFORMED_VALUE_MESSAGE } from '../../src/lib/http/errors.js';

const run = process.env.INTEGRATION_DB === '1';
const d = run ? describe : describe.skip;

const MISSING = '00000000-0000-4000-8000-000000000000';

async function insertId(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await query<{ id: string }>(sql, params);
  return rows[0]!.id;
}

d('Offers / Partners / Advertisers — integrity & tenant isolation (live DB)', () => {
  let app: Express;
  let fx: Fixture;
  let asA: Record<string, string>;
  let asB: Record<string, string>;
  // Related records owned by each network.
  let userA: string, userB: string, channelA: string, channelB: string, domainA: string, offerB: string;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    await resetDb();
    fx = await seedFixture();
    app = buildDashboardApp();
    asA = bearer(operatorToken({ userId: 'uA', networkId: fx.networkA }));
    asB = bearer(operatorToken({ userId: 'uB', networkId: fx.networkB }));
    userA = await insertId(`INSERT INTO users (network_id, email, role) VALUES ($1, 'a@example.com', 'manager') RETURNING id`, [fx.networkA]);
    userB = await insertId(`INSERT INTO users (network_id, email, role) VALUES ($1, 'b@example.com', 'manager') RETURNING id`, [fx.networkB]);
    channelA = await insertId(`INSERT INTO segmentation_channels (network_id, name) VALUES ($1, 'Channel A') RETURNING id`, [fx.networkA]);
    channelB = await insertId(`INSERT INTO segmentation_channels (network_id, name) VALUES ($1, 'Channel B') RETURNING id`, [fx.networkB]);
    domainA = await insertId(
      `INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, 'a-isolation.example.com', 'subdomain', 'active', 'verified') RETURNING id`,
      [fx.networkA]);
    offerB = await insertId(
      `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, default_payout, default_revenue)
       VALUES ($1, $2, 'Offer B', 'active', 'https://example.com/b', '1.00', '2.00') RETURNING id`,
      [fx.networkB, fx.advB]);
  });

  // ---------- Malformed ids: one 422 shape on every route ----------
  const malformed: [method: 'get' | 'patch' | 'delete', path: string][] = [
    ['get', '/api/offers/not-a-uuid'], ['patch', '/api/offers/not-a-uuid'], ['delete', '/api/offers/not-a-uuid'],
    ['get', '/api/publishers/123'], ['patch', '/api/publishers/123'], ['delete', '/api/publishers/123'],
    ['get', '/api/advertisers/zzz'], ['patch', '/api/advertisers/zzz'], ['delete', '/api/advertisers/zzz'],
  ];
  for (const [method, path] of malformed) {
    it(`malformed id → 422 validation envelope: ${method.toUpperCase()} ${path}`, async () => {
      const res = await request(app)[method](path).set(asB).send(method === 'patch' ? { name: 'x' } : undefined);
      expect(res.status).toBe(422);
      expect(res.body).toEqual({ ok: false, error: { code: 'validation_failed', message: MALFORMED_VALUE_MESSAGE } });
    });
  }

  it('malformed sub-resource ids → 422 (postback, event, asset, keys)', async () => {
    const paths = [
      ['patch', `/api/publishers/${fx.pubB1}/postbacks/nope`],
      ['delete', `/api/advertisers/${fx.advB}/events/nope`],
      ['delete', `/api/offers/${offerB}/goals/nope`],
      ['get', '/api/advertisers/nope/keys'],
    ] as const;
    for (const [method, path] of paths) {
      const res = await request(app)[method](path).set(asB).send(method === 'patch' ? { url: 'https://example.com' } : undefined);
      expect(res.status, path).toBe(422);
      expect(res.body.error.code, path).toBe('validation_failed');
    }
  });

  // ---------- Missing vs other-network ids: identical 404 (no existence leak) ----------
  const entities = [
    { name: 'offer', base: '/api/offers', otherNetworkId: () => fx.offerA },
    { name: 'publisher', base: '/api/publishers', otherNetworkId: () => fx.pubA1 },
    { name: 'advertiser', base: '/api/advertisers', otherNetworkId: () => fx.advA },
  ];
  for (const e of entities) {
    for (const method of ['get', 'patch', 'delete'] as const) {
      it(`${e.name}: ${method.toUpperCase()} of another network's id is the same 404 as a missing id`, async () => {
        const body = method === 'patch' ? { name: 'hijack' } : undefined;
        const missing = await request(app)[method](`${e.base}/${MISSING}`).set(asB).send(body);
        const foreign = await request(app)[method](`${e.base}/${e.otherNetworkId()}`).set(asB).send(body);
        expect(missing.status).toBe(404);
        expect(foreign.status).toBe(404);
        expect(foreign.body).toEqual(missing.body);
      });
    }
  }

  it("another network's records are untouched after the PATCH/DELETE attempts", async () => {
    const { rows } = await query<{ n: number }>(
      `SELECT (SELECT count(*) FROM offers WHERE id = $1 AND name <> 'hijack')::int
            + (SELECT count(*) FROM publishers WHERE id = $2 AND name <> 'hijack')::int
            + (SELECT count(*) FROM advertisers WHERE id = $3 AND name <> 'hijack')::int AS n`,
      [fx.offerA, fx.pubA1, fx.advA]);
    expect(rows[0]!.n).toBe(3);
  });

  it("lists (plain and paged) never include another network's records", async () => {
    for (const [path, idsA] of [
      ['/api/offers', [fx.offerA]], ['/api/publishers', [fx.pubA1, fx.pubA2]], ['/api/advertisers', [fx.advA]],
    ] as const) {
      const plain = await request(app).get(path).set(asB);
      expect(plain.status).toBe(200);
      const plainIds = (plain.body.data as { id: string }[]).map((r) => r.id);
      const paged = await request(app).get(`${path}?paged=1&page=1&pageSize=200`).set(asB);
      expect(paged.status).toBe(200);
      const pagedIds = (paged.body.data.rows as { id: string }[]).map((r) => r.id);
      for (const id of idsA) {
        expect(plainIds, path).not.toContain(id);
        expect(pagedIds, path).not.toContain(id);
      }
    }
  });

  // ---------- Related ids must belong to the caller's network ----------
  it("offer: can't be created or moved onto another network's advertiser or tracking domain", async () => {
    const base = { name: 'Cross offer', destinationUrl: 'https://example.com/x', defaultPayout: '1', defaultRevenue: '2' };
    const create = await request(app).post('/api/offers').set(asB).send({ ...base, advertiserId: fx.advA });
    expect(create.status).toBe(400);
    const move = await request(app).patch(`/api/offers/${offerB}`).set(asB).send({ advertiserId: fx.advA });
    expect(move.status).toBe(400);
    const domain = await request(app).patch(`/api/offers/${offerB}`).set(asB).send({ trackingDomainId: domainA });
    expect(domain.status).toBe(400);
    const { rows } = await query<{ advertiser_id: string; tracking_domain_id: string | null }>(`SELECT advertiser_id, tracking_domain_id FROM offers WHERE id = $1`, [offerB]);
    expect(rows[0]).toEqual({ advertiser_id: fx.advB, tracking_domain_id: null });
  });

  it("publisher: manager / account executive / channel / referrer from another network are rejected; own ones accepted", async () => {
    for (const body of [{ partnerManagerId: userA }, { accountExecutiveId: userA }, { channelId: channelA }, { referredById: fx.pubA1 }]) {
      const patch = await request(app).patch(`/api/publishers/${fx.pubB1}`).set(asB).send(body);
      expect(patch.status, JSON.stringify(body)).toBe(400);
      const create = await request(app).post('/api/publishers').set(asB).send({ name: 'Cross pub', ...body });
      expect(create.status, JSON.stringify(body)).toBe(400);
    }
    const own = await request(app).patch(`/api/publishers/${fx.pubB1}`).set(asB).send({ partnerManagerId: userB, channelId: channelB });
    expect(own.status).toBe(200);
    expect(own.body.data.channelId).toBe(channelB);
  });

  it("advertiser: account / sales manager from another network are rejected; own ones accepted", async () => {
    for (const body of [{ accountManagerId: userA }, { salesManagerId: userA }]) {
      const patch = await request(app).patch(`/api/advertisers/${fx.advB}`).set(asB).send(body);
      expect(patch.status, JSON.stringify(body)).toBe(400);
      const create = await request(app).post('/api/advertisers').set(asB).send({ name: 'Cross adv', ...body });
      expect(create.status, JSON.stringify(body)).toBe(400);
    }
    const own = await request(app).patch(`/api/advertisers/${fx.advB}`).set(asB).send({ accountManagerId: userB });
    expect(own.status).toBe(200);
  });

  // ---------- Optional contact / terms fields (records created without them stay editable) ----------
  it('advertiser created without contact email / billing terms can be saved with the edit form payload', async () => {
    const created = await request(app).post('/api/advertisers').set(asA).send({ name: 'No contact adv', status: 'active' });
    expect(created.status).toBe(201);
    expect(created.body.data.contactEmail).toBeNull();
    expect(created.body.data.billingTerms).toBeNull();
    // What AdvertiserEdit sends for blank fields: null (never "", which the email check rejects).
    const saved = await request(app).patch(`/api/advertisers/${created.body.data.id}`).set(asA)
      .send({ name: 'No contact adv (edited)', status: 'active', contactEmail: null, defaultCurrency: 'USD', billingTerms: null });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ name: 'No contact adv (edited)', contactEmail: null, billingTerms: null });
    const blankEmail = await request(app).post('/api/advertisers').set(asA).send({ name: 'Blank email', contactEmail: '' });
    expect(blankEmail.status).toBe(422);
  });

  it('publisher created without contact email / payout terms can be saved with the edit form payload', async () => {
    const created = await request(app).post('/api/publishers').set(asA).send({ name: 'No contact pub', status: 'active' });
    expect(created.status).toBe(201);
    expect(created.body.data.contactEmail).toBeNull();
    expect(created.body.data.payoutTerms).toBeNull();
    const saved = await request(app).patch(`/api/publishers/${created.body.data.id}`).set(asA)
      .send({ name: 'No contact pub (edited)', status: 'active', contactEmail: null, payoutTerms: null });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ name: 'No contact pub (edited)', contactEmail: null, payoutTerms: null });
  });
});
