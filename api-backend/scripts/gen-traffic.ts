/**
 * Synthetic traffic generator for local dashboard/reporting evaluation. NOT a load test — this
 * drives the REAL tracking endpoints the way live traffic would:
 *
 *   GET /click   -> 302 with a real click_id in the Location  (persisted async by the worker)
 *   GET /postback?click_id=... -> a real attributed conversion (recordConversion + ledger)
 *
 * No direct DB inserts, no hot-path changes. Offers/publishers are read from DATABASE_URL so it
 * always targets whatever DB the running surfaces use. Point it at a LOCAL/throwaway DB.
 *
 * Usage:
 *   DATABASE_URL=postgres://.../tracker_test \
 *   tsx scripts/gen-traffic.ts --clicks 600 --conv-rate 0.42 \
 *       --tracking http://localhost:4002 --host demo.ourtracking.com
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

interface Args {
  clicks: number;
  convRate: number;
  tracking: string;
  host: string;
  concurrency: number;
}

function parseArgs(argv: string[]): Args {
  const get = (f: string): string | undefined => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    clicks: Number(get('--clicks') ?? 600),
    convRate: Number(get('--conv-rate') ?? 0.42),
    tracking: get('--tracking') ?? 'http://localhost:4002',
    host: get('--host') ?? 'demo.ourtracking.com',
    concurrency: Number(get('--concurrency') ?? 12),
  };
}

const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
const chance = (p: number): boolean => Math.random() < p;

const SUB1 = ['fb', 'google', 'tiktok', 'native', 'email', 'push', 'seo', 'display'];
const EVENTS = ['purchase', 'purchase', 'purchase', 'signup', 'lead'];
// Weighted: mostly approved, some pending, a few rejected — so status columns have spread.
const STATUS = ['approved', 'approved', 'approved', 'approved', 'approved', 'pending', 'pending', 'rejected'];

/** Raw GET with an explicit Host header (undici/fetch silently drops Host — see smoke.ts). */
function rawGet(base: string, path: string, host: string): Promise<{ status: number; location: string | null }> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: u.hostname, port: u.port, path, method: 'GET', headers: { host } },
      (res) => {
        res.resume(); // drain
        res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location ?? null }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL is required');
  if (/supabase\.(co|com)/i.test(dbUrl)) {
    throw new Error('Refusing to run: DATABASE_URL points at a hosted Supabase project. Point it at a local/throwaway DB.');
  }

  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();
  const net = (await db.query<{ id: string }>(`SELECT id FROM networks WHERE slug = 'demo'`)).rows[0];
  if (!net) throw new Error("demo network not found — run `npm run seed` against this DB first");
  const offers = (await db.query<{ id: string }>(`SELECT id FROM offers WHERE network_id = $1 AND status = 'active'`, [net.id])).rows.map((r) => r.id);
  const pubs = (await db.query<{ id: string }>(`SELECT id FROM publishers WHERE network_id = $1 AND status = 'active'`, [net.id])).rows.map((r) => r.id);
  await db.end();
  if (offers.length === 0 || pubs.length === 0) throw new Error('need at least one active offer and publisher');

  // eslint-disable-next-line no-console
  console.log(`gen-traffic → ${args.tracking} (Host: ${args.host})  offers=${offers.length} pubs=${pubs.length}  clicks=${args.clicks} convRate=${args.convRate}`);

  let fired = 0, redirected = 0, diverted = 0, badclick = 0, convOk = 0, convDup = 0, convMiss = 0;
  let next = 0;

  async function worker(): Promise<void> {
    while (next < args.clicks) {
      const n = next++;
      void n;
      const offerId = pick(offers);
      const pubId = pick(pubs);
      const q = new URLSearchParams({
        offer_id: offerId, pub_id: pubId,
        sub1: pick(SUB1), sub2: 'gen-traffic', geo: 'US',
      });
      fired++;
      let loc: string | null = null;
      try {
        const r = await rawGet(args.tracking, `/click?${q.toString()}`, args.host);
        if (r.status === 302) { redirected++; loc = r.location; }
        else if (r.status === 204) { diverted++; }
        else { badclick++; }
      } catch {
        badclick++;
      }
      if (!loc) continue;

      const cid = new URL(loc, 'http://x').searchParams.get('cid') ?? new URL(loc, 'http://x').searchParams.get('click_id');
      if (!cid) continue;

      if (chance(args.convRate)) {
        const pq = new URLSearchParams({
          click_id: cid,
          txn_id: randomUUID(),
          event: pick(EVENTS),
          status: pick(STATUS),
        });
        try {
          const pr = await rawGet(args.tracking, `/postback?${pq.toString()}`, args.host);
          if (pr.status === 200) convOk++;
          else if (pr.status === 404) convMiss++;
          else convDup++;
        } catch {
          convMiss++;
        }
      }
      // tiny jitter so we're not a perfectly uniform burst
      if (Math.random() < 0.3) await new Promise((res) => setTimeout(res, Math.floor(Math.random() * 15)));
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, worker));

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    fired, redirected, diverted, badclick,
    conversions_sent: convOk + convDup + convMiss, conv_ok: convOk, conv_dup: convDup, conv_miss: convMiss,
  }, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('gen-traffic failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
