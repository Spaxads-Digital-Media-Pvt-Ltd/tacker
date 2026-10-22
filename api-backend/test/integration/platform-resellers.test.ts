/**
 * Super Admin › Resellers & white-label — live DB + Redis (INTEGRATION_DB=1).
 *
 *  - A reseller's networks and its monthly commission: paid platform invoices of its networks × its %.
 *  - Permissions: resellers:full changes, finance reads, support sees nothing.
 *  - White-label: the platform grants it; the network's admin sets brand / colour / domain; the domain is
 *    verified by its TXT record; the public brand endpoint answers for a verified domain of an active network
 *    only; a domain is one network's.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildPlatformAdminApp } from '../../src/surfaces/platform-admin/app.js';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { signPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { setTxtResolver } from '../../src/lib/tracking-domains/verify.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { bearer, operatorToken } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const ROLE = { owner: '00000000-0000-4000-a000-000000000001', support: '00000000-0000-4000-a000-000000000005', finance: '00000000-0000-4000-a000-000000000006' };

d('Super Admin › Resellers & white-label (live DB)', () => {
  let platform: Express;
  let dash: Express;
  let fx: Fixture;
  let owner: Record<string, string>;
  const T = randomUUID().slice(0, 8);
  const txt = new Map<string, string[]>();
  const member = async (role: string) => {
    const id = randomUUID();
    await query(`INSERT INTO platform_admins (id, email, status, auth_provider, password_hash, role_id) VALUES ($1, $2, 'active', 'local', 'x', $3)`,
      [id, `rs-${id.slice(0, 8)}@test.local`, role]);
    return bearer(await signPlatformAdminToken(id));
  };
  const invoice = (networkId: string, amount: string, currency = 'USD', paidAt = new Date().toISOString()) => query(
    `INSERT INTO platform_invoices (number, network_id, description, currency, subtotal, total, status, due_at, suspend_at, paid_at, paid_amount, bill_to)
     VALUES ($1, $2, 'Plan', $3, $4, $4, 'paid', now(), now(), $5, $4, '{}')`, [`INV-${randomUUID().slice(0, 8)}`, networkId, currency, amount, paidAt]);

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`rs-${T}`);
    platform = buildPlatformAdminApp();
    dash = buildDashboardApp();
    owner = await member(ROLE.owner);
    setTxtResolver(async (name) => { const v = txt.get(name); if (!v) throw Object.assign(new Error('nf'), { code: 'ENOTFOUND' }); return [v]; });
  });
  afterAll(async () => {
    const { resolveTxt } = await import('node:dns/promises');
    setTxtResolver(resolveTxt);
  });

  it('a reseller, its networks and its monthly commission (paid invoices × %, per currency)', async () => {
    const created = await request(platform).post('/platform/resellers').set(owner).send({ name: `Agency ${T}`, contactEmail: 'Ops@Agency.example', commissionPct: '15' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ commissionPct: '15.00', contactEmail: 'ops@agency.example', status: 'active', networks: 0 });
    const id = created.body.data.id as string;
    expect((await request(platform).put(`/platform/networks/${fx.networkA}/reseller`).set(owner).send({ resellerId: id })).body.data).toEqual({ resellerId: id });
    await invoice(fx.networkA, '100.00');
    await invoice(fx.networkA, '33.33');
    await invoice(fx.networkA, '50.00', 'EUR');
    await invoice(fx.networkB, '999.00'); // not this reseller's network

    const detail = (await request(platform).get(`/platform/resellers/${id}`).set(owner)).body.data;
    expect(detail.networkList.map((n: { id: string }) => n.id)).toEqual([fx.networkA]);
    const month = new Date().toISOString().slice(0, 7);
    expect(detail.statement).toEqual([
      { month, currency: 'EUR', paid: '50.00', invoices: 1, commission: '7.50' },
      { month, currency: 'USD', paid: '133.33', invoices: 2, commission: '20.00' },
    ]);
    const list = (await request(platform).get('/platform/resellers').set(owner)).body.data;
    expect(list.find((r: { id: string }) => r.id === id)).toMatchObject({ networks: 1 });

    expect((await request(platform).post('/platform/resellers').set(owner).send({ name: 'Bad', commissionPct: '150' })).status).toBe(422);
    // Deleting a reseller leaves its networks running, reseller-less.
    expect((await request(platform).delete(`/platform/resellers/${id}`).set(owner)).status).toBe(200);
    expect((await query<{ reseller_id: string | null }>('SELECT reseller_id FROM networks WHERE id = $1', [fx.networkA])).rows[0]!.reseller_id).toBeNull();
  });

  it('permissions: finance reads, support sees nothing', async () => {
    const finance = await member(ROLE.finance);
    const support = await member(ROLE.support);
    expect((await request(platform).get('/platform/resellers').set(finance)).status).toBe(200);
    expect((await request(platform).post('/platform/resellers').set(finance).send({ name: 'x' })).status).toBe(403);
    expect((await request(platform).get('/platform/resellers').set(support)).status).toBe(403);
  });

  it('white-label: granted by the platform, set up by the network, domain verified, served publicly', async () => {
    const admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
    const domain = `dash-${T}.agency.example`;
    expect((await request(dash).get('/api/white-label').set(admin)).body.data).toMatchObject({ enabled: false, dashboardDomain: null });
    const refused = await request(dash).put('/api/white-label').set(admin).send({ brandName: 'Agency' });
    expect([refused.status, refused.body.error.details]).toEqual([403, { reason: 'white_label_not_enabled' }]);

    expect((await request(platform).put(`/platform/networks/${fx.networkA}/white-label`).set(owner).send({ enabled: true })).body.data.enabled).toBe(true);
    const saved = await request(dash).put('/api/white-label').set(admin).send({ brandName: 'Agency Track', primaryColor: '#1E3557', dashboardDomain: domain.toUpperCase(), hidePlatformBranding: true });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ brandName: 'Agency Track', dashboardDomain: domain, domainVerified: false, dnsRecord: { type: 'TXT', name: `_tracker-verify.${domain}` } });
    expect((await request(dash).get(`/api/public/brand?host=${domain}`)).status).toBe(404); // not verified yet

    expect((await request(dash).post('/api/white-label/verify').set(admin)).body.data).toMatchObject({ domainVerified: false, domainCheckResult: expect.stringMatching(/No TXT record/) });
    txt.set(`_tracker-verify.${domain}`, [saved.body.data.dnsRecord.value]);
    expect((await request(dash).post('/api/white-label/verify').set(admin)).body.data.domainVerified).toBe(true);
    const brand = await request(dash).get(`/api/public/brand?host=${domain.toUpperCase()}:443`);
    expect(brand.status).toBe(200);
    expect(brand.body.data).toMatchObject({ brandName: 'Agency Track', primaryColor: '#1E3557', hidePlatformBranding: true, networkSlug: expect.any(String) });

    // Another network can't take the domain; bad input is refused.
    expect((await request(platform).put(`/platform/networks/${fx.networkB}/white-label`).set(owner).send({ enabled: true, dashboardDomain: domain })).status).toBe(409);
    expect((await request(dash).put('/api/white-label').set(admin).send({ primaryColor: 'blue' })).status).toBe(422);
    expect((await request(dash).put('/api/white-label').set(admin).send({ dashboardDomain: 'not a host' })).status).toBe(422);
    // Revoked by the platform → the domain stops being branded at once.
    await request(platform).put(`/platform/networks/${fx.networkA}/white-label`).set(owner).send({ enabled: false });
    expect((await request(dash).get(`/api/public/brand?host=${domain}`)).status).toBe(404);
    // Read-only team members can't see the settings.
    const ro = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'read_only' }));
    expect((await request(dash).get('/api/white-label').set(ro)).status).toBe(403);
  });
});
