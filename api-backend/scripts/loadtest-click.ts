/**
 * Load test for the click hot path (spec §5 latency budget, §3B). Fires a sustained stream of
 * GET /click at the tracking surface with autocannon and prints the latency distribution
 * (p50/p90/p99) plus throughput, so we can watch the <30ms p95 budget as the system changes.
 *
 * Prereqs: the tracking surface running (npm run dev:tracking) and a seeded offer whose tracking
 * host resolves. Point it at your seeded demo host/offer.
 *
 * Usage:
 *   npm run loadtest -- --url "http://localhost:4002/click?offer_id=<OFFER>&pub_id=<PUB>" \
 *                       --host demo.ourtracking.com --duration 20 --connections 50
 *
 * The --host flag sets the Host header so the tracking surface resolves the tenant (it keys off the
 * tracking domain, not the TCP host).
 */
import autocannon from 'autocannon';

interface Args { url: string; host?: string; duration: number; connections: number; }

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const url = get('--url') ?? 'http://localhost:4002/click?offer_id=demo&pub_id=demo';
  return {
    url,
    host: get('--host'),
    duration: Number(get('--duration') ?? 15),
    connections: Number(get('--connections') ?? 50),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // eslint-disable-next-line no-console
  console.log(`load test → ${args.url}  (${args.connections} conns, ${args.duration}s${args.host ? `, Host: ${args.host}` : ''})`);

  const result = await autocannon({
    url: args.url,
    connections: args.connections,
    duration: args.duration,
    // Don't chase redirects — we're measuring OUR 302 latency, not the destination's.
    maxRedirects: 0,
    ...(args.host ? { headers: { host: args.host } } : {}),
  });

  const { latency, requests, throughput, non2xx, errors, timeouts } = result;
  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      `requests/sec : ${requests.average.toFixed(0)} (avg)`,
      `latency p50  : ${latency.p50} ms`,
      `latency p90  : ${latency.p90} ms`,
      `latency p99  : ${latency.p99} ms`,
      `latency max  : ${latency.max} ms`,
      `throughput   : ${(throughput.average / 1024).toFixed(1)} KB/s`,
      `non-2xx      : ${non2xx}   errors: ${errors}   timeouts: ${timeouts}`,
      '',
      latency.p99 <= 30 ? '✓ p99 within 30ms budget' : `⚠ p99 ${latency.p99}ms exceeds 30ms budget`,
    ].join('\n'),
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('load test failed:', err);
  process.exit(1);
});
