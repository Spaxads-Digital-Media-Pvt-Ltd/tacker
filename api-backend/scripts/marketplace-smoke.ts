/**
 * Marketplace module API smoke — verifies all marketplace endpoints respond correctly.
 * Run: npx tsx scripts/marketplace-smoke.ts
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
  console.log(`${c.dim}Marketplace smoke → ${DASH}${c.reset}\n`);

  let token = '';
  await check('Login', async () => {
    const r = await req(`${DASH}/api/auth/login`, { method: 'POST', body: ADMIN });
    assert(r.status === 200, `status ${r.status}`);
    token = r.json?.data?.accessToken;
    assert(token, 'no token');
  });
  if (!token) process.exit(1);

  let inactiveId = '';
  let pendingId = '';
  let activeCount = 0;

  await check('GET /api/advertisers/marketplace', async () => {
    const r = await req(`${DASH}/api/advertisers/marketplace`, { token });
    assert(r.status === 200, `status ${r.status}`);
    const list = r.json?.data ?? [];
    assert(Array.isArray(list), 'not array');
    assert(list.length > 0, 'empty — run npm run seed:demo');
    activeCount = list.filter((a: { status: string }) => a.status === 'active').length;
    inactiveId = list.find((a: { status: string }) => a.status === 'inactive')?.id ?? '';
    pendingId = list.find((a: { status: string }) => a.status === 'pending')?.id ?? '';
    const sample = list[0];
    assert(sample.id && sample.name, 'missing fields');
    assert(Array.isArray(sample.categories), 'categories not array');
    assert(Array.isArray(sample.payoutModels), 'payoutModels not array');
    assert(typeof sample.offerCount === 'number', 'offerCount missing');
    return `${list.length} advertisers (${activeCount} active, pending=${Boolean(pendingId)}, inactive=${Boolean(inactiveId)})`;
  });

  await check('GET /api/marketplace-profile', async () => {
    const r = await req(`${DASH}/api/marketplace-profile`, { token });
    assert(r.status === 200, `status ${r.status}`);
    const p = r.json?.data;
    if (p) {
      assert(p.name, 'profile missing name');
      return `profile="${p.name}"`;
    }
    return 'no profile yet (null ok)';
  });

  await check('GET /api/reports (CVR/EPC for Discover)', async () => {
    const q = new URLSearchParams({
      groupBy: 'advertiser', metrics: 'cr,epc',
      from: new Date(Date.now() - 7 * 86400000).toISOString(),
      to: new Date().toISOString(), limit: '200',
    });
    const r = await req(`${DASH}/api/reports?${q}`, { token });
    assert(r.status === 200, `status ${r.status}`);
    const rows = r.json?.data?.rows ?? [];
    return `${rows.length} advertiser stat rows`;
  });

  if (inactiveId) {
    await check('PATCH /api/advertisers/:id (Apply → pending)', async () => {
      const r = await req(`${DASH}/api/advertisers/${inactiveId}`, {
        method: 'PATCH', token, body: { status: 'pending' },
      });
      assert(r.status === 200, `status ${r.status}`);
      assert(r.json?.data?.status === 'pending', 'status not pending');
      // revert for repeat runs
      await req(`${DASH}/api/advertisers/${inactiveId}`, {
        method: 'PATCH', token, body: { status: 'inactive' },
      });
      return 'apply + revert ok';
    });
  } else {
    console.log(`${c.dim}○ skip Apply test — no inactive advertiser${c.reset}`);
  }

  if (pendingId) {
    await check('PATCH /api/advertisers/:id (Approve → active)', async () => {
      const r = await req(`${DASH}/api/advertisers/${pendingId}`, {
        method: 'PATCH', token, body: { status: 'active' },
      });
      assert(r.status === 200, `status ${r.status}`);
      assert(r.json?.data?.status === 'active', 'status not active');
      // revert
      await req(`${DASH}/api/advertisers/${pendingId}`, {
        method: 'PATCH', token, body: { status: 'pending' },
      });
      return 'approve + revert ok';
    });
  } else {
    console.log(`${c.dim}○ skip Approve test — no pending advertiser${c.reset}`);
  }

  await check('PUT /api/marketplace-profile (save)', async () => {
    const r = await req(`${DASH}/api/marketplace-profile`, {
      method: 'PUT', token,
      body: {
        name: 'Demo Network',
        description: 'Smoke test profile save',
        categoriesMode: 'targeted',
        categories: ['Education & Career'],
        payoutTypesAccepted: ['Cost Per Action'],
        promotionalMethods: ['Email'],
        deviceTypesCovered: ['PC'],
        geolocationsMode: 'global',
        geolocations: [],
        contactSharePublicly: false,
        requireDefaultOffer: false,
      },
    });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.name === 'Demo Network', 'save failed');
    return 'profile saved';
  });

  console.log(`\n${failed === 0 ? c.green : c.red}${passed} passed, ${failed} failed${c.reset}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
