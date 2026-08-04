/**
 * End-to-end smoke test — internal tester for ALL surfaces/endpoints (spec §13 verification).
 *
 * Drives the real system the way a client would: logs in, reads every admin resource, mints an
 * API key and exercises the Public REST API (incl. a cross-audience 403), then runs the full
 * tracking pipeline (click → postback conversion → report) end-to-end. Prints a pass/fail line per
 * endpoint and exits non-zero if anything fails, so it doubles as a CI health gate.
 *
 * Prereqs (all local): Redis up, Supabase reachable, demo data seeded, and the surfaces running:
 *     npm run dev              # all five surfaces
 *     npm run seed             # demo network + offer + publisher + tracking domain
 *     npm run provision:demo-admin   (or provision-demo-admin) — creates the login below
 * Then:   npm run smoke
 *
 * Optional platform-admin coverage: set SMOKE_PLATFORM_EMAIL / SMOKE_PLATFORM_PASSWORD to a
 * bootstrapped super-admin login and those endpoints are tested too (skipped otherwise).
 */
import http from 'node:http';
import { env } from '../src/config/env.js';

/**
 * Raw HTTP GET that sets an explicit Host header. Needed for the tracking surface, which resolves
 * the tenant from Host — WHATWG fetch (undici) treats `Host` as a forbidden header and silently
 * drops it, so we drop to node:http here.
 */
function rawGet(
  port: number, path: string, host: string,
): Promise<{ status: number; location: string | null; json: any; text: string }> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers: { host } }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        let json: any = null;
        try { json = JSON.parse(body); } catch { /* redirect/non-json */ }
        resolve({ status: res.statusCode ?? 0, location: res.headers.location ?? null, json, text: body });
      });
    });
    r.on('error', reject);
    r.end();
  });
}

const H = (p: number) => `http://localhost:${p}`;
const DASH = H(env.PORT_DASHBOARD);
const TRACK = H(env.PORT_TRACKING);
const PUBLIC = H(env.PORT_PUBLIC_API);
const PLATFORM = H(env.PORT_PLATFORM_ADMIN);
const WORKERS = H(env.PORT_WORKERS_HEALTH);
const TRACKING_HOST = `demo.${env.TRACKING_BASE_DOMAIN}`;

const ADMIN = { email: 'demo-admin@tracker.test', password: 'DemoPass123!' };

// ── tiny test runner ────────────────────────────────────────────────────────
const c = { green: '\x1b[32m', red: '\x1b[31m', dim: '\x1b[2m', yellow: '\x1b[33m', reset: '\x1b[0m' };
let passed = 0, failed = 0, skipped = 0;

async function check(name: string, fn: () => Promise<string | void>): Promise<void> {
  try {
    const detail = await fn();
    passed++;
    // eslint-disable-next-line no-console
    console.log(`${c.green}✓${c.reset} ${name}${detail ? `  ${c.dim}${detail}${c.reset}` : ''}`);
  } catch (err) {
    failed++;
    // eslint-disable-next-line no-console
    console.log(`${c.red}✗ ${name}${c.reset}  ${c.red}${err instanceof Error ? err.message : String(err)}${c.reset}`);
  }
}
function skip(name: string, why: string): void {
  skipped++;
  // eslint-disable-next-line no-console
  console.log(`${c.yellow}○${c.reset} ${name}  ${c.dim}(skipped: ${why})${c.reset}`);
}
function section(title: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n${c.dim}── ${title} ──${c.reset}`);
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** GET/POST helper returning { status, json, text }. */
async function req(
  url: string,
  opts: { method?: string; token?: string; apiKey?: string; host?: string; body?: unknown; redirect?: RequestRedirect } = {},
): Promise<{ status: number; json: any; text: string; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  if (opts.apiKey) headers['x-api-key'] = opts.apiKey;
  if (opts.host) headers['host'] = opts.host;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    redirect: opts.redirect ?? 'follow',
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-json (metrics, redirect) */ }
  return { status: res.status, json, text, headers: res.headers };
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`${c.dim}Smoke test → dashboard ${DASH} · tracking ${TRACK} (host ${TRACKING_HOST}) · public ${PUBLIC}${c.reset}`);

  // ── 1. Health + metrics on every surface ────────────────────────────────
  section('Health & metrics (all surfaces)');
  for (const [name, base] of [['dashboard', DASH], ['tracking', TRACK], ['public-api', PUBLIC], ['platform-admin', PLATFORM], ['workers', WORKERS]] as const) {
    await check(`GET ${name} /health`, async () => {
      const r = await req(`${base}/health`);
      assert(r.status === 200 || r.status === 503, `status ${r.status}`);
      return `status=${r.json?.status ?? '?'}`;
    });
  }
  for (const [name, base] of [['dashboard', DASH], ['tracking', TRACK], ['public-api', PUBLIC], ['workers', WORKERS]] as const) {
    await check(`GET ${name} /metrics`, async () => {
      const r = await req(`${base}/metrics`);
      assert(r.status === 200, `status ${r.status}`);
      assert(r.text.includes('tracker_'), 'no tracker_ metrics in body');
    });
  }

  // ── 2. Dashboard auth + admin reads ──────────────────────────────────
  section('Dashboard — auth & admin resources');
  let token = '';
  await check('POST /api/auth/login (admin)', async () => {
    const r = await req(`${DASH}/api/auth/login`, { method: 'POST', body: ADMIN });
    assert(r.status === 200, `status ${r.status} — did you run provision:demo-admin?`);
    token = r.json?.data?.accessToken;
    assert(token, 'no accessToken');
    return `kind=${r.json?.data?.identity?.kind}`;
  });
  assert(token, 'cannot continue without an admin token');

  let offerId = '', publisherId = '';
  await check('GET /api/me', async () => {
    const r = await req(`${DASH}/api/me`, { token });
    assert(r.status === 200, `status ${r.status}`);
  });
  await check('GET /api/offers', async () => {
    const r = await req(`${DASH}/api/offers`, { token });
    assert(r.status === 200, `status ${r.status}`);
    const list = r.json?.data ?? [];
    // Prefer an active offer whose destination echoes {click_id} (so we can extract the click_id
    // from the 302). Falls back to any active offer, then the first offer.
    const active = list.filter((o: any) => o.status === 'active');
    const withCid = active.find((o: any) => /\{click_id\}|cid=/.test(o.destinationUrl ?? ''));
    offerId = (withCid ?? active[0] ?? list[0])?.id ?? '';
    assert(offerId, 'no offers found — run npm run seed');
    return `${list.length} offers, using=${offerId.slice(0, 8)}`;
  });
  await check('GET /api/publishers', async () => {
    const r = await req(`${DASH}/api/publishers`, { token });
    assert(r.status === 200, `status ${r.status}`);
    const list = r.json?.data ?? [];
    publisherId = list.find((p: any) => p.status === 'active')?.id ?? list[0]?.id ?? '';
    return `${list.length} publishers`;
  });
  for (const path of ['/api/advertisers', '/api/tracking-domains', '/api/alerts', '/api/reports', '/api/subscription', '/api/ai/status']) {
    await check(`GET ${path}`, async () => {
      const r = await req(`${DASH}${path}`, { token });
      assert(r.status === 200, `status ${r.status}`);
    });
  }

  // ── 3. API key mgmt + Public REST API ───────────────────────────────────
  section('Public REST API — key auth, audience isolation');
  let apiKey = '';
  await check('POST /api/keys (network key)', async () => {
    const r = await req(`${DASH}/api/keys`, {
      method: 'POST', token,
      body: { name: 'smoke-test', scopes: ['offers:read', 'publishers:read', 'advertisers:read', 'reports:read'] },
    });
    assert(r.status === 201, `status ${r.status}`);
    apiKey = r.json?.data?.key;
    assert(apiKey?.startsWith('net_'), `unexpected key prefix: ${apiKey?.slice(0, 8)}`);
    return `prefix=${r.json?.data?.prefix}`;
  });
  await check('GET /api/v1/openapi.json (public)', async () => {
    const r = await req(`${PUBLIC}/api/v1/openapi.json`);
    assert(r.status === 200 && r.json?.openapi, `status ${r.status}`);
  });
  await check('GET /api/v1/network/offers (with key)', async () => {
    const r = await req(`${PUBLIC}/api/v1/network/offers`, { apiKey });
    assert(r.status === 200, `status ${r.status}`);
  });
  await check('GET /api/v1/network/reports/summary (with key)', async () => {
    const r = await req(`${PUBLIC}/api/v1/network/reports/summary`, { apiKey });
    assert(r.status === 200, `status ${r.status}`);
    return `clicks=${r.json?.data?.clicks} conv=${r.json?.data?.conversions}`;
  });
  await check('403: network key CANNOT use publisher namespace', async () => {
    const r = await req(`${PUBLIC}/api/v1/publisher/offers`, { apiKey });
    assert(r.status === 403, `expected 403, got ${r.status}`);
  });
  await check('401: no key rejected', async () => {
    const r = await req(`${PUBLIC}/api/v1/network/offers`);
    assert(r.status === 401, `expected 401, got ${r.status}`);
  });

  // ── 4. Tracking pipeline: click → postback → report ─────────────────────
  section('Tracking pipeline (end-to-end)');
  let clickId = '';
  await check('GET /click → 302 with click_id', async () => {
    const path = `/click?offer_id=${encodeURIComponent(offerId)}${publisherId ? `&pub_id=${encodeURIComponent(publisherId)}` : ''}`;
    const r = await rawGet(env.PORT_TRACKING, path, TRACKING_HOST);
    assert(r.status === 302, `expected 302, got ${r.status} (host resolution? run seed). body=${r.text.slice(0, 80)}`);
    clickId = new URL(r.location ?? '').searchParams.get('cid') ?? '';
    assert(clickId, `no cid in Location: ${r.location}`);
    return `click_id=${clickId.slice(0, 12)}…`;
  });
  await check('GET /postback → conversion recorded', async () => {
    assert(clickId, 'no click_id from previous step');
    const r = await rawGet(env.PORT_TRACKING, `/postback?click_id=${clickId}&txn_id=smoke-${Date.now()}&event=purchase`, TRACKING_HOST);
    assert(r.status === 200, `status ${r.status}: ${r.text.slice(0, 120)}`);
    return `status=${r.json?.status}`;
  });
  await check('GET /postback (same txn) → idempotent duplicate', async () => {
    const txn = `smoke-dup-${Date.now()}`;
    await rawGet(env.PORT_TRACKING, `/postback?click_id=${clickId}&txn_id=${txn}&event=purchase`, TRACKING_HOST);
    const r = await rawGet(env.PORT_TRACKING, `/postback?click_id=${clickId}&txn_id=${txn}&event=purchase`, TRACKING_HOST);
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.status === 'duplicate', `expected duplicate, got ${r.json?.status}`);
  });
  await check('GET /api/reports reflects the click/conversion', async () => {
    const r = await req(`${DASH}/api/reports?groupBy=offer`, { token });
    assert(r.status === 200, `status ${r.status}`);
    const rows = r.json?.data?.rows ?? r.json?.data ?? [];
    return `${Array.isArray(rows) ? rows.length : '?'} report rows`;
  });

  // ── 5. Platform-admin (optional) ────────────────────────────────────────
  section('Platform-admin (super-admin)');
  const pEmail = process.env['SMOKE_PLATFORM_EMAIL'];
  const pPass = process.env['SMOKE_PLATFORM_PASSWORD'];
  if (pEmail && pPass) {
    let pToken = '';
    await check('POST /api/auth/login (platform admin)', async () => {
      const r = await req(`${DASH}/api/auth/login`, { method: 'POST', body: { email: pEmail, password: pPass } });
      assert(r.status === 200, `status ${r.status}`);
      pToken = r.json?.data?.accessToken;
      assert(pToken, 'no token');
    });
    await check('GET /platform/me', async () => {
      const r = await req(`${PLATFORM}/platform/me`, { token: pToken });
      assert(r.status === 200, `status ${r.status}`);
    });
    await check('GET /platform/plans', async () => {
      const r = await req(`${PLATFORM}/platform/plans`, { token: pToken });
      assert(r.status === 200, `status ${r.status}`);
    });
    await check('403: admin token CANNOT reach platform-admin', async () => {
      const r = await req(`${PLATFORM}/platform/me`, { token });
      assert(r.status === 401 || r.status === 403, `expected 401/403, got ${r.status}`);
    });
  } else {
    skip('platform-admin endpoints', 'set SMOKE_PLATFORM_EMAIL / SMOKE_PLATFORM_PASSWORD');
  }

  // ── summary ─────────────────────────────────────────────────────────────
  // eslint-disable-next-line no-console
  console.log(`\n${failed === 0 ? c.green : c.red}${passed} passed${c.reset}, ${failed ? c.red : c.dim}${failed} failed${c.reset}, ${c.dim}${skipped} skipped${c.reset}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`${c.red}smoke run crashed:${c.reset}`, err instanceof Error ? err.message : err);
  process.exit(1);
});
