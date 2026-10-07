/**
 * POST /api/offers with an optional Idempotency-Key (Redis SET NX, scoped to the network).
 * Regression for the duplicate "uj tet" offer (#199/#200): the same create submitted twice made
 * two offers. Needs Postgres + Redis, so it runs only when INTEGRATION_DB=1.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, resetDb, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const run = process.env.INTEGRATION_DB === '1';
const d = run ? describe : describe.skip;

d('POST /api/offers — Idempotency-Key', () => {
  let app: Express;
  let fx: Fixture;
  let adminA: string;
  let adminB: string;
  const body = (advertiserId: string, name: string) => ({
    advertiserId, name, destinationUrl: 'https://example.com/?c={click_id}', defaultPayout: '7', defaultRevenue: '10',
  });
  const countByName = async (name: string) => (await query<{ n: number }>(`SELECT count(*)::int n FROM offers WHERE name = $1`, [name])).rows[0]!.n;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    await resetDb();
    fx = await seedFixture();
    app = buildDashboardApp();
    adminA = operatorToken({ userId: 'u-admin-a', networkId: fx.networkA, role: 'admin' });
    adminB = operatorToken({ userId: 'u-admin-b', networkId: fx.networkB, role: 'admin' });
  });

  it('without the header, behaviour is unchanged (each POST creates an offer)', async () => {
    const a = await request(app).post('/api/offers').set(bearer(adminA)).send(body(fx.advA, 'no-key'));
    const b = await request(app).post('/api/offers').set(bearer(adminA)).send(body(fx.advA, 'no-key'));
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.data.id).not.toBe(b.body.data.id);
    expect(a.headers['idempotent-replayed']).toBeUndefined();
    expect(await countByName('no-key')).toBe(2);
  });

  it('a repeated request with the same key returns the original offer and creates nothing new', async () => {
    const key = randomUUID();
    const first = await request(app).post('/api/offers').set(bearer(adminA)).set('Idempotency-Key', key).send(body(fx.advA, 'uj tet'));
    const second = await request(app).post('/api/offers').set(bearer(adminA)).set('Idempotency-Key', key).send(body(fx.advA, 'uj tet'));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(await countByName('uj tet')).toBe(1);
  });

  it('concurrent duplicates cannot both create (exactly one offer)', async () => {
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 6 }, () =>
      request(app).post('/api/offers').set(bearer(adminA)).set('Idempotency-Key', key).send(body(fx.advA, 'concurrent'))));
    expect(await countByName('concurrent')).toBe(1);
    const created = results.filter((r) => r.status === 201);
    expect(created.length).toBeGreaterThanOrEqual(1);
    expect(new Set(created.map((r) => r.body.data.id)).size).toBe(1); // every success is the same offer
    for (const r of results) expect([201, 409]).toContain(r.status); // the rest: "already in progress"
  });

  it('reusing a key for a different request is rejected (422) and creates nothing', async () => {
    const key = randomUUID();
    expect((await request(app).post('/api/offers').set(bearer(adminA)).set('Idempotency-Key', key).send(body(fx.advA, 'fp-one'))).status).toBe(201);
    const other = await request(app).post('/api/offers').set(bearer(adminA)).set('Idempotency-Key', key).send(body(fx.advA, 'fp-two'));
    expect(other.status).toBe(422);
    expect(await countByName('fp-two')).toBe(0);
  });

  it('a failed create does not consume the key — the same key can be retried', async () => {
    const key = randomUUID();
    // Business-rule failure inside the create (another network's advertiser → 400).
    const bad = await request(app).post('/api/offers').set(bearer(adminA)).set('Idempotency-Key', key).send(body(fx.advB, 'retry-me'));
    expect(bad.status).toBe(400);
    const good = await request(app).post('/api/offers').set(bearer(adminA)).set('Idempotency-Key', key).send(body(fx.advA, 'retry-me'));
    expect(good.status).toBe(201);
    expect(good.headers['idempotent-replayed']).toBeUndefined();
    // Schema-validation failure never reaches the key at all.
    const key2 = randomUUID();
    expect((await request(app).post('/api/offers').set(bearer(adminA)).set('Idempotency-Key', key2).send({ name: 'x' })).status).toBe(422);
    expect((await request(app).post('/api/offers').set(bearer(adminA)).set('Idempotency-Key', key2).send(body(fx.advA, 'retry-me-2'))).status).toBe(201);
  });

  it('keys are scoped to the network: the same key in another network never returns the first network\'s offer', async () => {
    const key = randomUUID();
    const a = await request(app).post('/api/offers').set(bearer(adminA)).set('Idempotency-Key', key).send(body(fx.advA, 'scoped'));
    const b = await request(app).post('/api/offers').set(bearer(adminB)).set('Idempotency-Key', key).send(body(fx.advB, 'scoped'));
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body.data.id).not.toBe(a.body.data.id);
    expect(b.headers['idempotent-replayed']).toBeUndefined();
    const owners = (await query<{ network_id: string }>(`SELECT network_id FROM offers WHERE id = ANY($1)`, [[a.body.data.id, b.body.data.id]])).rows.map((r) => r.network_id).sort();
    expect(owners).toEqual([fx.networkA, fx.networkB].sort());
  });

  it('a malformed key is rejected (400)', async () => {
    const res = await request(app).post('/api/offers').set(bearer(adminA)).set('Idempotency-Key', 'x'.repeat(201)).send(body(fx.advA, 'bad-key'));
    expect(res.status).toBe(400);
    expect(await countByName('bad-key')).toBe(0);
  });
});
