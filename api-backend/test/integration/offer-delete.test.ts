/**
 * Deleting an offer never destroys tracking or financial history — on a real Postgres + Redis
 * (INTEGRATION_DB=1, as in CI) — audit F-09.
 *
 * An offer with clicks / conversions / ledger entries / reporting adjustments is ARCHIVED (status
 * 'archived': stops at /click, keeps its records and its name); `?hard=true` on it is a 409. Only an
 * offer that never ran can be removed: an unused draft on a plain DELETE, any unused offer with hard.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { FastifyInstance } from 'fastify';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('offer delete archives instead of destroying history (live DB)', () => {
  let dash: Express;
  let track: FastifyInstance;
  let fx: Fixture;
  let host: string;
  let admin: { Authorization: string };

  const offer = async (status: string) => (await query<{ id: string }>(
    `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, default_payout, default_revenue)
     VALUES ($1, $2, $3, $4, 'https://example.com/lp/{click_id}', 5, 8) RETURNING id`,
    [fx.networkA, fx.advA, `F-09 ${status} ${randomUUID().slice(0, 6)}`, status])).rows[0]!.id;
  const statusOf = async (id: string) =>
    (await query<{ status: string }>('SELECT status FROM offers WHERE id = $1', [id])).rows[0]?.status ?? null;
  const count = async (table: string, id: string) =>
    Number((await query<{ n: string }>(`SELECT COUNT(*) AS n FROM ${table} WHERE network_id = $1 AND offer_id = $2`, [fx.networkA, id])).rows[0]!.n);
  const del = (id: string, hard = false) => request(dash).delete(`/api/offers/${id}${hard ? '?hard=true' : ''}`).set(admin);

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`offerdel-${randomUUID().slice(0, 8)}`);
    host = `offerdel-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    setHostResolver(new DbHostResolver());
    track = buildTrackingApp();
    await track.ready();
    dash = buildDashboardApp();
    admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA }));
  });

  it('an offer with conversions is archived — records, ledger and name intact, and it stops running', async () => {
    const id = await offer('active');
    await query(`INSERT INTO offer_goals (network_id, offer_id, name) VALUES ($1, $2, 'Sale')`, [fx.networkA, id]);
    await query(`INSERT INTO offer_geo_rules (network_id, offer_id, country, action) VALUES ($1, $2, 'US', 'allow')`, [fx.networkA, id]);
    await query(`INSERT INTO reporting_adjustments (network_id, publisher_id, offer_id, date_from, date_to) VALUES ($1, $2, $3, '2026-10-01', '2026-10-01')`,
      [fx.networkA, fx.pubA1, id]);
    const conv = `conv-f09-${randomUUID().slice(0, 8)}`;
    await query(`INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, source, status) VALUES ($1, $2, 'k1', $3, $4, 'postback', 'approved')`,
      [conv, fx.networkA, id, fx.pubA1]);
    await query(`INSERT INTO ledger_entries (network_id, account_type, account_id, conversion_id, entry_type, direction, amount, currency, status, idempotency_key)
                 VALUES ($1, 'publisher', $2, $3, 'earning', 'credit', 5, 'USD', 'approved', $4)`, [fx.networkA, fx.pubA1, conv, `f09:${conv}`]);

    const res = await del(id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ deleted: false, archived: true, offer: { id, status: 'archived' } });
    expect(await statusOf(id)).toBe('archived');
    expect(await count('offer_goals', id)).toBe(1);
    expect(await count('offer_geo_rules', id)).toBe(1);
    expect(await count('reporting_adjustments', id)).toBe(1);
    expect(await count('conversions', id)).toBe(1);
    expect((await query('SELECT 1 FROM ledger_entries WHERE conversion_id = $1', [conv])).rows).toHaveLength(1);

    // Its name still resolves for reports, and it no longer runs.
    const got = await request(dash).get(`/api/offers/${id}`).set(admin);
    expect(got.status).toBe(200);
    expect(got.body.data.name).toMatch(/^F-09 active/);
    const click = await track.inject({ method: 'GET', url: `/click?offer_id=${id}&pub_id=${fx.pubA1}`, headers: { host } });
    expect(click.statusCode).toBe(204); // diverted (no fallback URL), never redirected to the offer

    const [audit] = (await query<{ action: string }>(`SELECT action FROM audit_log WHERE network_id = $1 AND entity_id = $2`, [fx.networkA, id])).rows;
    expect(audit?.action).toBe('offer.archive');
  });

  it('?hard=true on an offer with history is a 409 that names the history; nothing changes', async () => {
    const id = await offer('paused');
    await query(`INSERT INTO reporting_adjustments (network_id, publisher_id, offer_id, date_from, date_to) VALUES ($1, $2, $3, '2026-10-01', '2026-10-02')`,
      [fx.networkA, fx.pubA1, id]);
    const res = await del(id, true);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('This offer has tracking history (adjustments); archive it instead.');
    expect(await statusOf(id)).toBe('paused');
    expect(await count('reporting_adjustments', id)).toBe(1);
  });

  it('an offer with clicks only is history too', async () => {
    const id = await offer('active');
    const r = await track.inject({ method: 'GET', url: `/click?offer_id=${id}&pub_id=${fx.pubA1}`, headers: { host } });
    expect(r.statusCode).toBe(302);
    // The click is persisted asynchronously; write the row the worker would.
    await query(`INSERT INTO clicks (click_id, network_id, offer_id, publisher_id) VALUES ($1, $2, $3, $4)`,
      [randomUUID().replace(/-/g, ''), fx.networkA, id, fx.pubA1]);
    expect((await del(id, true)).status).toBe(409);
    expect((await del(id)).body.data).toMatchObject({ archived: true });
  });

  it('an unused draft is really removed; an unused live offer is archived unless hard is asked for', async () => {
    const draft = await offer('draft');
    const res = await del(draft);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: true, archived: false });
    expect(await statusOf(draft)).toBeNull();

    const live = await offer('active');
    expect((await del(live)).body.data).toMatchObject({ deleted: false, archived: true });
    expect(await statusOf(live)).toBe('archived');
    expect((await del(live, true)).body.data).toEqual({ deleted: true, archived: false });
    expect(await statusOf(live)).toBeNull();
  });

  it('only admins can delete or archive', async () => {
    const id = await offer('draft');
    const res = await request(dash).delete(`/api/offers/${id}`).set(bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'manager' })));
    expect(res.status).toBe(403);
    expect(await statusOf(id)).toBe('draft');
  });
});
