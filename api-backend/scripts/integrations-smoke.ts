/**
 * Integrations module API smoke — verifies settings persistence and related endpoints.
 * Run: npx tsx scripts/integrations-smoke.ts
 */
import { env } from '../src/config/env.js';

const DASH = `http://localhost:${env.PORT_DASHBOARD}`;
const ADMIN = { email: 'demo-admin@tracker.test', password: 'DemoPass123!' };

const c = { green: '\x1b[32m', red: '\x1b[31m', dim: '\x1b[2m', reset: '\x1b[0m' };
let passed = 0, failed = 0;

async function req(
  url: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}

async function check(name: string, fn: () => Promise<string | void>): Promise<void> {
  try {
    const detail = await fn();
    passed++;
    console.log(`${c.green}✓${c.reset} ${name}${detail ? `  ${c.dim}${detail}${c.reset}` : ''}`);
  } catch (err) {
    failed++;
    console.log(`${c.red}✗${c.reset} ${name}  ${c.red}${err instanceof Error ? err.message : String(err)}${c.reset}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  console.log(`${c.dim}Integrations smoke → ${DASH}${c.reset}\n`);

  let token = '';
  await check('Login', async () => {
    const r = await req(`${DASH}/api/auth/login`, { method: 'POST', body: ADMIN });
    assert(r.status === 200, `status ${r.status}`);
    token = r.json?.data?.accessToken;
    assert(token, 'no token');
  });
  if (!token) process.exit(1);

  await check('GET /api/settings', async () => {
    const r = await req(`${DASH}/api/settings`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.integrations !== undefined, 'missing integrations key');
    return `integrations keys: ${Object.keys(r.json.data.integrations ?? {}).length}`;
  });

  await check('PUT /api/settings/integrations (Facebook CAPI)', async () => {
    const r = await req(`${DASH}/api/settings/integrations`, {
      method: 'PUT', token,
      body: { values: { fbPixelId: '123456789', fbAccessToken: 'test-token-smoke' } },
    });
    assert(r.status === 200, `status ${r.status}`);
    const get = await req(`${DASH}/api/settings`, { token });
    assert(get.json?.data?.integrations?.fbPixelId === '123456789', 'fbPixelId not persisted');
    assert(get.json?.data?.integrations?.fbAccessToken === 'test-token-smoke', 'fbAccessToken not persisted');
    return 'saved + read back';
  });

  await check('PUT /api/settings/integrations (Pin API)', async () => {
    const r = await req(`${DASH}/api/settings/integrations`, {
      method: 'PUT', token,
      body: { values: { pinApiKey: 'pin-smoke-key' } },
    });
    assert(r.status === 200, `status ${r.status}`);
    const get = await req(`${DASH}/api/settings`, { token });
    assert(get.json?.data?.integrations?.pinApiKey === 'pin-smoke-key', 'pinApiKey not persisted');
    return 'saved + read back';
  });

  let advertiserId = '';
  await check('GET /api/advertisers (for feed config)', async () => {
    const r = await req(`${DASH}/api/advertisers`, { token });
    assert(r.status === 200, `status ${r.status}`);
    advertiserId = r.json?.data?.[0]?.id ?? '';
    assert(advertiserId, 'no advertisers');
    return `${r.json.data.length} advertisers`;
  });

  await check('PUT /api/settings/integrations (Offer Feed)', async () => {
    const r = await req(`${DASH}/api/settings/integrations`, {
      method: 'PUT', token,
      body: {
        values: {
          offerFeedName: 'Smoke Test Feed',
          offerFeedStatus: 'active',
          offerFeedAdvertiserId: advertiserId,
          offerFeedSyncFrequency: 'Daily',
          offerFeedUrl: 'demo://offer-feed',
          offerFeedKey: 'feed-key-smoke',
          offerFeedUseAdvertiserCurrency: true,
        },
      },
    });
    assert(r.status === 200, `status ${r.status}`);
    const get = await req(`${DASH}/api/settings`, { token });
    const i = get.json?.data?.integrations ?? {};
    assert(i.offerFeedUrl === 'demo://offer-feed', 'feed url not saved');
    assert(i.offerFeedName === 'Smoke Test Feed', 'feed name not saved');
    return 'feed config persisted';
  });

  await check('POST /api/settings/integrations/offer-feed/sync', async () => {
    const r = await req(`${DASH}/api/settings/integrations/offer-feed/sync`, { method: 'POST', token });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.pulled >= 1, `expected pulled offers, got ${JSON.stringify(r.json?.data)}`);
    const get = await req(`${DASH}/api/settings`, { token });
    const i = get.json?.data?.integrations ?? {};
    assert(i.offerFeedTotalOffers >= 1, 'total offers not updated');
    assert(i.offerFeedLastFullSync, 'last full sync not set');
    return `pulled=${r.json.data.pulled}, created=${r.json.data.created}, updated=${r.json.data.updated}`;
  });

  await check('Pin API key works on Public REST API', async () => {
    const pinKey = 'pin-smoke-key';
    const res = await fetch(`http://localhost:${env.PORT_PUBLIC_API}/api/v1/network/offers?limit=1`, {
      headers: { 'X-Api-Key': pinKey },
    });
    assert(res.status === 200, `public API status ${res.status}`);
    return 'pin key authenticated';
  });

  await check('GET /api/keys (Build Your Own banner target)', async () => {
    const r = await req(`${DASH}/api/keys`, { token });
    assert(r.status === 200, `status ${r.status}`);
    return `${(r.json?.data ?? []).length} network API keys`;
  });

  await check('POST /api/keys (create integration key)', async () => {
    const r = await req(`${DASH}/api/keys`, {
      method: 'POST', token,
      body: { name: 'Integrations Smoke Key' },
    });
    assert(r.status === 201, `status ${r.status}`);
    assert(r.json?.data?.key, 'full key not returned on create');
    return `prefix=${r.json.data.prefix}`;
  });

  // Cleanup smoke integration keys from settings (optional - leave feed for UI demo)
  await check('GET /api/settings/integrations/catalog', async () => {
    const r = await req(`${DASH}/api/settings/integrations/catalog?category=Fraud%20Detection`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json?.data?.connected), 'missing connected array');
    assert(Array.isArray(r.json?.data?.notConnected), 'missing notConnected array');
    return `connected=${r.json.data.connected.length}, notConnected=${r.json.data.notConnected.length}`;
  });

  await check('GET /api/settings/integrations/status', async () => {
    const r = await req(`${DASH}/api/settings/integrations/status`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.fraud !== undefined, 'missing fraud status');
    assert(r.json?.data?.feeds !== undefined, 'missing feeds status');
    return `fraud connected=${r.json.data.fraud.connected}, feeds connected=${r.json.data.feeds.connected}`;
  });

  await check('Secrets returned on GET (security check)', async () => {
    const get = await req(`${DASH}/api/settings`, { token });
    // Integration secrets ARE returned on GET (unlike SMTP) — document this
    const hasToken = Boolean(get.json?.data?.integrations?.fbAccessToken);
    return hasToken ? 'integration secrets visible on GET (expected for this app)' : 'no secrets';
  });

  console.log(`\n${failed === 0 ? c.green : c.red}${passed} passed, ${failed} failed${c.reset}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
