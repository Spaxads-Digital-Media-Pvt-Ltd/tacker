/**
 * Super Admin › Comms — live DB + Redis (INTEGRATION_DB=1): the help center (per audience), the changelog,
 * the public status page (components, incidents, their timeline) and email broadcasts (audience preview,
 * sent once through the platform email queue).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildPlatformAdminApp } from '../../src/surfaces/platform-admin/app.js';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { signPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { overallStatus } from '../../src/lib/platform/comms.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { bearer, operatorToken, portalToken } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const ROLE = { owner: '00000000-0000-4000-a000-000000000001', sales: '00000000-0000-4000-a000-000000000003' };

d('Super Admin › Comms (live DB)', () => {
  let platform: Express;
  let dash: Express;
  let fx: Fixture;
  let owner: Record<string, string>;
  const T = randomUUID().slice(0, 8);
  const member = async (role: string) => {
    const id = randomUUID();
    await query(`INSERT INTO platform_admins (id, email, status, auth_provider, password_hash, role_id) VALUES ($1, $2, 'active', 'local', 'x', $3)`, [id, `cm-${id.slice(0, 8)}@test.local`, role]);
    return bearer(await signPlatformAdminToken(id));
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`cm-${T}`);
    platform = buildPlatformAdminApp();
    dash = buildDashboardApp();
    owner = await member(ROLE.owner);
  });

  it('help center: each reader sees the published articles for their audience; views count; addresses are unique', async () => {
    const add = (body: Record<string, unknown>) => request(platform).post('/platform/help-articles').set(owner).send(body);
    expect((await add({ title: 'Staff guide', slug: `staff-${T}`, audience: 'staff', status: 'published', body: '# Hi' })).status).toBe(201);
    expect((await add({ title: 'Partner guide', slug: `partner-${T}`, audience: 'partner', status: 'published', category: 'Partners' })).status).toBe(201);
    expect((await add({ title: 'For all', slug: `all-${T}`, status: 'published' })).status).toBe(201);
    expect((await add({ title: 'Draft', slug: `draft-${T}`, audience: 'all' })).status).toBe(201);
    expect((await add({ title: 'Dup', slug: `all-${T}` })).status).toBe(409);
    expect((await add({ title: 'Bad', slug: 'Not A Slug' })).status).toBe(422);

    const staff = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'read_only' }));
    const partner = bearer(portalToken({ userId: randomUUID(), networkId: fx.networkA, kind: 'publisher', ownerId: fx.pubA1 }));
    // Other tests' articles may exist: keep this run's (the slug carries T).
    const all = async (h: Record<string, string>) => ((await request(dash).get('/api/help/articles').set(h)).body.data as { slug: string }[]).map((a) => a.slug).filter((s) => s.endsWith(T)).sort();
    expect(await all(staff)).toEqual([`all-${T}`, `staff-${T}`].sort());
    expect(await all(partner)).toEqual([`all-${T}`, `partner-${T}`].sort());
    expect(((await request(dash).get('/api/help/articles?q=Partner%20guide').set(partner)).body.data as { slug: string }[]).map((a) => a.slug)).toContain(`partner-${T}`);
    const art = await request(dash).get(`/api/help/articles/staff-${T}`).set(staff);
    expect(art.body.data).toMatchObject({ title: 'Staff guide', body: '# Hi' });
    expect((await request(dash).get(`/api/help/articles/staff-${T}`).set(partner)).status).toBe(404);
    expect((await query<{ views: number }>('SELECT views FROM help_articles WHERE slug = $1', [`staff-${T}`])).rows[0]!.views).toBe(1);
  });

  it('changelog: drafts stay hidden until published', async () => {
    const e = (await request(platform).post('/platform/changelog').set(owner).send({ title: `Faster reports ${T}`, kind: 'improved' })).body.data;
    const staff = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'read_only' }));
    const titles = async () => ((await request(dash).get('/api/help/changelog').set(staff)).body.data as { title: string }[]).map((x) => x.title);
    expect(await titles()).not.toContain(`Faster reports ${T}`);
    await request(platform).patch(`/platform/changelog/${e.id}`).set(owner).send({ status: 'published' }).expect(200);
    expect(await titles()).toContain(`Faster reports ${T}`);
  });

  it('status page: incidents set the overall state; updates build the timeline; resolved moves to history', async () => {
    const comp = (await request(platform).post('/platform/status/components').set(owner).send({ name: `Tracking ${T}` })).body.data;
    const inc = await request(platform).post('/platform/status/incidents').set(owner).send({ title: `Slow redirects ${T}`, impact: 'major', componentIds: [comp.id], message: 'Looking into it.' });
    expect(inc.status).toBe(201);
    let page = (await request(dash).get('/api/public/status')).body.data;
    expect(page.incidents.find((i: { title: string }) => i.title === `Slow redirects ${T}`)).toMatchObject({ status: 'investigating', updates: [expect.objectContaining({ body: 'Looking into it.' })] });
    expect(['partial_outage', 'major_outage']).toContain(page.status);
    await request(platform).post(`/platform/status/incidents/${inc.body.data.id}/updates`).set(owner).send({ status: 'resolved', body: 'Fixed.' }).expect(201);
    page = (await request(dash).get('/api/public/status')).body.data;
    expect(page.incidents.find((i: { id: string }) => i.id === inc.body.data.id)).toBeUndefined();
    expect(page.history.find((i: { id: string }) => i.id === inc.body.data.id).updates.map((u: { body: string }) => u.body)).toEqual(['Fixed.', 'Looking into it.']);
    // Rollup rules (pure).
    expect(overallStatus([{ status: 'operational' }], [])).toBe('operational');
    expect(overallStatus([{ status: 'degraded' }], [{ impact: 'critical' }])).toBe('major_outage');
    expect(overallStatus([{ status: 'maintenance' }], [{ impact: 'minor' }])).toBe('degraded');
    await request(platform).delete(`/platform/status/components/${comp.id}`).set(owner).expect(200);
  });

  it('broadcasts: preview the audience, send once to active team members of matching networks', async () => {
    const admin = `bc-admin-${T}@example.com`;
    const fin = `bc-fin-${T}@example.com`;
    await query(`INSERT INTO users (network_id, auth_user_id, email, name, role, status) VALUES ($1, $2, $3, 'A', 'admin', 'active'), ($1, $4, $5, 'F', 'finance', 'active'), ($1, $6, $7, 'X', 'admin', 'disabled')`,
      [fx.networkA, randomUUID(), admin, randomUUID(), fin, randomUUID(), `bc-off-${T}@example.com`]);
    const audience = { roles: ['admin'], planIds: [], networkStatuses: ['active'] };
    const preview = (await request(platform).post('/platform/broadcasts/preview').set(owner).send({ audience })).body.data;
    expect(preview.recipients).toBeGreaterThanOrEqual(1);
    const b = (await request(platform).post('/platform/broadcasts').set(owner).send({ subject: `Maintenance ${T}`, body: 'Saturday 02:00 UTC.\n\nThanks!', audience })).body.data;
    const sent = await request(platform).post(`/platform/broadcasts/${b.id}/send`).set(owner);
    expect(sent.status).toBe(200);
    expect(sent.body.data.recipients).toBe(preview.recipients);
    const mails = (await query<{ recipient: string; network_id: string | null; html: string }>(
      `SELECT recipient, network_id, html FROM email_outbox WHERE event = 'platform_broadcast' AND subject = $1`, [`Maintenance ${T}`])).rows;
    expect(mails.map((m) => m.recipient)).toContain(admin);
    expect(mails.map((m) => m.recipient)).not.toContain(fin);
    expect(mails.map((m) => m.recipient)).not.toContain(`bc-off-${T}@example.com`);
    expect(mails[0]!.network_id).toBeNull();
    expect(mails[0]!.html).toContain('<p>Saturday 02:00 UTC.</p>');
    expect((await request(platform).post(`/platform/broadcasts/${b.id}/send`).set(owner)).status).toBe(409);
    expect((await request(platform).patch(`/platform/broadcasts/${b.id}`).set(owner).send({ subject: 'x' })).status).toBe(409);
  });

  it('permissions: sales can’t see comms', async () => {
    const sales = await member(ROLE.sales);
    expect((await request(platform).get('/platform/help-articles').set(sales)).status).toBe(403);
    expect((await request(platform).post('/platform/broadcasts').set(sales).send({ subject: 'x', body: 'y' })).status).toBe(403);
  });
});
