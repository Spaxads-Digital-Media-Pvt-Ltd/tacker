/**
 * Only an active partner of the network can earn — on a real Postgres + Redis (INTEGRATION_DB=1, as
 * in CI) — audit F-08.
 *
 * /click checks the partner's status (Redis load-through cache): a pending, inactive or unknown
 * pub_id is dropped from the click (the visitor is still redirected), so no conversion on it ever
 * credits that id. A partner who stops being active after the click has its conversions held in
 * pending (reason partner_not_active) instead of auto-approved. Status writes bust the cache, so a
 * change applies on the next click.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { FastifyInstance } from 'fastify';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { query } from '../../src/lib/db/pool.js';
import { getQueue, QUEUE } from '../../src/surfaces/workers/queues.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('only active partners earn (live DB + Redis)', () => {
  let track: FastifyInstance;
  let dash: Express;
  let fx: Fixture;
  let host: string;
  let admin: { Authorization: string };

  const partner = async (status: 'active' | 'pending' | 'inactive') =>
    (await query<{ id: string; ref: string }>(
      `INSERT INTO publishers (network_id, name, status) VALUES ($1, $2, $3) RETURNING id, ref::text AS ref`,
      [fx.networkA, `F-08 ${status} ${randomUUID().slice(0, 6)}`, status])).rows[0]!;
  /** A click; returns the click id from the redirect (the visitor always lands on the offer). */
  const click = async (pubId: string, offerId = fx.offerA): Promise<string> => {
    const r = await track.inject({ method: 'GET', url: `/click?offer_id=${offerId}&pub_id=${pubId}`, headers: { host } });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toMatch(/^https:\/\/example\.com\//);
    return new URL(r.headers.location as string).pathname.split('/').pop()!;
  };
  const postback = async (clickId: string) => {
    const r = await track.inject({
      method: 'GET', url: `/postback?click_id=${clickId}&status=approved&txn_id=${randomUUID()}&secure_code=${fx.secureCodeA}`, headers: { host },
    });
    expect(r.statusCode).toBe(200);
    const { rows } = await query<{ conversion_id: string; publisher_id: string | null; status: string; reason: string | null }>(
      `SELECT conversion_id, publisher_id, status, reason FROM conversions WHERE network_id = $1 AND click_id = $2`, [fx.networkA, clickId]);
    expect(rows).toHaveLength(1);
    return rows[0]!;
  };
  const credits = async (pubId: string) => Number((await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM ledger_entries WHERE network_id = $1 AND account_type = 'publisher' AND account_id = $2`,
    [fx.networkA, pubId])).rows[0]!.n);
  /** A click from a partner that isn't active (D1): an invalid click, the visitor is diverted (no fallback → 204). */
  const rejectedClick = async (pubId: string, offerId = fx.offerA) => {
    const r = await track.inject({ method: 'GET', url: `/click?offer_id=${offerId}&pub_id=${pubId}`, headers: { host } });
    expect(r.statusCode).toBe(204); // never sent to the advertiser
  };
  /** The invalid clicks recorded for this network with that reason (the click-persist queue). */
  const rejected = async (reason: string) => (await getQueue(QUEUE.clickPersist).getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']))
    .map((j) => j?.data as { networkId: string; publisherId: string | null; fraudFlags: string[]; resolvedPayout: string; isUnique: boolean } | undefined)
    .filter((d): d is NonNullable<typeof d> => !!d && d.networkId === fx.networkA && d.fraudFlags.includes(reason));
  const setStatus = async (pubId: string, status: string) =>
    expect((await request(dash).patch(`/api/publishers/${pubId}`).set(admin).send({ status })).status).toBe(200);

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`pstatus-${randomUUID().slice(0, 8)}`);
    host = `pstatus-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    setHostResolver(new DbHostResolver());
    track = buildTrackingApp();
    await track.ready();
    dash = buildDashboardApp();
    admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA }));
  });

  it('active partner → unchanged: the conversion is theirs, approved, and credits them', async () => {
    const pub = await partner('active');
    const conv = await postback(await click(pub.id));
    expect(conv).toMatchObject({ publisher_id: pub.id, status: 'approved' });
    expect(await credits(pub.id)).toBe(1);
  });

  it('pending partner → an INVALID click (D1): recorded on them with the reason, never sent to the advertiser, no earning', async () => {
    const pub = await partner('pending');
    await rejectedClick(pub.id);
    const recorded = (await rejected('partner_pending')).filter((j) => j.publisherId === pub.id);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ resolvedPayout: '0.0000', isUnique: false });
    expect(await credits(pub.id)).toBe(0);
  });

  it('inactive partner, and a pending partner linked by numeric ref → the same', async () => {
    const inactive = await partner('inactive');
    await rejectedClick(inactive.id);
    expect((await rejected('partner_inactive')).some((j) => j.publisherId === inactive.id)).toBe(true);
    const pending = await partner('pending');
    await rejectedClick(pending.ref);
    expect((await rejected('partner_pending')).some((j) => j.publisherId === pending.id)).toBe(true);
    expect(await credits(inactive.id) + await credits(pending.id)).toBe(0);
  });

  it("a made-up pub_id, or another network's partner → an invalid click with no partner on it", async () => {
    const before = (await rejected('unknown_partner')).length;
    await rejectedClick(randomUUID());
    await rejectedClick(fx.pubB1);
    const after = await rejected('unknown_partner');
    expect(after.length - before).toBe(2);
    expect(after.every((j) => j.publisherId === null)).toBe(true);
  });

  it('a status change applies on the very next click (the dashboard busts the cache)', async () => {
    const pub = await partner('active');
    expect((await postback(await click(pub.id))).publisher_id).toBe(pub.id); // cached as active

    await setStatus(pub.id, 'inactive');
    await rejectedClick(pub.id); // D1: rejected from the very next click

    await setStatus(pub.id, 'active');
    expect((await postback(await click(pub.id))).publisher_id).toBe(pub.id);
    expect(await credits(pub.id)).toBe(2);
  });

  it('deactivated after the click → the conversion is held pending (partner_not_active), no credit until an admin approves', async () => {
    const pub = await partner('active');
    const clickId = await click(pub.id);
    await setStatus(pub.id, 'inactive');

    const conv = await postback(clickId);
    expect(conv).toMatchObject({ publisher_id: pub.id, status: 'pending', reason: 'partner_not_active' });
    expect(await credits(pub.id)).toBe(0);

    // An admin can still approve it deliberately — that books the ledger as usual.
    const ok = await request(dash).post(`/api/finance/conversions/${conv.conversion_id}/approve`).set(admin);
    expect(ok.status).toBe(200);
    expect(await credits(pub.id)).toBe(1);
  });

  it('deleted after the click → the conversion is held too', async () => {
    const pub = await partner('active');
    const clickId = await click(pub.id);
    expect((await request(dash).delete(`/api/publishers/${pub.id}`).set(admin)).status).toBe(200);
    const conv = await postback(clickId);
    expect(conv).toMatchObject({ status: 'pending', reason: 'partner_not_active' });
    expect(await credits(pub.id)).toBe(0);
  });

  it('private offer: a pending partner is rejected even if approved on the offer; once active they run it', async () => {
    const pub = await partner('pending');
    const { rows } = await query<{ id: string }>(
      `INSERT INTO offers (network_id, advertiser_id, name, status, visibility, destination_url, default_payout, default_revenue)
       VALUES ($1, $2, $3, 'active', 'private', 'https://example.com/private/{click_id}', 5.0000, 8.0000) RETURNING id`,
      [fx.networkA, fx.advA, `Private ${randomUUID().slice(0, 6)}`]);
    const offerId = rows[0]!.id;
    await query(
      `INSERT INTO offer_publisher_access (network_id, offer_id, publisher_id, access, approval_status) VALUES ($1, $2, $3, 'allow', 'approved')`,
      [fx.networkA, offerId, pub.id]);
    const r = await track.inject({ method: 'GET', url: `/click?offer_id=${offerId}&pub_id=${pub.id}`, headers: { host } });
    expect(r.statusCode).toBe(204); // diverted (no fallback URL)

    await setStatus(pub.id, 'active');
    const ok = await track.inject({ method: 'GET', url: `/click?offer_id=${offerId}&pub_id=${pub.id}`, headers: { host } });
    expect(ok.statusCode).toBe(302);
    expect(ok.headers.location).toMatch(/^https:\/\/example\.com\/private\//);
  });
});
