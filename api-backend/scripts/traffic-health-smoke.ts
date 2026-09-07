/**
 * Traffic Health module API smoke — verifies tracking-domains endpoints used by Traffic Health UI.
 * Run: npx tsx scripts/traffic-health-smoke.ts
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
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
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
  console.log(`${c.dim}Traffic Health smoke → ${DASH}/api/tracking-domains + /api/traffic-health${c.reset}\n`);

  let token = '';
  await check('Login', async () => {
    const r = await req(`${DASH}/api/auth/login`, { method: 'POST', body: ADMIN });
    assert(r.status === 200, `status ${r.status}`);
    token = r.json?.data?.accessToken;
    assert(token, 'no token');
  });
  if (!token) process.exit(1);

  const base = `${DASH}/api/tracking-domains`;
  let domainId = '';
  const smokeSub = `th-smoke-${Date.now().toString(36)}`;

  await check('GET /tracking-domains (Overview + Configurations list)', async () => {
    const r = await req(`${base}?limit=200`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json?.data), 'expected data array');
    assert(r.json?.pagination?.total !== undefined, 'missing pagination total');
    const first = r.json.data[0];
    if (first) {
      assert(first.host && first.status && first.sslStatus, 'missing Traffic Health UI fields');
      assert(typeof first.ref === 'number', 'missing ref');
      assert(first.createdAt && first.updatedAt, 'missing timestamps');
    }
    return `${r.json.data.length} domain(s), total=${r.json.pagination.total}`;
  });

  await check('POST /tracking-domains (subdomain — Add Domain modal)', async () => {
    const r = await req(`${base}`, {
      method: 'POST', token,
      body: { mode: 'subdomain', subdomain: smokeSub },
    });
    assert(r.status === 201, `status ${r.status}`);
    domainId = r.json?.data?.id;
    assert(domainId, 'no domain id');
    assert(r.json?.data?.status === 'active', 'subdomain should be active');
    assert(r.json?.data?.verificationState === 'verified', 'subdomain should be verified');
    assert(r.json?.data?.sslStatus === 'issued', 'subdomain should have SSL issued');
    return r.json.data.host;
  });

  const thBase = `${DASH}/api/traffic-health`;
  const range = `from=${encodeURIComponent(new Date(Date.now() - 90 * 864e5).toISOString())}&to=${encodeURIComponent(new Date().toISOString())}`;

  await check('GET /traffic-health/usage (Usage tab)', async () => {
    const r = await req(`${thBase}/usage?${range}`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json?.data?.rows), 'expected rows array');
    const row = r.json.data.rows.find((x: { domainId: string }) => x.domainId === domainId);
    assert(row?.host, 'smoke domain missing from usage rows');
    assert(typeof row.clicks === 'number', 'missing clicks');
  });

  await check('GET /traffic-health/domains/:id/summary (Overview panel + detail Usage)', async () => {
    const r = await req(`${thBase}/domains/${domainId}/summary?${range}`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.domain?.id === domainId, 'domain mismatch');
    assert(typeof r.json?.data?.clicks === 'number', 'missing clicks');
    assert(typeof r.json?.data?.offersAssigned === 'number', 'missing offersAssigned');
  });

  await check('GET /traffic-health/domains/:id/activity (All Activity tab)', async () => {
    const r = await req(`${thBase}/domains/${domainId}/activity?${range}`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json?.data), 'expected activity array');
  });

  await check('PATCH /traffic-health/domains/:id/primary (Set default domain)', async () => {
    const r = await req(`${thBase}/domains/${domainId}/primary`, {
      method: 'PATCH', token, body: { isPrimary: true },
    });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.isPrimary === true, 'should be primary');
  });

  await check('GET /tracking-domains/:id (Domain Detail page)', async () => {
    const r = await req(`${base}/${domainId}`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.id === domainId, 'id mismatch');
    assert(r.json?.data?.mode === 'subdomain', 'mode mismatch');
    assert(r.json?.data?.host?.includes(smokeSub), 'host mismatch');
  });

  await check('POST /tracking-domains (custom domain — pending verification)', async () => {
    const r = await req(`${base}`, {
      method: 'POST', token,
      body: { mode: 'custom', host: `${smokeSub}.example.com` },
    });
    assert(r.status === 201, `status ${r.status}`);
    assert(r.json?.data?.status === 'pending', 'custom should be pending');
    assert(r.json?.data?.verificationState === 'unverified', 'custom should be unverified');
    const customId = r.json?.data?.id;
    assert(customId, 'no custom domain id');
    await req(`${base}/${customId}`, { method: 'DELETE', token });
  });

  await check('GET /tracking-domains/:id (404 for unknown)', async () => {
    const r = await req(`${base}/00000000-0000-4000-8000-000000000000`, { token });
    assert(r.status === 404, `expected 404, got ${r.status}`);
  });

  await check('DELETE /tracking-domains/:id', async () => {
    const r = await req(`${base}/${domainId}`, { method: 'DELETE', token });
    assert(r.status === 200, `status ${r.status}`);
    domainId = '';
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
