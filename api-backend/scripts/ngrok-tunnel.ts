/**
 * Expose the local tracking surface (port 4002) over a public ngrok URL and register that URL as a
 * verified tracking domain for the demo network — so external advertisers can hit /postback and
 * browsers can hit /click. Drives the system `ngrok` CLI (brew install ngrok) + its local 4040 API,
 * which is far more reliable than the npm wrapper. Keeps running until Ctrl-C.
 *
 * Auth token: NGROK_AUTHTOKEN from env (already saved to ngrok's config on first run). If ngrok is
 * not installed: `brew install ngrok`.
 * Run:  npm run tunnel
 */
import { spawn, execFileSync } from 'node:child_process';
import { query, closeDb } from '../src/lib/db/pool.js';
import { logger } from '../src/lib/logger.js';

const PORT = 4002;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readTunnelUrl(): Promise<string | null> {
  try {
    const res = await fetch('http://localhost:4040/api/tunnels');
    const data = (await res.json()) as { tunnels?: { public_url?: string }[] };
    return data.tunnels?.find((t) => t.public_url?.startsWith('https'))?.public_url ?? null;
  } catch { return null; }
}

async function main(): Promise<void> {
  const token = process.env['NGROK_AUTHTOKEN'];
  if (token) {
    try { execFileSync('ngrok', ['config', 'add-authtoken', token], { stdio: 'ignore' }); }
    catch { /* already saved / non-fatal */ }
  }

  const proc = spawn('ngrok', ['http', String(PORT), '--log', 'stdout'], { stdio: 'ignore' });
  proc.on('error', (e) => {
    logger.error({ err: e.message }, 'failed to start ngrok — is it installed? (brew install ngrok)');
    process.exit(1);
  });

  let url: string | null = null;
  for (let i = 0; i < 30 && !url; i++) { await sleep(1000); url = await readTunnelUrl(); }
  if (!url) { proc.kill(); throw new Error('ngrok did not report a tunnel URL within 30s'); }

  const host = new URL(url).host; // e.g. abc123.ngrok-free.dev (no port)
  const net = (await query<{ id: string }>(`SELECT id FROM networks WHERE slug = 'demo'`)).rows[0];
  if (!net) throw new Error('demo network not found — run npm run seed first');
  await query(
    `INSERT INTO tracking_domains (network_id, host, mode, status, verification_state, ssl_status, is_primary)
     VALUES ($1, $2, 'custom', 'active', 'verified', 'issued', false)
     ON CONFLICT (lower(host)) DO UPDATE SET status = 'active', verification_state = 'verified'`,
    [net.id, host],
  );

  logger.info({ url }, 'ngrok tunnel up + registered as tracking domain');
  // eslint-disable-next-line no-console
  console.log(`
✅ Public tracking URL:  ${url}
   (registered as an active tracking domain for the demo network)

Test a POSTBACK (what an external advertiser fires on conversion):
   curl -s "${url}/postback?click_id=<CLICK_ID>&txn_id=test-123&event=purchase&status=approved"

Get a <CLICK_ID> first with a click (add the header to skip ngrok's browser warning):
   curl -sI -H 'ngrok-skip-browser-warning: 1' "${url}/click?offer_id=<OFFER_UUID>&pub_id=<PUB_UUID>&geo=US"

Keep this running. Ctrl-C to stop.
`);

  const shutdown = () => { proc.kill(); void closeDb().finally(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'ngrok tunnel failed');
  void closeDb().finally(() => process.exit(1));
});
