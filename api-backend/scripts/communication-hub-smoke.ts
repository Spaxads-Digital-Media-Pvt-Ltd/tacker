/**
 * Communication Hub module API smoke — verifies all CRUD routes and overview/settings wiring.
 * Run: npx tsx scripts/communication-hub-smoke.ts
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
  console.log(`${c.dim}Communication Hub smoke → ${DASH}/api/communication-hub${c.reset}\n`);

  let token = '';
  await check('Login', async () => {
    const r = await req(`${DASH}/api/auth/login`, { method: 'POST', body: ADMIN });
    assert(r.status === 200, `status ${r.status}`);
    token = r.json?.data?.accessToken;
    assert(token, 'no token');
  });
  if (!token) process.exit(1);

  const base = `${DASH}/api/communication-hub`;
  let audienceId = '';
  let templateId = '';
  let emailId = '';
  let bannerId = '';

  await check('GET /overview', async () => {
    const r = await req(`${base}/overview`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.emails !== undefined, 'missing emails stats');
    assert(r.json?.data?.banners !== undefined, 'missing banners stats');
    assert(r.json?.data?.systemEmailsTotal === 14, `expected 14 system emails, got ${r.json?.data?.systemEmailsTotal}`);
    return `audiences=${r.json.data.audiencesTotal}, templates=${r.json.data.templatesTotal}`;
  });

  await check('GET /system-emails', async () => {
    const r = await req(`${base}/system-emails`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json?.data) && r.json.data.length === 14, 'expected 14 entries');
    return `${r.json.data.filter((e: { enabled: boolean }) => e.enabled).length} enabled`;
  });

  await check('PUT /system-emails/:key (toggle)', async () => {
    const r = await req(`${base}/system-emails/partner_signup_approved`, {
      method: 'PUT', token, body: { enabled: false },
    });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.enabled === false, 'toggle not persisted');
    const get = await req(`${base}/system-emails`, { token });
    const entry = get.json?.data?.find((e: { key: string }) => e.key === 'partner_signup_approved');
    assert(entry?.enabled === false, 'read-back failed');
    await req(`${base}/system-emails/partner_signup_approved`, { method: 'PUT', token, body: { enabled: true } });
    return 'disabled + re-enabled';
  });

  await check('POST /audiences', async () => {
    const r = await req(`${base}/audiences`, {
      method: 'POST', token,
      body: { name: 'Smoke Test Audience', groupType: 'publishers', statusFilter: ['active'] },
    });
    assert(r.status === 201, `status ${r.status}`);
    audienceId = r.json?.data?.id;
    assert(audienceId, 'no audience id');
  });

  await check('GET /audiences', async () => {
    const r = await req(`${base}/audiences`, { token });
    assert(r.status === 200, `status ${r.status}`);
    const found = r.json?.data?.find((a: { id: string }) => a.id === audienceId);
    assert(found, 'created audience not in list');
    assert(typeof found.recipientCount === 'number', 'missing recipientCount');
    return `${found.recipientCount} recipients`;
  });

  await check('PUT /audiences/:id', async () => {
    const r = await req(`${base}/audiences/${audienceId}`, {
      method: 'PUT', token,
      body: { name: 'Smoke Test Audience Updated', groupType: 'publishers', statusFilter: ['active', 'pending'] },
    });
    assert(r.status === 200, `status ${r.status}`);
  });

  await check('POST /templates', async () => {
    const r = await req(`${base}/templates`, {
      method: 'POST', token,
      body: { name: 'Smoke Template', messageType: 'general', subject: 'Hello', body: 'Smoke body text' },
    });
    assert(r.status === 201, `status ${r.status}`);
    templateId = r.json?.data?.id;
    assert(templateId, 'no template id');
  });

  await check('GET /templates', async () => {
    const r = await req(`${base}/templates`, { token });
    assert(r.status === 200, `status ${r.status}`);
    const found = r.json?.data?.find((t: { id: string }) => t.id === templateId);
    assert(found?.body === 'Smoke body text', 'body missing from list');
  });

  await check('PUT /templates/:id', async () => {
    const r = await req(`${base}/templates/${templateId}`, {
      method: 'PUT', token,
      body: { name: 'Smoke Template Updated', messageType: 'offer_details', subject: 'Updated', body: 'Updated body' },
    });
    assert(r.status === 200, `status ${r.status}`);
  });

  await check('POST /emails (draft)', async () => {
    const r = await req(`${base}/emails`, {
      method: 'POST', token,
      body: {
        subject: 'Smoke Draft Email',
        body: 'Draft body content for smoke test',
        messageType: 'general',
        audienceId,
        action: 'draft',
      },
    });
    assert(r.status === 201, `status ${r.status}`);
    emailId = r.json?.data?.id;
    assert(emailId, 'no email id');
    assert(r.json?.data?.status === 'draft', 'expected draft status');
  });

  await check('GET /emails?status=draft', async () => {
    const r = await req(`${base}/emails?status=draft`, { token });
    assert(r.status === 200, `status ${r.status}`);
    const found = r.json?.data?.find((e: { id: string }) => e.id === emailId);
    assert(found, 'draft not in list');
    assert(found.body === undefined, 'list should omit body (frontend uses GET /emails/:id)');
  });

  await check('GET /emails/:id (full body)', async () => {
    const r = await req(`${base}/emails/${emailId}`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.body === 'Draft body content for smoke test', 'body mismatch');
    assert(r.json?.data?.audienceId === audienceId, 'audienceId missing');
  });

  await check('PUT /emails/:id', async () => {
    const r = await req(`${base}/emails/${emailId}`, {
      method: 'PUT', token,
      body: {
        subject: 'Smoke Draft Email Updated',
        body: 'Updated draft body',
        messageType: 'general',
        audienceId,
      },
    });
    assert(r.status === 200, `status ${r.status}`);
    const get = await req(`${base}/emails/${emailId}`, { token });
    assert(get.json?.data?.subject === 'Smoke Draft Email Updated', 'subject not updated');
  });

  await check('POST /emails/:id/send', async () => {
    const r = await req(`${base}/emails/${emailId}/send`, { method: 'POST', token });
    assert(r.status === 200, `status ${r.status}`);
    // Without SMTP config, send may stay draft with sendError — that's valid wiring.
    const status = r.json?.data?.status;
    assert(status === 'sent' || r.json?.data?.sendError, 'expected sent or sendError');
    return status === 'sent' ? 'sent' : `draft with error: ${r.json.data.sendError?.slice(0, 60)}`;
  });

  await check('GET /emails?status=sent', async () => {
    const r = await req(`${base}/emails?status=sent`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json?.data), 'expected array');
  });

  await check('POST /banners (draft)', async () => {
    const r = await req(`${base}/banners`, {
      method: 'POST', token,
      body: { name: 'Smoke Banner', message: 'Banner message', priority: 'default', saveAsDraft: true },
    });
    assert(r.status === 201, `status ${r.status}`);
    bannerId = r.json?.data?.id;
    assert(bannerId, 'no banner id');
    assert(r.json?.data?.status === 'draft', 'expected draft');
  });

  await check('GET /banners', async () => {
    const r = await req(`${base}/banners`, { token });
    assert(r.status === 200, `status ${r.status}`);
    const found = r.json?.data?.find((b: { id: string }) => b.id === bannerId);
    assert(found, 'banner not in list');
  });

  await check('PUT /banners/:id (publish)', async () => {
    const r = await req(`${base}/banners/${bannerId}`, {
      method: 'PUT', token,
      body: { name: 'Smoke Banner Live', message: 'Published message', priority: 'high', saveAsDraft: false },
    });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.status === 'published', `expected published, got ${r.json?.data?.status}`);
  });

  await check('DELETE /banners/:id', async () => {
    const r = await req(`${base}/banners/${bannerId}`, { method: 'DELETE', token });
    assert(r.status === 200, `status ${r.status}`);
    bannerId = '';
  });

  await check('DELETE /templates/:id', async () => {
    const r = await req(`${base}/templates/${templateId}`, { method: 'DELETE', token });
    assert(r.status === 200, `status ${r.status}`);
    templateId = '';
  });

  await check('DELETE /audiences/:id', async () => {
    const r = await req(`${base}/audiences/${audienceId}`, { method: 'DELETE', token });
    assert(r.status === 200, `status ${r.status}`);
    audienceId = '';
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
