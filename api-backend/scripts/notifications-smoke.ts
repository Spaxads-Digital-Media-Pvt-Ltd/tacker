/**
 * Notifications module smoke — /api/me/notifications + audit-log feed.
 * Run: npx tsx scripts/notifications-smoke.ts
 */
import { env } from '../src/config/env.js';

const DASH = `http://localhost:${env.PORT_DASHBOARD}`;
const ADMIN = { email: 'demo-admin@tracker.test', password: 'DemoPass123!' };

let passed = 0;
let failed = 0;

async function req(url: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function check(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = await fn();
    passed++;
    console.log(`✓ ${name}${detail ? `  ${detail}` : ''}`);
  } catch (err) {
    failed++;
    console.log(`✗ ${name}  ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  console.log(`Notifications smoke → ${DASH}\n`);
  const login = await req(`${DASH}/api/auth/login`, { method: 'POST', body: ADMIN });
  const token = login.json?.data?.accessToken as string | undefined;
  assert(token, `login failed: ${JSON.stringify(login.json)}`);

  await check('GET /me/notifications', async () => {
    const r = await req(`${DASH}/api/me/notifications`, { token });
    assert(r.status === 200, JSON.stringify(r.json));
    assert(r.json?.data?.preferences !== undefined, 'no preferences');
  });

  await check('PUT /me/notifications partners', async () => {
    const r = await req(`${DASH}/api/me/notifications`, {
      method: 'PUT',
      token,
      body: {
        preferences: {
          partners: {
            'New Partner Signup': { inApp: true, email: false, scope: 'Notify me for all events' },
          },
        },
      },
    });
    assert(r.status === 200, JSON.stringify(r.json));
    assert(r.json?.data?.preferences?.partners?.['New Partner Signup']?.email === false, 'not saved');
  });

  await check('GET round-trip', async () => {
    const r = await req(`${DASH}/api/me/notifications`, { token });
    assert(r.json?.data?.preferences?.partners?.['New Partner Signup']?.inApp === true, 'lost');
  });

  await check('PUT merge other section', async () => {
    const r = await req(`${DASH}/api/me/notifications`, {
      method: 'PUT',
      token,
      body: { preferences: { security: { 'New Login': { email: false } } } },
    });
    assert(r.status === 200, JSON.stringify(r.json));
    assert(r.json?.data?.preferences?.partners, 'partners wiped');
    assert(r.json?.data?.preferences?.security?.['New Login']?.email === false, 'security missing');
  });

  await check('GET /api/audit-log (bell feed)', async () => {
    const r = await req(`${DASH}/api/audit-log`, { token });
    assert(r.status === 200 && Array.isArray(r.json?.data), 'array');
    return `${r.json.data.length} events`;
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
