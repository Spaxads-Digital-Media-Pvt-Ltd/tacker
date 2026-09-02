/**
 * Control Center full API smoke.
 * Run: npx tsx scripts/control-center-smoke.ts
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
  console.log(`${c.dim}Control Center smoke → ${DASH}/api/control-center${c.reset}\n`);

  let token = '';
  await check('Login', async () => {
    const r = await req(`${DASH}/api/auth/login`, { method: 'POST', body: ADMIN });
    assert(r.status === 200, `status ${r.status}`);
    token = r.json?.data?.accessToken;
    assert(token, 'no token');
  });
  if (!token) process.exit(1);

  const CC = `${DASH}/api/control-center`;

  await check('GET /control-center/config', async () => {
    const r = await req(`${CC}/config`, { token });
    assert(r.status === 200, `status ${r.status}`);
  });

  await check('PUT /control-center/config/platform', async () => {
    const r = await req(`${CC}/config/platform`, { method: 'PUT', token, body: { billing: { taxInfo: 'Test' } } });
    assert(r.status === 200, `status ${r.status}`);
  });

  await check('GET /control-center/usage', async () => {
    const r = await req(`${CC}/usage?year=${new Date().getFullYear()}`, { token });
    assert(r.status === 200 && Array.isArray(r.json?.data?.rows), 'expected rows');
    return `${r.json.data.rows.length} month(s)`;
  });

  let docId = '';
  await check('POST /control-center/documents', async () => {
    const r = await req(`${CC}/documents`, {
      method: 'POST', token,
      body: { name: 'Smoke Doc', description: 'test', fileUrl: 'https://example.com/doc.pdf' },
    });
    assert(r.status === 201, JSON.stringify(r.json));
    docId = r.json?.data?.id;
  });

  await check('GET /control-center/documents', async () => {
    const r = await req(`${CC}/documents?status=active`, { token });
    assert(r.status === 200 && Array.isArray(r.json?.data), 'array');
    return `${r.json.data.length} doc(s)`;
  });

  await check('DELETE /control-center/documents/:id', async () => {
    const r = await req(`${CC}/documents/${docId}`, { method: 'DELETE', token });
    assert(r.status === 200, `status ${r.status}`);
  });

  let catId = '';
  await check('POST /control-center/categories', async () => {
    const r = await req(`${CC}/categories`, { method: 'POST', token, body: { name: 'Smoke Category' } });
    assert(r.status === 201, JSON.stringify(r.json));
    catId = r.json?.data?.id;
  });

  await check('DELETE /control-center/categories/:id', async () => {
    const r = await req(`${CC}/categories/${catId}`, { method: 'DELETE', token });
    assert(r.status === 200, `status ${r.status}`);
  });

  await check('PUT /control-center/ip-blacklist', async () => {
    const r = await req(`${CC}/ip-blacklist`, {
      method: 'PUT', token,
      body: { ranges: [{ from: '10.0.0.1', to: '10.0.0.255' }] },
    });
    assert(r.status === 200, `status ${r.status}`);
  });

  await check('GET /control-center/ip-blacklist', async () => {
    const r = await req(`${CC}/ip-blacklist`, { token });
    assert(r.status === 200 && Array.isArray(r.json?.data), 'array');
  });

  await check('POST /control-center/api-whitelist', async () => {
    const r = await req(`${CC}/api-whitelist`, { method: 'POST', token, body: { ipAddress: '192.168.1.1' } });
    assert(r.status === 201, JSON.stringify(r.json));
    const id = r.json?.data?.id;
    await req(`${CC}/api-whitelist/${id}`, { method: 'DELETE', token });
  });

  await check('GET /control-center/login-events', async () => {
    const r = await req(`${CC}/login-events`, { token });
    assert(r.status === 200 && Array.isArray(r.json?.data), 'array');
    return `${r.json.data.length} event(s)`;
  });

  await check('GET /control-center/tags-with-usage', async () => {
    const r = await req(`${CC}/tags-with-usage`, { token });
    assert(r.status === 200 && Array.isArray(r.json?.data), 'array');
  });

  await check('GET /users (extended DTO)', async () => {
    const r = await req(`${DASH}/api/users`, { token });
    assert(r.status === 200 && r.json?.data?.[0]?.ref != null, 'missing ref');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
