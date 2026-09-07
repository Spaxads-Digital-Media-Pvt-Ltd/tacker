/**
 * Automation module API smoke — network-wide scheduled actions.
 * Run: npx tsx scripts/automation-smoke.ts
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
  console.log(`${c.dim}Automation smoke → ${DASH}/api/automation/scheduled-actions${c.reset}\n`);

  let token = '';
  await check('Login', async () => {
    const r = await req(`${DASH}/api/auth/login`, { method: 'POST', body: ADMIN });
    assert(r.status === 200, `status ${r.status}`);
    token = r.json?.data?.accessToken;
    assert(token, 'no token');
  });
  if (!token) process.exit(1);

  const base = `${DASH}/api/automation/scheduled-actions`;
  let actionId = '';
  let offerId = '';

  await check('GET /offers (pick offer for action)', async () => {
    const r = await req(`${DASH}/api/offers?limit=5`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json?.data) && r.json.data.length > 0, 'need an offer');
    offerId = r.json.data[0].id;
    return r.json.data[0].name;
  });

  await check('GET /automation/scheduled-actions (list)', async () => {
    const r = await req(base, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json?.data), 'expected data array');
    return `${r.json.data.length} action(s)`;
  });

  await check('POST /automation/scheduled-actions (create)', async () => {
    const scheduled = new Date();
    scheduled.setDate(scheduled.getDate() + 7);
    const r = await req(base, {
      method: 'POST', token,
      body: {
        offerId,
        actionType: 'pause',
        partnerIds: [],
        event: 'smoke-test',
        scheduledTime: scheduled.toISOString(),
        internalNotes: 'automation smoke',
        status: 'pending',
      },
    });
    assert(r.status === 201, `status ${r.status} ${JSON.stringify(r.json)}`);
    actionId = r.json?.data?.id;
    assert(actionId, 'no id');
    assert(r.json?.data?.offerId === offerId, 'offerId mismatch');
    return `displayId=${r.json.data.displayId}`;
  });

  await check('GET /automation/scheduled-actions?status=pending (filter)', async () => {
    const r = await req(`${base}?status=pending`, { token });
    assert(r.status === 200, `status ${r.status}`);
    const found = r.json?.data?.find((x: { id: string }) => x.id === actionId);
    assert(found, 'created action not in pending filter');
  });

  await check('PATCH /automation/scheduled-actions/:id (update)', async () => {
    const r = await req(`${base}/${actionId}`, {
      method: 'PATCH', token,
      body: { internalNotes: 'updated by smoke' },
    });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.internalNotes === 'updated by smoke', 'notes not updated');
  });

  await check('DELETE /automation/scheduled-actions/:id', async () => {
    const r = await req(`${base}/${actionId}`, { method: 'DELETE', token });
    assert(r.status === 200, `status ${r.status}`);
    actionId = '';
  });

  await check('Per-offer endpoint still works (GET /offers/:id/scheduled-actions)', async () => {
    const r = await req(`${DASH}/api/offers/${offerId}/scheduled-actions`, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json?.data), 'expected array');
  });

  const alertsBase = `${DASH}/api/automation/alert-rules`;
  let alertRuleId = '';

  await check('GET /automation/alert-rules (list)', async () => {
    const r = await req(alertsBase, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json?.data), 'expected data array');
    return `${r.json.data.length} rule(s)`;
  });

  await check('POST /automation/alert-rules (create)', async () => {
    const r = await req(alertsBase, {
      method: 'POST', token,
      body: {
        name: 'Smoke Alert Rule',
        conditions: 'Conversions drop below 2% for 24h',
        inApp: true,
        email: false,
        status: 'active',
      },
    });
    assert(r.status === 201, `status ${r.status} ${JSON.stringify(r.json)}`);
    alertRuleId = r.json?.data?.id;
    assert(alertRuleId, 'no id');
    assert(r.json?.data?.ref, 'missing ref');
    return `ref=${r.json.data.ref}`;
  });

  await check('PATCH /automation/alert-rules/:id (update)', async () => {
    const r = await req(`${alertsBase}/${alertRuleId}`, {
      method: 'PATCH', token,
      body: { email: true },
    });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.email === true, 'email not updated');
  });

  await check('DELETE /automation/alert-rules/:id', async () => {
    const r = await req(`${alertsBase}/${alertRuleId}`, { method: 'DELETE', token });
    assert(r.status === 200, `status ${r.status}`);
    alertRuleId = '';
  });

  const webhooksBase = `${DASH}/api/automation/webhooks`;
  let webhookId = '';

  await check('GET /automation/webhooks (list)', async () => {
    const r = await req(webhooksBase, { token });
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json?.data), 'expected data array');
    return `${r.json.data.length} webhook(s)`;
  });

  await check('POST /automation/webhooks (create)', async () => {
    const r = await req(webhooksBase, {
      method: 'POST', token,
      body: {
        name: 'Smoke Webhook',
        events: 'conversion.created, click.created',
        httpMethod: 'POST',
        url: 'https://example.com/webhooks/smoke',
        status: 'active',
      },
    });
    assert(r.status === 201, `status ${r.status} ${JSON.stringify(r.json)}`);
    webhookId = r.json?.data?.id;
    assert(webhookId, 'no id');
    assert(r.json?.data?.httpMethod === 'POST', 'method mismatch');
    return r.json.data.name;
  });

  await check('PATCH /automation/webhooks/:id (update)', async () => {
    const r = await req(`${webhooksBase}/${webhookId}`, {
      method: 'PATCH', token,
      body: { events: 'conversion.created' },
    });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.data?.events === 'conversion.created', 'events not updated');
  });

  await check('DELETE /automation/webhooks/:id', async () => {
    const r = await req(`${webhooksBase}/${webhookId}`, { method: 'DELETE', token });
    assert(r.status === 200, `status ${r.status}`);
    webhookId = '';
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
