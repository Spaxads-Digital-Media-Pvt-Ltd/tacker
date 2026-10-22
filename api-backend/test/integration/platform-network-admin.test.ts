/**
 * Super Admin › networks admin — live DB (INTEGRATION_DB=1); Slack's HTTP faked.
 *
 * - Plan overrides: a custom price on the first invoice and on renewal; billing exempt → never invoiced, MRR 0;
 *   limit overrides (a number replaces, null removes) in usage vs limits.
 * - Bulk actions: per-action permission, each network on its own (deleted ones refused), scope.
 * - A custom 'assigned' role with networks:full can't touch networks outside its scope (the single routes).
 * - Reports: networks / usage / growth as JSON and CSV.
 * - Slack: only a Slack webhook; never returned; events post (and an event switched off doesn't).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

const slack = vi.hoisted(() => ({ posts: [] as { url: string; text: string }[], status: 200 }));
vi.mock('../../src/lib/net/safe-http.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/net/safe-http.js')>();
  return {
    ...actual,
    safeRequest: async (url: string, opts: { body?: string }) => {
      if (url.startsWith('https://hooks.slack.com/')) { slack.posts.push({ url, text: JSON.parse(opts.body ?? '{}').text }); return { status: slack.status, body: slack.status === 200 ? 'ok' : 'invalid_token' }; }
      return actual.safeRequest(url, opts as never);
    },
  };
});

import { buildPlatformAdminApp } from '../../src/surfaces/platform-admin/app.js';
import { query } from '../../src/lib/db/pool.js';
import { signPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { runBilling } from '../../src/lib/billing/engine.js';
import { canConnect, seedFixture } from '../helpers/db.js';
import { bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const OWNER = '00000000-0000-4000-a000-000000000001';
const SALES = '00000000-0000-4000-a000-000000000003';
const HOOK = 'https://hooks.slack.com/services/T000/B000/abcdefghijklmnop';

d('Super Admin › networks admin (live DB)', () => {
  let platform: Express;
  let owner: Record<string, string>;
  const T = randomUUID().slice(0, 8);
  const member = async (role: string) => {
    const id = randomUUID();
    await query(`INSERT INTO platform_admins (id, email, status, auth_provider, password_hash, role_id) VALUES ($1, $2, 'active', 'local', 'x', $3)`, [id, `na-${id.slice(0, 8)}@test.local`, role]);
    return { id, auth: bearer(await signPlatformAdminToken(id)) };
  };
  const network = async () => (await seedFixture(`na-${randomUUID().slice(0, 8)}`)).networkA;
  const plan = async (priceCents = 9900, limits: Record<string, number> = {}) => (await request(platform).post('/platform/plans').set(owner)
    .send({ code: `na-${randomUUID().slice(0, 8)}`, name: `Plan ${T}`, priceCents, limits })).body.data as { id: string };
  const invoices = async (networkId: string) => (await query<{ subtotal: string; status: string }>(
    'SELECT subtotal::text, status FROM platform_invoices WHERE network_id = $1 ORDER BY issued_at', [networkId])).rows;
  const waitForSlack = async (match: string) => vi.waitFor(() => { if (!slack.posts.some((p) => p.text.includes(match))) throw new Error(`no Slack post with "${match}"`); }, { timeout: 3000 });

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    platform = buildPlatformAdminApp();
    owner = (await member(OWNER)).auth;
  });
  // Slack stays off for every other test file sharing this database.
  afterAll(async () => { await query(`DELETE FROM platform_settings WHERE key = 'slack'`); });

  it('overrides: a custom price on the first invoice and on renewal; billing exempt; limits; MRR', async () => {
    const net = await network();
    const p = await plan(9900, { clicks: 1000, offers: 5 });
    const sales = await member(SALES);
    expect((await request(platform).put(`/platform/networks/${net}/overrides`).set(sales.auth).send({ price: '49.50', billingExempt: false, limits: {} })).status).toBe(403);
    expect((await request(platform).put(`/platform/networks/${net}/overrides`).set(owner).send({ price: '49.999', billingExempt: false, limits: {} })).status).toBe(422);
    const put = await request(platform).put(`/platform/networks/${net}/overrides`).set(owner).send({ price: '49.50', billingExempt: false, limits: { clicks: 5000, offers: null }, note: 'Launch deal' });
    expect(put.body.data).toMatchObject({ price: '49.50', billingExempt: false, limits: { clicks: 5000, offers: null }, note: 'Launch deal' });
    await request(platform).put(`/platform/networks/${net}/subscription`).set(owner).send({ planId: p.id, trialDays: 0 }).expect(200);
    expect((await invoices(net)).map((i) => i.subtotal)).toEqual(['49.50']);
    const detail = (await request(platform).get(`/platform/networks/${net}`).set(owner)).body.data;
    expect(detail.overrides).toMatchObject({ price: '49.50', note: 'Launch deal' });
    expect(detail.usage.limits.map((l: { key: string; limit: number }) => [l.key, l.limit])).toEqual([['clicks', 5000]]); // offers limit removed
    // MRR uses its own price.
    const report = (await request(platform).get('/platform/reports/networks').set(owner)).body.data.rows.find((r: { slug: string }) => r.slug === detail.slug);
    expect(report).toMatchObject({ price: '49.50', custom_price: true, billing_exempt: false, mrr: '49.50' });
    // Renewal at the custom price.
    await query(`UPDATE platform_invoices SET status = 'paid', paid_at = now(), paid_amount = total WHERE network_id = $1`, [net]);
    await query(`UPDATE subscriptions SET current_period_start = now() - interval '1 month' - interval '1 hour', current_period_end = now() - interval '1 hour' WHERE network_id = $1`, [net]);
    await runBilling();
    expect((await invoices(net)).map((i) => i.subtotal)).toEqual(['49.50', '49.50']);
    // Billing exempt: never invoiced, MRR 0; renewal rolls the period without an invoice.
    await request(platform).put(`/platform/networks/${net}/overrides`).set(owner).send({ price: null, billingExempt: true, limits: {} }).expect(200);
    await query(`UPDATE subscriptions SET current_period_start = now() - interval '1 month' - interval '1 hour', current_period_end = now() - interval '1 hour' WHERE network_id = $1`, [net]);
    await runBilling();
    expect(await invoices(net)).toHaveLength(2);
    const after = (await request(platform).get('/platform/reports/networks').set(owner)).body.data.rows.find((r: { slug: string }) => r.slug === detail.slug);
    expect(after).toMatchObject({ billing_exempt: true, mrr: '0.00', price: '99.00' });
    // Saving nothing removes the override.
    expect((await request(platform).put(`/platform/networks/${net}/overrides`).set(owner).send({ price: null, billingExempt: false, limits: {} })).body.data).toBeNull();
    const fresh = await network();
    await request(platform).put(`/platform/networks/${fresh}/overrides`).set(owner).send({ price: null, billingExempt: true, limits: {} }).expect(200);
    await request(platform).put(`/platform/networks/${fresh}/subscription`).set(owner).send({ planId: p.id, trialDays: 0 }).expect(200);
    expect(await invoices(fresh)).toEqual([]);
  });

  it('bulk: suspend / activate (deleted refused), account manager, tag, plan; permission per action', async () => {
    const [a, b, gone] = [await network(), await network(), await network()];
    await query(`UPDATE networks SET status = 'deleted', deleted_at = now() WHERE id = $1`, [gone]);
    const sales = await member(SALES);
    expect((await request(platform).post('/platform/networks/bulk').set(sales.auth).send({ ids: [a], action: 'suspend' })).status).toBe(403);
    const s = await request(platform).post('/platform/networks/bulk').set(owner).send({ ids: [a, b, gone, randomUUID()], action: 'suspend' });
    expect(s.body.data.done).toBe(2);
    expect(s.body.data.failed.map((f: { id: string; error: string }) => f.error)).toEqual(['It’s deleted — restore it from its own page.', 'Network not found']);
    expect((await query(`SELECT status, suspended_reason FROM networks WHERE id = ANY($1::uuid[]) ORDER BY id`, [[a, b]])).rows).toEqual([{ status: 'suspended', suspended_reason: 'manual' }, { status: 'suspended', suspended_reason: 'manual' }]);
    expect((await request(platform).post('/platform/networks/bulk').set(owner).send({ ids: [a, b], action: 'activate' })).body.data.done).toBe(2);
    const am = await member('00000000-0000-4000-a000-000000000004');
    await request(platform).post('/platform/networks/bulk').set(owner).send({ ids: [a, b], action: 'account_manager', memberId: am.id }).expect(200);
    expect((await query(`SELECT COUNT(*)::int AS n FROM networks WHERE account_manager_id = $1`, [am.id])).rows[0]!.n).toBe(2);
    await request(platform).post('/platform/networks/bulk').set(owner).send({ ids: [a, b], action: 'add_tag', tag: 'Enterprise' }).expect(200);
    await request(platform).post('/platform/networks/bulk').set(owner).send({ ids: [a], action: 'add_tag', tag: 'enterprise' }).expect(200);
    expect((await query(`SELECT tags FROM network_accounts WHERE network_id = $1`, [a])).rows[0]!.tags).toEqual(['enterprise']);
    const p = await plan(0);
    expect((await request(platform).post('/platform/networks/bulk').set(owner).send({ ids: [a, b], action: 'plan', planId: p.id })).body.data).toEqual({ done: 2, failed: [] });
    expect((await request(platform).post('/platform/networks/bulk').set(owner).send({ ids: [a], action: 'plan' })).status).toBe(400);
  });

  it('an assigned-scope role with networks:full only touches its own networks', async () => {
    const role = (await query<{ id: string }>(
      `INSERT INTO platform_roles (key, name, scope, home, is_system, permissions)
       SELECT $1, 'Scoped ops', 'assigned', home, false, jsonb_set(permissions, '{networks}', '"full"') FROM platform_roles WHERE id = $2 RETURNING id`,
      [`na_${T}`, '00000000-0000-4000-a000-000000000004'])).rows[0]!.id;
    const scoped = await member(role);
    const [mine, theirs] = [await network(), await network()];
    await query('UPDATE networks SET account_manager_id = $2 WHERE id = $1', [mine, scoped.id]);
    expect((await request(platform).patch(`/platform/networks/${theirs}`).set(scoped.auth).send({ status: 'suspended' })).status).toBe(404);
    expect((await request(platform).delete(`/platform/networks/${theirs}`).set(scoped.auth)).status).toBe(404);
    expect((await request(platform).get(`/platform/networks/${theirs}/export`).set(scoped.auth)).status).toBe(404);
    expect((await query('SELECT status FROM networks WHERE id = $1', [theirs])).rows[0]!.status).toBe('active');
    expect((await request(platform).patch(`/platform/networks/${mine}`).set(scoped.auth).send({ status: 'suspended' })).status).toBe(200);
    const bulk = await request(platform).post('/platform/networks/bulk').set(scoped.auth).send({ ids: [mine, theirs], action: 'activate' });
    expect(bulk.body.data).toMatchObject({ done: 1, failed: [{ id: theirs, error: 'Network not found' }] });
    const rep = (await request(platform).get('/platform/reports/networks').set(scoped.auth)).body.data.rows;
    expect(rep.every((r: { account_manager: string | null }) => r.account_manager !== null)).toBe(true);
  });

  it('reports: usage over a range, growth by month; CSV downloads', async () => {
    const net = await network();
    await query(`INSERT INTO usage_records (network_id, metric, value, period_date) VALUES ($1, 'clicks', 120, '2026-01-05'), ($1, 'clicks', 30, '2026-01-20'), ($1, 'conversions', 4, '2026-01-20'), ($1, 'clicks', 999, '2026-03-01')
      ON CONFLICT (network_id, metric, period_date) DO UPDATE SET value = EXCLUDED.value`, [net]);
    const u = (await request(platform).get('/platform/reports/usage?from=2026-01-01&to=2026-01-31').set(owner)).body.data;
    const slug = (await query<{ slug: string }>('SELECT slug FROM networks WHERE id = $1', [net])).rows[0]!.slug;
    expect(u.rows.find((r: { slug: string }) => r.slug === slug)).toMatchObject({ clicks: '150', conversions: '4', events: '0' });
    expect((await request(platform).get('/platform/reports/usage?from=2026-02-01&to=2026-01-01').set(owner)).status).toBe(400);
    expect((await request(platform).get('/platform/reports/usage?from=2024-01-01&to=2026-01-01').set(owner)).status).toBe(400);
    const csv = await request(platform).get('/platform/reports/usage?from=2026-01-01&to=2026-01-31&format=csv').set(owner);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\n')[0]).toBe('ref,name,slug,status,plan,clicks,conversions,events');
    const g = (await request(platform).get('/platform/reports/growth?months=3').set(owner)).body.data.months;
    expect(g).toHaveLength(3);
    expect(g[0].month).toBe(new Date().toISOString().slice(0, 7));
    expect(g[0].created).toBeGreaterThanOrEqual(1);
    const support = await member('00000000-0000-4000-a000-000000000005');
    expect((await request(platform).get('/platform/reports/growth').set(support.auth)).status).toBe(403); // revenue: none
    const gcsv = await request(platform).get('/platform/reports/growth?months=2&format=csv').set(owner);
    expect(gcsv.text.split('\n')[0]).toMatch(/^month,created,deleted,live_at_end/);
  });

  it('Slack: a Slack webhook only, never returned; a test message; events post unless switched off', async () => {
    expect((await request(platform).put('/platform/settings/slack').set(owner).send({ enabled: true, webhookUrl: 'https://example.com/hook' })).status).toBe(422);
    expect((await request(platform).put('/platform/settings/slack').set(owner).send({ enabled: true, webhookUrl: null })).status).toBe(422);
    const saved = await request(platform).put('/platform/settings/slack').set(owner).send({ enabled: true, webhookUrl: HOOK, events: { invoicePaid: false } });
    expect(saved.body.data).toMatchObject({ enabled: true, hasWebhook: true, webhookHint: '…klmnop', events: { networkCreated: true, invoicePaid: false } });
    expect(JSON.stringify((await request(platform).get('/platform/settings/slack').set(owner)).body)).not.toContain('abcdefghij');
    slack.posts.length = 0;
    await request(platform).post('/platform/settings/slack/test').set(owner).expect(200);
    expect(slack.posts[0]).toMatchObject({ url: HOOK });
    slack.status = 403;
    expect((await request(platform).post('/platform/settings/slack/test').set(owner)).body.error.message).toContain('Slack answered 403');
    slack.status = 200;
    // A new network posts; an invoice paid doesn't (switched off).
    const created = await request(platform).post('/platform/networks').set(owner).send({ name: `Slacky <${T}>`, slug: `slacky-${T}` });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    await waitForSlack(`Slacky &lt;${T}&gt;`);
    expect(slack.posts.find((p) => p.text.includes('Slacky'))!.text).toContain(`/admin/networks/${created.body.data.id}|Open the network>`);
    const p = await plan(1000);
    await request(platform).put(`/platform/networks/${created.body.data.id}/subscription`).set(owner).send({ planId: p.id, trialDays: 0 }).expect(200);
    const inv = (await query<{ id: string }>('SELECT id FROM platform_invoices WHERE network_id = $1', [created.body.data.id])).rows[0]!;
    await request(platform).post(`/platform/invoices/${inv.id}/mark-paid`).set(owner).send({ method: 'bank_transfer' }).expect(200);
    await new Promise((r) => setTimeout(r, 300));
    expect(slack.posts.some((x) => x.text.includes('paid invoice'))).toBe(false);
    await request(platform).put('/platform/settings/slack').set(owner).send({ enabled: false }).expect(200);
    await query(`DELETE FROM platform_settings WHERE key = 'slack'`);
  });
});
