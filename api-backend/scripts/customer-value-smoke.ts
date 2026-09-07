/**
 * Customer Value module API smoke — data points, rules CRUD, conversion-events report.
 * Run: npx tsx scripts/customer-value-smoke.ts
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

const minimalRule = (dataPointId: string) => ({
  name: 'Smoke Test Rule',
  status: 'active',
  conversionEventGrouping: 'all_together',
  applyOffersMode: 'all',
  applyOfferIds: [],
  applyAdvertisersMode: 'all',
  applyAdvertiserIds: [],
  applyPartnersMode: 'all',
  applyPartnerIds: [],
  goalCycle: 'continuous',
  continuousMode: 'for_rule_duration',
  setGoalConditions: false,
  conditions: [],
  outcomeFrequency: 'once_per_customer',
  payoutValue: 25,
  revenueValue: null,
});

async function main(): Promise<void> {
  console.log(`${c.dim}Customer Value smoke → ${DASH}/api/customer-value${c.reset}\n`);

  let token = '';
  await check('Login', async () => {
    const r = await req(`${DASH}/api/auth/login`, { method: 'POST', body: ADMIN });
    assert(r.status === 200, `status ${r.status}`);
    token = r.json?.data?.accessToken;
    assert(token, 'no token');
  });
  if (!token) process.exit(1);

  const base = `${DASH}/api/customer-value`;
  let dataPointId = '';
  let ruleId = '';

  await check('GET /data-points', async () => {
    const r = await req(`${base}/data-points`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json?.data), 'expected array');
    const seeded = r.json.data.find((d: { parameterKey: string }) => d.parameterKey === 'deposit');
    return `${r.json.data.length} data point(s)${seeded ? ', deposit seeded' : ''}`;
  });

  await check('POST /data-points', async () => {
    const r = await req(`${base}/data-points`, {
      method: 'POST', token,
      body: { name: 'Smoke GEO', dataType: 'text', parameterKey: 'smoke_geo' },
    });
    assert(r.status === 201, `status ${r.status}`);
    dataPointId = r.json?.data?.id;
    assert(dataPointId, 'no id');
    assert(typeof r.json?.data?.ref === 'number', 'missing ref');
  });

  await check('PATCH /data-points/:id', async () => {
    const r = await req(`${base}/data-points/${dataPointId}`, {
      method: 'PATCH', token,
      body: { name: 'Smoke GEO Updated', dataType: 'text', parameterKey: 'smoke_geo' },
    });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.name === 'Smoke GEO Updated', 'name not updated');
  });

  await check('GET /rules?status=all', async () => {
    const r = await req(`${base}/rules?status=all`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json?.data), 'expected array');
    return `${r.json.data.length} rule(s)`;
  });

  await check('GET /rules?status=active', async () => {
    const r = await req(`${base}/rules?status=active`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.every((x: { status: string }) => x.status === 'active'), 'non-active in active filter');
  });

  await check('POST /rules', async () => {
    const r = await req(`${base}/rules`, {
      method: 'POST', token,
      body: minimalRule(dataPointId),
    });
    assert(r.status === 201, `status ${r.status}`);
    ruleId = r.json?.data?.id;
    assert(ruleId, 'no rule id');
    assert(r.json?.data?.payoutValue === '25.0000' || r.json?.data?.payoutValue === 25 || Number(r.json?.data?.payoutValue) === 25, 'payout mismatch');
  });

  await check('GET /rules/:id (edit load)', async () => {
    const r = await req(`${base}/rules/${ruleId}`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.name === 'Smoke Test Rule', 'name mismatch');
    assert(Array.isArray(r.json?.data?.conditions), 'conditions should be array');
    assert(r.json?.data?.applyOffersMode === 'all', 'scope mismatch');
  });

  await check('PATCH /rules/:id', async () => {
    const r = await req(`${base}/rules/${ruleId}`, {
      method: 'PATCH', token,
      body: { ...minimalRule(dataPointId), name: 'Smoke Test Rule Updated', revenueValue: 50 },
    });
    assert(r.status === 200, `status ${r.status}`);
    const get = await req(`${base}/rules/${ruleId}`, { token });
    assert(get.json?.data?.name === 'Smoke Test Rule Updated', 'update not persisted');
  });

  await check('POST /rules validation (requires payout or revenue)', async () => {
    const r = await req(`${base}/rules`, {
      method: 'POST', token,
      body: { ...minimalRule(dataPointId), payoutValue: null, revenueValue: null },
    });
    assert(r.status === 422 || r.status === 400, `expected validation error, got ${r.status}`);
  });

  await check('GET /conversion-events (no userId)', async () => {
    const r = await req(`${base}/conversion-events`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.events?.length === 0, 'expected empty without userId');
  });

  await check('GET /conversion-events (with userId)', async () => {
    const r = await req(`${base}/conversion-events?userId=user_1&limit=5`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.userId === 'user_1', 'userId echo mismatch');
    assert(Array.isArray(r.json?.data?.events), 'expected events array');
    return `${r.json.data.events.length} event(s)`;
  });

  await check('DELETE /rules/:id', async () => {
    const r = await req(`${base}/rules/${ruleId}`, { method: 'DELETE', token });
    assert(r.status === 200, `status ${r.status}`);
    ruleId = '';
  });

  await check('DELETE /data-points/:id', async () => {
    const r = await req(`${base}/data-points/${dataPointId}`, { method: 'DELETE', token });
    assert(r.status === 200, `status ${r.status}`);
    dataPointId = '';
  });

  // Supporting endpoints used by rule form
  await check('GET /api/offers (rule form scope)', async () => {
    const r = await req(`${DASH}/api/offers`, { token });
    assert(r.status === 200 && Array.isArray(r.json?.data), 'offers list failed');
    return `${r.json.data.length} offers`;
  });

  await check('GET /api/advertisers (rule form scope)', async () => {
    const r = await req(`${DASH}/api/advertisers`, { token });
    assert(r.status === 200 && Array.isArray(r.json?.data), 'advertisers list failed');
    return `${r.json.data.length} advertisers`;
  });

  await check('GET /api/publishers (rule form scope)', async () => {
    const r = await req(`${DASH}/api/publishers`, { token });
    assert(r.status === 200 && Array.isArray(r.json?.data), 'publishers list failed');
    return `${r.json.data.length} publishers`;
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
