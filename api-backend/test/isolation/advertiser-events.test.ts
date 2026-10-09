/**
 * Advertiser Details → Events. The tab was a static shell ("Not available yet"). Events are the
 * goals on the advertiser's offers ("Associated to" = offer), served advertiser-scoped at
 * /api/advertisers/:id/events and written through the same goal logic as /api/offers/:id/goals.
 *
 * Runs only when INTEGRATION_DB=1 (requires a live Postgres with migrations applied).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, resetDb, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const run = process.env.INTEGRATION_DB === '1';
const d = run ? describe : describe.skip;

d('Advertiser events (offer goals, advertiser-scoped)', () => {
  let app: Express;
  let fx: Fixture;
  let advA2: string;
  let offerA2: string;
  let offerB: string;
  let adminA: string;
  let adminB: string;
  let eventId = '';
  const base = () => `/api/advertisers/${fx.advA}/events`;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    await resetDb();
    fx = await seedFixture();
    advA2 = (await query<{ id: string }>(`INSERT INTO advertisers (network_id, name) VALUES ($1, 'Adv A2') RETURNING id`, [fx.networkA])).rows[0]!.id;
    offerA2 = (await query<{ id: string }>(
      `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, currency) VALUES ($1, $2, 'Offer A2', 'active', 'https://example.com', 'EUR') RETURNING id`,
      [fx.networkA, advA2])).rows[0]!.id;
    offerB = (await query<{ id: string }>(
      `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url) VALUES ($1, $2, 'Offer B', 'active', 'https://example.com') RETURNING id`,
      [fx.networkB, fx.advB])).rows[0]!.id;
    app = buildDashboardApp();
    adminA = operatorToken({ userId: 'u-admin-a', networkId: fx.networkA, role: 'admin' });
    adminB = operatorToken({ userId: 'u-admin-b', networkId: fx.networkB, role: 'admin' });
  });

  it('create → 201, stored as a goal on the associated offer', async () => {
    const res = await request(app).post(base()).set(bearer(adminA)).send({
      offerId: fx.offerA, name: 'Purchase', eventName: 'purchase', payout: '1.25', revenue: '2.50',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Purchase', eventName: 'purchase', offerId: fx.offerA, offerName: expect.stringContaining('Offer A'), status: 'active' });
    expect(res.body.data.createdAt).toBeTruthy();
    eventId = res.body.data.id;
    const row = (await query(`SELECT network_id, offer_id, payout::text, revenue::text, currency FROM offer_goals WHERE id = $1`, [eventId])).rows[0];
    expect(row).toEqual({ network_id: fx.networkA, offer_id: fx.offerA, payout: '1.2500', revenue: '2.5000', currency: 'USD' });
  });

  it('appears in the list and on a fresh GET; also visible as the offer\'s goal', async () => {
    const list = await request(app).get(base()).set(bearer(adminA));
    expect(list.status).toBe(200);
    expect(list.body.data.map((e: { id: string }) => e.id)).toEqual([eventId]);
    expect(list.body.pagination.total).toBe(1);
    const again = await request(app).get(base()).set(bearer(adminA));
    expect(again.body.data[0].id).toBe(eventId);
    const goals = await request(app).get(`/api/offers/${fx.offerA}/goals`).set(bearer(adminA));
    expect(goals.body.data.map((g: { id: string }) => g.id)).toContain(eventId);
  });

  it('defaults currency to the associated offer\'s currency', async () => {
    const res = await request(app).post(`/api/advertisers/${advA2}/events`).set(bearer(adminA)).send({ offerId: offerA2, name: 'Lead' });
    expect(res.status).toBe(201);
    expect(res.body.data.currency).toBe('EUR');
  });

  // validateBody's convention across the dashboard: 422 validation_error.
  it('invalid payloads → 422 validation error', async () => {
    const bad = async (body: object) => {
      const res = await request(app).post(base()).set(bearer(adminA)).send(body);
      expect(res.status).toBe(422);
      expect(res.body.ok).toBe(false);
    };
    await bad({ offerId: fx.offerA }); // name missing
    await bad({ name: 'x' }); // associated offer missing
    await bad({ offerId: 'conversion', name: 'x' }); // "Associated to" must be an offer, not a free-text type
    await bad({ offerId: fx.offerA, name: 'x', payout: 'abc' });
    await bad({ offerId: fx.offerA, name: '' });
  });

  it('duplicate event name on the same offer → 409 with a readable message', async () => {
    const res = await request(app).post(base()).set(bearer(adminA)).send({ offerId: fx.offerA, name: 'Dup', eventName: 'PURCHASE' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already has a goal\/event with that event name/);
  });

  it('cannot associate another advertiser\'s offer or another network\'s offer', async () => {
    expect((await request(app).post(base()).set(bearer(adminA)).send({ offerId: offerA2, name: 'x' })).status).toBe(400);
    expect((await request(app).post(base()).set(bearer(adminA)).send({ offerId: offerB, name: 'x' })).status).toBe(400);
  });

  it('unknown advertiser → 404, malformed id → 422', async () => {
    expect((await request(app).get('/api/advertisers/00000000-0000-4000-8000-0000000000ff/events').set(bearer(adminA))).status).toBe(404);
    expect((await request(app).get('/api/advertisers/82/events').set(bearer(adminA))).status).toBe(422);
  });

  it('another network cannot read, create, update or delete it', async () => {
    expect((await request(app).get(base()).set(bearer(adminB))).status).toBe(404);
    expect((await request(app).post(base()).set(bearer(adminB)).send({ offerId: fx.offerA, name: 'x' })).status).toBe(404);
    expect((await request(app).patch(`${base()}/${eventId}`).set(bearer(adminB)).send({ name: 'hacked' })).status).toBe(404);
    expect((await request(app).delete(`${base()}/${eventId}`).set(bearer(adminB))).status).toBe(404);
    // Via its own advertiser path, the id still resolves to nothing.
    expect((await request(app).patch(`/api/advertisers/${fx.advB}/events/${eventId}`).set(bearer(adminB)).send({ name: 'hacked' })).status).toBe(404);
    expect((await request(app).get(`/api/advertisers/${fx.advB}/events`).set(bearer(adminB))).body.data).toHaveLength(0);
  });

  it('another advertiser in the same network neither lists nor can modify it', async () => {
    const list = await request(app).get(`/api/advertisers/${advA2}/events`).set(bearer(adminA));
    expect(list.body.data.map((e: { id: string }) => e.id)).not.toContain(eventId);
    expect((await request(app).patch(`/api/advertisers/${advA2}/events/${eventId}`).set(bearer(adminA)).send({ name: 'x' })).status).toBe(404);
    expect((await request(app).delete(`/api/advertisers/${advA2}/events/${eventId}`).set(bearer(adminA))).status).toBe(404);
  });

  it('roles: read_only can list but not write', async () => {
    const ro = operatorToken({ userId: 'u-ro', networkId: fx.networkA, role: 'read_only' });
    expect((await request(app).get(base()).set(bearer(ro))).status).toBe(200);
    expect((await request(app).post(base()).set(bearer(ro)).send({ offerId: fx.offerA, name: 'x' })).status).toBe(403);
    expect((await request(app).patch(`${base()}/${eventId}`).set(bearer(ro)).send({ name: 'x' })).status).toBe(403);
    expect((await request(app).delete(`${base()}/${eventId}`).set(bearer(ro))).status).toBe(403);
  });

  it('update edits the event; moving it to another offer is refused', async () => {
    const res = await request(app).patch(`${base()}/${eventId}`).set(bearer(adminA)).send({ offerId: fx.offerA, name: 'Purchase v2', payout: '3' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: eventId, name: 'Purchase v2', payout: '3.0000', offerId: fx.offerA });
    const move = await request(app).patch(`${base()}/${eventId}`).set(bearer(adminA)).send({ offerId: offerA2 });
    expect(move.status).toBe(400);
    expect((await request(app).patch(`${base()}/not-a-uuid`).set(bearer(adminA)).send({ name: 'x' })).status).toBe(422);
  });

  it('delete removes it from the list and from the offer goals', async () => {
    expect((await request(app).delete(`${base()}/${eventId}`).set(bearer(adminA))).status).toBe(200);
    expect((await request(app).get(base()).set(bearer(adminA))).body.data).toHaveLength(0);
    expect((await query(`SELECT 1 FROM offer_goals WHERE id = $1`, [eventId])).rows).toHaveLength(0);
    expect((await request(app).delete(`${base()}/${eventId}`).set(bearer(adminA))).status).toBe(404);
  });

  it('audit log records the writes under the goal entity', async () => {
    const { rows } = await query<{ action: string }>(
      `SELECT action FROM audit_log WHERE network_id = $1 AND entity_id = $2 ORDER BY created_at`, [fx.networkA, eventId]);
    expect(rows.map((r) => r.action)).toEqual(['offer.goal.create', 'offer.goal.update', 'offer.goal.delete']);
  });
});
