/**
 * Integration credentials and the SMTP password are masked and encrypted — on a real Postgres
 * (INTEGRATION_DB=1, as in CI) — audit F-07.
 *
 * GET /api/settings never returns a secret (only `<key>Set` / passwordSet) to any role; secrets are
 * stored AES-256-GCM-encrypted and only decrypted where they're used (IPQS, Facebook CAPI, the offer
 * feed, the mailer). A blank value on PUT keeps the stored secret. The network postback secure code
 * is only shown to admin/manager. Outbound calls are mocked; the values they'd carry are asserted.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { SafeRequestOptions } from '../../src/lib/net/safe-http.js';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { isEncrypted } from '../../src/lib/crypto/secret-box.js';
import { ipqsLookup } from '../../src/lib/integrations/ipqs.js';
import { sendFacebookCapiEvent } from '../../src/lib/integrations/facebook-capi.js';
import { syncOfferFeed } from '../../src/lib/integrations/offer-feed-sync.js';
import { sendNetworkEmail } from '../../src/lib/mailer.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const smtp = vi.hoisted(() => ({ transports: [] as { auth?: { user?: string; pass?: string } }[] }));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: (opts: { auth?: { user?: string; pass?: string } }) => {
      smtp.transports.push(opts);
      return { sendMail: async () => ({ messageId: 'test' }) };
    },
  },
}));
const feed = vi.hoisted(() => ({ calls: [] as { url: string; opts: SafeRequestOptions }[] }));
vi.mock('../../src/lib/net/safe-http.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/net/safe-http.js')>()),
  safeRequest: async (url: string, opts: SafeRequestOptions) => {
    feed.calls.push({ url, opts });
    return { status: 200, body: JSON.stringify([{ id: 'f-1', name: 'Feed offer', url: 'https://brand.example/lp' }]) };
  },
}));

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('settings secrets are masked and encrypted at rest (live DB)', () => {
  let dash: Express;
  let fx: Fixture;
  const as = (role: string, networkId = fx.networkA) => bearer(operatorToken({ userId: randomUUID(), networkId, role }));
  const stored = async (networkId: string) =>
    (await query<{ settings: Record<string, Record<string, unknown>> }>('SELECT settings FROM networks WHERE id = $1', [networkId])).rows[0]!.settings;
  const putIntegrations = (values: Record<string, unknown>, networkId = fx.networkA) =>
    request(dash).put('/api/settings/integrations').set(as('admin', networkId)).send({ values });

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`secrets-${randomUUID().slice(0, 8)}`);
    dash = buildDashboardApp();
  });
  beforeEach(() => {
    smtp.transports.length = 0;
    feed.calls.length = 0;
    vi.restoreAllMocks();
  });

  it('PUT an IPQS key → stored encrypted; GET returns ipQualityScoreApiKeySet:true and never the value', async () => {
    expect((await putIntegrations({ ipQualityScoreApiKey: 'ipqs-real-key-123' })).status).toBe(200);
    const raw = (await stored(fx.networkA))['integrations']!['ipQualityScoreApiKey'];
    expect(isEncrypted(raw)).toBe(true);
    expect(String(raw)).not.toContain('ipqs-real-key-123');

    for (const role of ['admin', 'read_only']) {
      const res = await request(dash).get('/api/settings').set(as(role));
      expect(res.status).toBe(200);
      expect(res.body.data.integrations.ipQualityScoreApiKeySet).toBe(true);
      expect(res.body.data.integrations).not.toHaveProperty('ipQualityScoreApiKey');
      expect(JSON.stringify(res.body)).not.toContain('ipqs-real-key-123');
    }
  });

  it('the IPQS loader decrypts and uses the real key', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, fraud_score: 12, proxy: true }), { status: 200 }));
    expect(await ipqsLookup(fx.networkA, '203.0.113.9')).toEqual({ score: 12, flags: ['ipqs_proxy'] });
    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/ip/ipqs-real-key-123/203.0.113.9');
  });

  it('Facebook CAPI and the offer feed also get the plaintext only at the point of use', async () => {
    const net = (await seedFixture(`secrets-b-${randomUUID().slice(0, 8)}`)).networkA;
    const res = await putIntegrations({
      fbPixelId: 'px-1', fbAccessToken: 'fb-token-xyz',
      offerFeedUrl: 'https://feeds.example.com/offers.json', offerFeedKey: 'feed-key-789',
      offerFeedAdvertiserId: (await query<{ id: string }>('SELECT id FROM advertisers WHERE network_id = $1 LIMIT 1', [net])).rows[0]!.id,
      offerFeedStatus: 'paused', // no background sync; the test runs it
    }, net);
    expect(res.status).toBe(200);
    const s = (await stored(net))['integrations']!;
    expect(isEncrypted(s['fbAccessToken'])).toBe(true);
    expect(isEncrypted(s['offerFeedKey'])).toBe(true);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"events_received":1}', { status: 200 }));
    expect(await sendFacebookCapiEvent({ networkId: net, conversionId: 'c1', eventName: 'sale', payout: '1.00', currency: 'USD', clickId: 'k1' }))
      .toMatchObject({ ok: true });
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(String((init as RequestInit).body)).toContain('fb-token-xyz');

    await query(`UPDATE networks SET settings = jsonb_set(settings, '{integrations,offerFeedStatus}', '"active"') WHERE id = $1`, [net]);
    expect(await syncOfferFeed(net)).toMatchObject({ pulled: 1, created: 1 });
    expect(feed.calls[0]!.opts.headers).toMatchObject({ authorization: 'Bearer feed-key-789', 'x-api-key': 'feed-key-789' });
  });

  it("PUT '' keeps a stored secret, null removes it, and pinApiKey '' still revokes the Pin API key", async () => {
    const before = (await stored(fx.networkA))['integrations']!['ipQualityScoreApiKey'];
    expect((await putIntegrations({ ipQualityScoreApiKey: '' })).status).toBe(200);
    expect((await stored(fx.networkA))['integrations']!['ipQualityScoreApiKey']).toBe(before);

    const pinKeyStatus = async () => (await query<{ status: string }>(
      `SELECT status FROM api_keys WHERE network_id = $1 AND metadata @> '{"pinApi":true}'`, [fx.networkA])).rows.map((r) => r.status);
    expect((await putIntegrations({ pinApiKey: 'pin-key-456' })).status).toBe(200);
    expect(isEncrypted((await stored(fx.networkA))['integrations']!['pinApiKey'])).toBe(true);
    expect(await pinKeyStatus()).toEqual(['active']); // the Public API key itself is still mirrored (hashed)
    expect((await putIntegrations({ pinApiKey: '' })).status).toBe(200);
    expect((await stored(fx.networkA))['integrations']).not.toHaveProperty('pinApiKey');
    expect(await pinKeyStatus()).toEqual(['revoked']);

    expect((await putIntegrations({ ipQualityScoreApiKey: null })).status).toBe(200);
    const res = await request(dash).get('/api/settings').set(as('admin'));
    expect(res.body.data.integrations).not.toHaveProperty('ipQualityScoreApiKeySet');
  });

  it('SMTP password: stored encrypted, GET shows passwordSet only, the mailer sends with the real password', async () => {
    const res = await request(dash).put('/api/settings/smtp').set(as('admin'))
      .send({ host: 'smtp.example.com', port: 587, username: 'mailer', password: 'smtp-pass-!@#', fromEmail: 'noreply@example.com' });
    expect(res.status).toBe(200);
    const pw = (await stored(fx.networkA))['smtp']!['password'];
    expect(isEncrypted(pw)).toBe(true);

    const got = await request(dash).get('/api/settings').set(as('read_only'));
    expect(got.body.data.smtp).toMatchObject({ host: 'smtp.example.com', passwordSet: true });
    expect(JSON.stringify(got.body)).not.toContain('smtp-pass-!@#');
    expect(JSON.stringify(got.body)).not.toContain('enc:v1:');

    expect((await sendNetworkEmail(fx.networkA, ['to@example.com'], 'hi', '<p>hi</p>')).sent).toBe(1);
    expect(smtp.transports[0]!.auth).toEqual({ user: 'mailer', pass: 'smtp-pass-!@#' });
  });

  it('legacy plaintext secrets (from before encryption) still work, and are masked too', async () => {
    const net = (await seedFixture(`secrets-c-${randomUUID().slice(0, 8)}`)).networkA;
    await query(`UPDATE networks SET settings = $2 WHERE id = $1`, [net, JSON.stringify({
      integrations: { ipQualityScoreApiKey: 'legacy-ipqs' }, smtp: { host: 'h', username: 'u', password: 'legacy-pass', fromEmail: 'a@example.com' },
    })]);
    const res = await request(dash).get('/api/settings').set(as('read_only', net));
    expect(res.body.data.integrations).toEqual({ ipQualityScoreApiKeySet: true });
    expect(JSON.stringify(res.body)).not.toContain('legacy-');

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, fraud_score: 1 })));
    await ipqsLookup(net, '203.0.113.10');
    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/ip/legacy-ipqs/');
    expect((await sendNetworkEmail(net, ['to@example.com'], 's', 'b')).sent).toBe(1);
    expect(smtp.transports[0]!.auth?.pass).toBe('legacy-pass');
  });

  it('the network postback secure code is shown to admin/manager only', async () => {
    for (const role of ['admin', 'manager']) {
      const res = await request(dash).get('/api/settings/security').set(as(role));
      expect(res.status).toBe(200);
      expect(res.body.data.securityCode).toBe(fx.secureCodeA);
    }
    for (const role of ['read_only', 'finance']) {
      const res = await request(dash).get('/api/settings/security').set(as(role));
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(fx.secureCodeA);
    }
  });
});
