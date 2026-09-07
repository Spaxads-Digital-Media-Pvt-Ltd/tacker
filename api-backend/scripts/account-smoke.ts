/**
 * Account module smoke — /api/me/account, profile, logins, password, email.
 * Does NOT call anonymize (destructive). Restores profile fields after patch.
 * Run: npx tsx scripts/account-smoke.ts
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
  console.log(`Account smoke → ${DASH}\n`);
  const login = await req(`${DASH}/api/auth/login`, { method: 'POST', body: ADMIN });
  const token = login.json?.data?.accessToken as string | undefined;
  assert(token, `login failed: ${JSON.stringify(login.json)}`);

  let baseline: Record<string, unknown> = {};

  await check('GET /me/account', async () => {
    const r = await req(`${DASH}/api/me/account`, { token });
    assert(r.status === 200, JSON.stringify(r.json));
    const d = r.json?.data;
    assert(d?.email === ADMIN.email, `email=${d?.email}`);
    assert(typeof d?.ref === 'number', 'ref');
    assert(d?.name, 'name');
    baseline = d;
    return `ref=${d.ref} name=${d.name}`;
  });

  await check('PATCH /me/profile metadata', async () => {
    const r = await req(`${DASH}/api/me/profile`, {
      method: 'PATCH',
      token,
      body: {
        name: baseline['name'],
        title: 'Smoke Title',
        businessUnit: 'QA Unit',
        language: 'Spanish',
        timezone: 'America/New_York',
        phone: '+1-555-0100',
        address: '1 Test St',
        city: 'Austin',
        region: 'TX',
        country: 'US',
        postalCode: '78701',
      },
    });
    assert(r.status === 200, JSON.stringify(r.json));
    assert(r.json?.data?.ok === true, 'ok');
  });

  await check('GET profile round-trip', async () => {
    const r = await req(`${DASH}/api/me/account`, { token });
    const d = r.json?.data;
    assert(d?.title === 'Smoke Title', `title=${d?.title}`);
    assert(d?.businessUnit === 'QA Unit', `bu=${d?.businessUnit}`);
    assert(d?.language === 'Spanish', `lang=${d?.language}`);
    assert(d?.timezone === 'America/New_York', `tz=${d?.timezone}`);
    assert(d?.phone === '+1-555-0100', `phone=${d?.phone}`);
    assert(d?.city === 'Austin', `city=${d?.city}`);
  });

  await check('PATCH restore profile', async () => {
    const r = await req(`${DASH}/api/me/profile`, {
      method: 'PATCH',
      token,
      body: {
        name: baseline['name'],
        title: baseline['title'] ?? null,
        businessUnit: baseline['businessUnit'] ?? null,
        language: baseline['language'] ?? 'English',
        timezone: baseline['timezone'] ?? null,
        phone: baseline['phone'] ?? null,
        address: baseline['address'] ?? null,
        apartment: baseline['apartment'] ?? null,
        city: baseline['city'] ?? null,
        region: baseline['region'] ?? null,
        country: baseline['country'] ?? null,
        postalCode: baseline['postalCode'] ?? null,
      },
    });
    assert(r.status === 200, JSON.stringify(r.json));
  });

  await check('GET /me/logins', async () => {
    const r = await req(`${DASH}/api/me/logins`, { token });
    assert(r.status === 200, JSON.stringify(r.json));
    assert(Array.isArray(r.json?.data), 'array');
    return `${r.json.data.length} events`;
  });

  await check('PATCH /me/password (same demo password)', async () => {
    const r = await req(`${DASH}/api/me/password`, {
      method: 'PATCH',
      token,
      body: { password: ADMIN.password },
    });
    assert(r.status === 200 && r.json?.data?.ok === true, JSON.stringify(r.json));
  });

  await check('re-login after password', async () => {
    const r = await req(`${DASH}/api/auth/login`, { method: 'POST', body: ADMIN });
    assert(r.status === 200 && r.json?.data?.accessToken, JSON.stringify(r.json));
  });

  const tempEmail = `demo-admin+smoke-${Date.now()}@tracker.test`;
  await check('PATCH /me/email then restore', async () => {
    const change = await req(`${DASH}/api/me/email`, {
      method: 'PATCH',
      token,
      body: { email: tempEmail },
    });
    assert(change.status === 200 && change.json?.data?.email === tempEmail, JSON.stringify(change.json));

    // Re-auth with new email may be needed; use admin API via restore with same token first.
    const restore = await req(`${DASH}/api/me/email`, {
      method: 'PATCH',
      token,
      body: { email: ADMIN.email },
    });
    assert(restore.status === 200 && restore.json?.data?.email === ADMIN.email, JSON.stringify(restore.json));

    const verify = await req(`${DASH}/api/me/account`, { token });
    assert(verify.json?.data?.email === ADMIN.email, `email=${verify.json?.data?.email}`);
  });

  await check('POST /me/anonymize exists (skip execute)', async () => {
    // Method exists: OPTIONS/route registration — hit with empty wrong method check via 401 without token.
    const noAuth = await req(`${DASH}/api/me/anonymize`, { method: 'POST', body: {} });
    assert(noAuth.status === 401 || noAuth.status === 403, `expected auth fail got ${noAuth.status}`);
    return 'protected';
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
