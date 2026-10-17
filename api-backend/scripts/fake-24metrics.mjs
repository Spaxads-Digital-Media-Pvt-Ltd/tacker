// A local stand-in for the 24metrics gateway (lib/integrations/tracker24.ts) — to test the 24metrics integration
// without a 24metrics account. It answers the click API like 24metrics' own SDK endpoint and logs every call:
//
//   GET /<tracker id>/c?…&ip=…           → { data: { status: "approved", transaction_id } }  — or "rejected" (reason VPN)
//                                           for an address in REJECT_IPS (comma-separated; default 203.0.113.66)
//   GET /<tracker id>/api/event-tx?…     → 200 (a conversion report)
//
// Use it: run `npm run dev:fake-24metrics`, put TRACKER24_GATEWAY_URL=http://localhost:4799/{id} in api-backend/.env,
// restart `npm run dev`, and turn on "24metrics Tracker" on an offer with any tracker ID (e.g. demo).
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 4799);
const REJECT = new Set((process.env.REJECT_IPS ?? '203.0.113.66').split(',').map((s) => s.trim()).filter(Boolean));

createServer((req, res) => {
  const u = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const [, tracker, ...rest] = u.pathname.split('/');
  const path = `/${rest.join('/')}`;
  const p = Object.fromEntries(u.searchParams);
  const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (path === '/c') {
    const ip = p.ip ?? '';
    const rejected = REJECT.has(ip);
    console.log(`[24metrics:${tracker}] click ${p.external_transaction_id} from ${ip || '?'} → ${rejected ? 'REJECTED (VPN)' : 'approved'}`);
    return reply(200, { status: 200, data: rejected ? { status: 'rejected', reason: 'VPN' } : { status: 'approved', transaction_id: `fake-${p.external_transaction_id}` } });
  }
  if (path === '/api/event-tx') {
    console.log(`[24metrics:${tracker}] conversion report: transaction ${p.transaction_id}, payout ${p.payout ?? '-'}, revenue ${p.revenue ?? '-'}, event ${p.event ?? '-'}`);
    return reply(200, { status: 200, data: { status: 'processing' } });
  }
  return reply(404, { error: 'not found' });
}).listen(PORT, () => console.log(`fake 24metrics gateway on http://localhost:${PORT}/{id} — rejects: ${[...REJECT].join(', ') || 'nothing'}`));
