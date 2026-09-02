/**
 * Investigator module API smoke — CRUD + report against real clicks/conversions.
 * Run: npx tsx scripts/investigator-smoke.ts
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
  console.log(`${c.dim}Investigator smoke → ${DASH}/api/investigator${c.reset}\n`);

  let token = '';
  await check('Login', async () => {
    const r = await req(`${DASH}/api/auth/login`, { method: 'POST', body: ADMIN });
    assert(r.status === 200, `status ${r.status}`);
    token = r.json?.data?.accessToken;
    assert(token, 'no token');
  });
  if (!token) process.exit(1);

  const base = `${DASH}/api/investigator`;
  let investigationId = '';
  let publisherId = '';
  let sampleSub = 'google';

  await check('GET /publishers (partner target)', async () => {
    const r = await req(`${DASH}/api/publishers`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json?.data) && r.json.data.length > 0, 'need at least one publisher');
    publisherId = r.json.data[0].id;
    return r.json.data[0].name;
  });

  await check('GET /investigator (list — empty or existing)', async () => {
    const r = await req(base, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json?.data), 'expected data array');
    return `${r.json.data.length} investigation(s)`;
  });

  await check('POST /investigator (sub_id target)', async () => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 90);
    const r = await req(base, {
      method: 'POST', token,
      body: {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        targetType: 'sub_id',
        subField: 'sub1',
        targetValue: sampleSub,
      },
    });
    assert(r.status === 201, `status ${r.status} ${JSON.stringify(r.json)}`);
    investigationId = r.json?.data?.id;
    assert(investigationId, 'no id');
    assert(typeof r.json?.data?.entryCount === 'number', 'missing entryCount');
    assert(r.json?.data?.target?.includes('sub1'), 'target label missing sub field');
    return `ref=${r.json.data.ref}, entries=${r.json.data.entryCount}`;
  });

  await check('GET /investigator/:id (detail)', async () => {
    const r = await req(`${base}/${investigationId}`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.id === investigationId, 'id mismatch');
    assert(r.json?.data?.targetType === 'sub_id', 'targetType mismatch');
  });

  await check('GET /investigator/:id/report', async () => {
    const r = await req(`${base}/${investigationId}/report`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json?.data), 'expected report array');
    return `${r.json.data.length} report row(s)`;
  });

  await check('POST /investigator/:id/refresh', async () => {
    const r = await req(`${base}/${investigationId}/refresh`, { method: 'POST', token });
    assert(r.status === 200, `status ${r.status}`);
    assert(typeof r.json?.data?.entryCount === 'number', 'missing entryCount');
  });

  await check('POST /investigator (partner target)', async () => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    const r = await req(base, {
      method: 'POST', token,
      body: {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        targetType: 'partner',
        publisherId,
      },
    });
    assert(r.status === 201, `status ${r.status}`);
    const partnerInvId = r.json?.data?.id;
    assert(partnerInvId, 'no id');
    await req(`${base}/${partnerInvId}`, { method: 'DELETE', token });
  });

  await check('GET /investigator/:id (404 unknown)', async () => {
    const r = await req(`${base}/00000000-0000-4000-8000-000000000000`, { token });
    assert(r.status === 404, `expected 404, got ${r.status}`);
  });

  await check('DELETE /investigator/:id', async () => {
    const r = await req(`${base}/${investigationId}`, { method: 'DELETE', token });
    assert(r.status === 200, `status ${r.status}`);
    investigationId = '';
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
