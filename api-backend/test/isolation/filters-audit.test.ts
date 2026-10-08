/**
 * Filters audit — regression tests against a real Postgres (INTEGRATION_DB=1; the helpers refuse to
 * run unless the database name contains "test"). Each case pins one bug fixed in the audit.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { canConnect, resetDb, seedFixture, type Fixture } from '../helpers/db.js';
import { query } from '../../src/lib/db/pool.js';
import { operatorToken, bearer } from '../helpers/tokens.js';
import { assertSameNetwork } from '../../src/lib/db/ownership.js';

const run = process.env.INTEGRATION_DB === '1';
const d = run ? describe : describe.skip;

d('filters audit regressions (DB)', () => {
  let app: Express;
  let fx: Fixture;
  const asA = () => bearer(operatorToken({ userId: 'uA', networkId: fx.networkA }));
  const asB = () => bearer(operatorToken({ userId: 'uB', networkId: fx.networkB }));

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but the database is unreachable');
    await resetDb();
    fx = await seedFixture('filters');
    app = buildDashboardApp();
  });

  // ── Category / Channel catalogs (migration 065) ──────────────────────────────────────────
  it('publishers.channel_id now references the Control Center channel catalog; the duplicate tables are gone', async () => {
    const { rows } = await query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'publishers_channel_id_fkey'`);
    expect(rows[0]?.def).toContain('REFERENCES segmentation_channels(id)');
    const { rows: t } = await query<{ oc: string | null; pc: string | null }>(
      `SELECT to_regclass('offer_categories')::text AS oc, to_regclass('partner_channels')::text AS pc`);
    expect(t[0]).toEqual({ oc: null, pc: null });
  });

  it('the broken duplicate routes are unmounted (404, not 500)', async () => {
    expect((await request(app).get('/api/offer-categories').set(asA())).status).toBe(404);
    expect((await request(app).get('/api/partner-channels').set(asA())).status).toBe(404);
  });

  it('channel ownership guard rejects another network\'s channel', async () => {
    const created = await request(app).post('/api/control-center/channels').set(asB()).send({ name: 'Social B', status: 'active' });
    expect(created.status).toBe(201);
    await expect(assertSameNetwork(fx.networkA, 'segmentation_channels', created.body.data.id, 'channelId')).rejects.toThrow(/does not belong/);
    await expect(assertSameNetwork(fx.networkB, 'segmentation_channels', created.body.data.id, 'channelId')).resolves.toBeUndefined();
  });

  // ── Malformed input → 422, never 500 ─────────────────────────────────────────────────────
  it('a non-UUID path param is a 422 validation error (was a Postgres cast 500)', async () => {
    for (const path of ['/api/offers/not-a-uuid', '/api/advertisers/123', '/api/publishers/x', '/api/smart-links/nope']) {
      const res = await request(app).get(path).set(asA());
      expect([404, 422]).toContain(res.status);
      expect(res.status).not.toBe(500);
    }
    const res = await request(app).get('/api/offers/not-a-uuid').set(asA());
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('customer-value rule filters are validated — the old cycleDuration SQL injection is a 422', async () => {
    const bad = await request(app).get(`/api/customer-value/rules?cycleDuration=${encodeURIComponent("x' OR '1'='1")}`).set(asA());
    expect(bad.status).toBe(422);
    const ok = await request(app).get('/api/customer-value/rules?status=all&cycleDuration=continuous,monthly&metricType=number').set(asA());
    expect(ok.status).toBe(200);
  });

  it('report filters: bad ids/dates are 422; "excludeInvalid=false" is accepted', async () => {
    expect((await request(app).get('/api/reports?offerId=abc').set(asA())).status).toBe(422);
    expect((await request(app).get('/api/reports?from=2026-02-30').set(asA())).status).toBe(422);
    expect((await request(app).get('/api/reports?groupBy=offer&excludeInvalid=false').set(asA())).status).toBe(200);
  });

  // ── Tenant isolation through filters ─────────────────────────────────────────────────────
  it('filtering by another network\'s offer returns nothing (no leak) on reports and click logs', async () => {
    await query(
      `INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at) VALUES ($4, $1, $2, $3, now())`,
      // Unique per run: resetDb doesn't truncate clicks, so a fixed id collides on re-runs.
      [fx.networkA, fx.offerA, fx.pubA1, `filters-click-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
    );
    const mine = await request(app).get(`/api/reports?groupBy=offer&offerId=${fx.offerA}`).set(asA());
    expect(mine.status).toBe(200);
    expect(mine.body.data.rows.length).toBe(1);
    const theirs = await request(app).get(`/api/reports?groupBy=offer&offerId=${fx.offerA}`).set(asB());
    expect(theirs.body.data.rows).toEqual([]);
    const clicks = await request(app).get(`/api/reports/clicks?offerId=${fx.offerA}`).set(asB());
    expect(clicks.body.data).toEqual([]);
  });

  it('groupBy=none returns one exact grand-total row', async () => {
    const res = await request(app).get('/api/reports?groupBy=none&metrics=clicks').set(asA());
    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(1);
    expect(res.body.data.rows[0].metrics.clicks).toBeGreaterThanOrEqual(1);
  });

  // ── Silent 500-row ceilings ──────────────────────────────────────────────────────────────
  it('tags: re-using an existing tag past the 500th works (was a 409 from the unique index)', async () => {
    await query(
      `INSERT INTO tags (network_id, name) SELECT $1, 'bulk-tag-' || lpad(g::text, 4, '0') FROM generate_series(1, 600) g`,
      [fx.networkA],
    );
    const res = await request(app).post('/api/tags').set(asA()).send({ name: 'BULK-TAG-0599' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data.name).toBe('bulk-tag-0599');
    const list = await request(app).get('/api/tags').set(asA());
    expect(list.body.data.length).toBeGreaterThanOrEqual(600);
  });

  // ── Questionnaires expose offer ids for filtering ────────────────────────────────────────
  it('questionnaire list rows carry offerIds alongside offer names', async () => {
    const q = await request(app).post('/api/questionnaires').set(asA()).send({ name: 'Q filters', status: 'active', fields: [] });
    expect([200, 201]).toContain(q.status);
    await query(`UPDATE offers SET questionnaire_id = $1 WHERE id = $2`, [q.body.data.id, fx.offerA]);
    const list = await request(app).get('/api/questionnaires?status=all').set(asA());
    const row = list.body.data.find((r: { id: string }) => r.id === q.body.data.id);
    expect(row.offerIds).toEqual([fx.offerA]);
    expect(row.offers).toHaveLength(1);
  });
});
