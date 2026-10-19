/**
 * Super Admin › Feature flags and announcements — on a real Postgres (INTEGRATION_DB=1).
 *
 * - No flag = on. A flag off for a network: /api/me features says so and its API refuses (403 feature_off);
 *   listed networks, plans, rollout and the kill switch decide; changes apply at once on this process.
 * - Announcements: drafts aren't shown; published ones reach their audience and kinds of people; dismissing
 *   hides them for that person; a non-dismissible one stays; a maintenance one needs its window.
 * - Roles: Sales can't see flags; Support writes announcements (comms:full); Finance can't.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildPlatformAdminApp } from '../../src/surfaces/platform-admin/app.js';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { signPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { hashPassword } from '../../src/lib/auth/platform-admin-password.js';
import { forgetFlags } from '../../src/lib/platform/flags.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { bearer, operatorToken, portalToken } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const ROLE = { owner: '00000000-0000-4000-a000-000000000001', sales: '00000000-0000-4000-a000-000000000003', support: '00000000-0000-4000-a000-000000000005', finance: '00000000-0000-4000-a000-000000000006' };

d('Super Admin › Feature flags & announcements (live DB)', () => {
  let platform: Express;
  let dash: Express;
  let fx: Fixture;
  let owner: Record<string, string>;
  let staffA: Record<string, string>;
  let staffB: Record<string, string>;
  const staff = async (roleId: string) => {
    const id = randomUUID();
    await query(`INSERT INTO platform_admins (id, email, status, auth_provider, password_hash, role_id) VALUES ($1, $2, 'active', 'local', $3, $4)`,
      [id, `fl-${id.slice(0, 8)}@test.local`, await hashPassword(`pw-${id}`), roleId]);
    return bearer(await signPlatformAdminToken(id));
  };
  const member = async (net: string) => {
    const auth = randomUUID();
    await query(`INSERT INTO users (network_id, auth_user_id, email, role, status) VALUES ($1, $2, $3, 'admin', 'active')`, [net, auth, `fl-${auth.slice(0, 6)}@n.test`]);
    return bearer(operatorToken({ userId: auth, networkId: net }));
  };
  const me = async (auth: Record<string, string>) => (await request(dash).get('/api/me').set(auth)).body.data as { features: Record<string, boolean>; announcements: { id: string; title: string }[] };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    await query(`DELETE FROM platform_feature_flags WHERE key = 'smartswitch'`);
    forgetFlags();
    fx = await seedFixture(`flags-${randomUUID().slice(0, 8)}`);
    platform = buildPlatformAdminApp();
    dash = buildDashboardApp();
    owner = await staff(ROLE.owner);
    staffA = await member(fx.networkA);
    staffB = await member(fx.networkB);
  });
  afterAll(async () => { await query(`DELETE FROM platform_feature_flags WHERE key = 'smartswitch'`); forgetFlags(); });

  it('flags: no flag = on; off refuses the API; listed / plan / rollout / kill switch', async () => {
    expect((await request(dash).get('/api/smartswitch/rules').set(staffA)).status).toBe(200);
    expect((await me(staffA)).features).not.toHaveProperty('smartswitch');

    const flag = await request(platform).post('/platform/flags').set(owner).send({ key: 'smartswitch', name: 'SmartSwitch' });
    expect(flag.status, JSON.stringify(flag.body)).toBe(201);
    const off = await request(dash).get('/api/smartswitch/rules').set(staffA);
    expect(off.status).toBe(403);
    expect(off.body.error).toMatchObject({ message: 'SmartSwitch isn’t enabled for your network. Contact the platform team to turn it on.', details: { reason: 'feature_off', feature: 'smartswitch' } });
    expect((await me(staffA)).features).toMatchObject({ smartswitch: false });

    const patch = (b: Record<string, unknown>) => request(platform).patch(`/platform/flags/${flag.body.data.id}`).set(owner).send(b);
    await patch({ networkIdsOn: [fx.networkA] });
    expect((await request(dash).get('/api/smartswitch/rules').set(staffA)).status).toBe(200);
    expect((await request(dash).get('/api/smartswitch/rules').set(staffB)).status).toBe(403);

    const plan = (await request(platform).post('/platform/plans').set(owner).send({ code: `fl-${randomUUID().slice(0, 6)}`, name: 'Flag plan', priceCents: 0 })).body.data;
    await request(platform).put(`/platform/networks/${fx.networkB}/subscription`).set(owner).send({ planId: plan.id });
    await patch({ planIds: [plan.id] });
    expect((await me(staffB)).features).toMatchObject({ smartswitch: true });

    await patch({ killSwitch: true });
    expect((await me(staffA)).features).toMatchObject({ smartswitch: false });
    expect((await me(staffB)).features).toMatchObject({ smartswitch: false });

    const list = (await request(platform).get('/platform/flags').set(owner)).body.data;
    expect(list.gateable.map((g: { key: string }) => g.key)).toContain('smartswitch');
    expect(list.flags.find((f: { key: string }) => f.key === 'smartswitch')).toMatchObject({ kill_switch: true, networks_on: 0 });
    await patch({ killSwitch: false, enabled: true, networkIdsOff: [fx.networkB] });
    const reach = (await request(platform).get(`/platform/flags/${flag.body.data.id}/networks`).set(owner)).body.data as { id: string; on: boolean }[];
    expect(reach.find((n) => n.id === fx.networkA)!.on).toBe(true);
    expect(reach.find((n) => n.id === fx.networkB)!.on).toBe(false);
    expect((await request(platform).delete(`/platform/flags/${flag.body.data.id}`).set(owner)).status).toBe(200);
    expect((await request(dash).get('/api/smartswitch/rules').set(staffB)).status).toBe(200);
  });

  it('announcements: audience, roles, dismissal, maintenance window', async () => {
    const t = randomUUID().slice(0, 6);
    const a = await request(platform).post('/platform/announcements').set(owner).send({ title: `New reports ${t}`, body: 'Cohort reports are live.' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect((await me(staffA)).announcements.map((x) => x.id)).not.toContain(a.body.data.id); // a draft
    await request(platform).post(`/platform/announcements/${a.body.data.id}/publish`).set(owner);
    expect((await me(staffA)).announcements.map((x) => x.id)).toContain(a.body.data.id);
    // Partners don't see a staff-only announcement.
    const partner = bearer(portalToken({ userId: randomUUID(), networkId: fx.networkA, kind: 'publisher', ownerId: fx.pubA1 }));
    const partnerMe = await request(dash).get('/api/me').set(partner);
    if (partnerMe.status === 200) expect((partnerMe.body.data.announcements as { id: string }[]).map((x) => x.id)).not.toContain(a.body.data.id);

    // Only network B.
    const onlyB = (await request(platform).post('/platform/announcements').set(owner).send({ title: `B only ${t}`, body: 'x', audience: 'networks', networkIds: [fx.networkB], dismissible: false })).body.data;
    await request(platform).post(`/platform/announcements/${onlyB.id}/publish`).set(owner);
    expect((await me(staffA)).announcements.map((x) => x.id)).not.toContain(onlyB.id);
    expect((await me(staffB)).announcements.map((x) => x.id)).toContain(onlyB.id);
    expect((await request(dash).post(`/api/announcements/${onlyB.id}/dismiss`).set(staffB)).status).toBe(409);

    expect((await request(dash).post(`/api/announcements/${a.body.data.id}/dismiss`).set(staffA)).status).toBe(200);
    expect((await me(staffA)).announcements.map((x) => x.id)).not.toContain(a.body.data.id);
    expect((await me(staffB)).announcements.map((x) => x.id)).toContain(a.body.data.id); // only that person
    expect((await request(platform).get('/platform/announcements').set(owner)).body.data.find((x: { id: string }) => x.id === a.body.data.id)).toMatchObject({ dismissals: 1, live: true });

    const noWindow = await request(platform).post('/platform/announcements').set(owner).send({ title: 'Maintenance', body: 'x', kind: 'maintenance' });
    expect(noWindow.status).toBe(400);
    expect(noWindow.body.error.message).toMatch(/needs its window/);
    const backwards = await request(platform).post('/platform/announcements').set(owner).send({ title: 'x', body: 'x', startsAt: '2030-01-02T00:00', endsAt: '2030-01-01T00:00' });
    expect(backwards.body.error.message).toMatch(/after “From”/);
    for (const id of [a.body.data.id, onlyB.id]) await request(platform).post(`/platform/announcements/${id}/archive`).set(owner);
    expect((await me(staffB)).announcements.map((x) => x.id)).not.toContain(onlyB.id);
  });

  it('roles: Sales can’t see flags; Support writes announcements; Finance can’t', async () => {
    expect((await request(platform).get('/platform/flags').set(await staff(ROLE.sales))).status).toBe(403);
    const sup = await staff(ROLE.support);
    const created = await request(platform).post('/platform/announcements').set(sup).send({ title: 'From support', body: 'x' });
    expect(created.status).toBe(201);
    expect((await request(platform).post('/platform/announcements').set(await staff(ROLE.finance)).send({ title: 'x', body: 'x' })).status).toBe(403);
    await request(platform).delete(`/platform/announcements/${created.body.data.id}`).set(sup);
  });
});
