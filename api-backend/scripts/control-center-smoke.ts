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

  await check('PUT /control-center/config/partners (portal + signup + dashboard + referral + terms)', async () => {
    const r = await req(`${CC}/config/partners`, {
      method: 'PUT', token,
      body: {
        portal: { hideTotalClick: true, showAccountManagerDetails: true, htmlCustomHeader: '<p>H</p>' },
        signup: { autoApprovePartners: true, language: 'English', customSignUpHeader: 'Welcome' },
        dashboard: { cards: { Clicks: true, Conversions: false } },
        referral: { enabled: true, method: 'Tracking link', commissionType: 'Percentage', duration: 'Lifetime', fixedAmountRate: '10%', minimumThreshold: '0' },
        terms: { enforce: true, content: 'Smoke terms' },
        notifications: { offers: { 'Offer Status Changed': { inApp: true, email: false } } },
      },
    });
    assert(r.status === 200, JSON.stringify(r.json));
  });

  await check('GET /control-center/config/partners round-trip', async () => {
    const r = await req(`${CC}/config/partners`, { token });
    assert(r.status === 200, `status ${r.status}`);
    const d = r.json?.data ?? {};
    assert(d.portal?.hideTotalClick === true, 'portal not saved');
    assert(d.signup?.autoApprovePartners === true, 'signup not saved');
    assert(d.dashboard?.cards?.Clicks === true, 'dashboard not saved');
    assert(d.referral?.enabled === true, 'referral not saved');
    assert(d.terms?.enforce === true, 'terms not saved');
    assert(d.notifications?.offers?.['Offer Status Changed']?.email === false, 'notifications not saved');
  });

  let refId = '';
  await check('POST /control-center/partner-referrals', async () => {
    const r = await req(`${CC}/partner-referrals`, {
      method: 'POST', token,
      body: { enabled: true, commissionStructure: 'Percentage', fixedAmountRate: '5%', duration: '30d' },
    });
    assert(r.status === 201, JSON.stringify(r.json));
    refId = r.json?.data?.id;
  });

  await check('GET /control-center/partner-referrals', async () => {
    const r = await req(`${CC}/partner-referrals?status=all`, { token });
    assert(r.status === 200 && Array.isArray(r.json?.data), 'array');
    assert(r.json.data.some((x: { id: string }) => x.id === refId), 'created override missing');
  });

  await check('DELETE /control-center/partner-referrals/:id', async () => {
    const r = await req(`${CC}/partner-referrals/${refId}`, { method: 'DELETE', token });
    assert(r.status === 200, `status ${r.status}`);
  });

  await check('POST + GET /control-center/terms-acceptances', async () => {
    const r = await req(`${CC}/terms-acceptances`, {
      method: 'POST', token,
      body: { partnerUser: 'smoke@test.com', userAgent: 'smoke', ipAddress: '127.0.0.1' },
    });
    assert(r.status === 201, JSON.stringify(r.json));
    const list = await req(`${CC}/terms-acceptances`, { token });
    assert(list.status === 200 && Array.isArray(list.json?.data), 'array');
    assert(list.json.data.some((x: { partnerUser: string }) => x.partnerUser === 'smoke@test.com'), 'acceptance missing');
  });

  await check('PUT /control-center/config/advertisers', async () => {
    const r = await req(`${CC}/config/advertisers`, {
      method: 'PUT', token,
      body: {
        general: { htmlCustomHeader: '<p>Adv H</p>', htmlCustomFooter: '<p>Adv F</p>', hideTotalClick: true },
        signup: {
          customSignUpHeader: 'Adv welcome', customSignUpConfirmation: 'Thanks',
          autoApproveAdvertisers: true, language: 'English', useExternalSignUpUrl: false,
        },
        notifications: { network: { 'Communication Hub Email (from network)': { email: false } } },
      },
    });
    assert(r.status === 200, JSON.stringify(r.json));
  });

  await check('GET /control-center/config/advertisers round-trip', async () => {
    const r = await req(`${CC}/config/advertisers`, { token });
    assert(r.status === 200, `status ${r.status}`);
    const d = r.json?.data ?? {};
    assert(d.general?.hideTotalClick === true, 'general not saved');
    assert(d.signup?.autoApproveAdvertisers === true, 'signup not saved');
    assert(d.notifications?.network?.['Communication Hub Email (from network)']?.email === false, 'notifications not saved');
  });

  await check('GET /custom-fields?entity=advertiser', async () => {
    const r = await req(`${DASH}/api/custom-fields?entity=advertiser`, { token });
    assert(r.status === 200 && Array.isArray(r.json?.data), 'array');
    return `${r.json.data.length} field(s)`;
  });

  await check('GET /custom-fields?entity=publisher', async () => {
    const r = await req(`${DASH}/api/custom-fields?entity=publisher`, { token });
    assert(r.status === 200 && Array.isArray(r.json?.data), 'array');
    return `${r.json.data.length} field(s)`;
  });

  await check('GET /api/keys/scopes', async () => {
    const r = await req(`${DASH}/api/keys/scopes`, { token });
    assert(r.status === 200 && Array.isArray(r.json?.data?.available), 'scopes');
    return `${r.json.data.available.length} scope(s)`;
  });

  let keyId = '';
  await check('POST /api/keys', async () => {
    const r = await req(`${DASH}/api/keys`, {
      method: 'POST', token,
      body: { name: 'cc-security-smoke', scopes: ['offers:read', 'reports:read'] },
    });
    assert(r.status === 201 && r.json?.data?.key, JSON.stringify(r.json));
    keyId = r.json.data.id;
    assert(r.json.data.scopes.includes('offers:read'), 'scope missing');
  });

  await check('GET /api/keys', async () => {
    const r = await req(`${DASH}/api/keys`, { token });
    assert(r.status === 200 && Array.isArray(r.json?.data), 'array');
    assert(r.json.data.some((k: { id: string }) => k.id === keyId), 'created key missing');
  });

  await check('DELETE /api/keys/:id (revoke)', async () => {
    const r = await req(`${DASH}/api/keys/${keyId}`, { method: 'DELETE', token });
    assert(r.status === 200 && r.json?.data?.revoked === true, JSON.stringify(r.json));
  });

  await check('PUT /control-center/config/security (MFA)', async () => {
    const r = await req(`${CC}/config/security`, {
      method: 'PUT', token,
      body: { mfa: { enableNetworkMfa: true, supportedMethods: 'Authenticator App', employees: {} } },
    });
    assert(r.status === 200, JSON.stringify(r.json));
  });

  await check('GET /control-center/config/security round-trip', async () => {
    const r = await req(`${CC}/config/security`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.mfa?.enableNetworkMfa === true, 'mfa not saved');
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
