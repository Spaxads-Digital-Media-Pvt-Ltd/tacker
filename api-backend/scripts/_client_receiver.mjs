import http from 'node:http';
const hits = [];
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  hits.push({ t: new Date().toISOString().slice(11,19), path: u.pathname, params: Object.fromEntries(u.searchParams) });
  console.log('CLIENT RECEIVED ⇐', u.pathname, JSON.stringify(Object.fromEntries(u.searchParams)));
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, received: Object.fromEntries(u.searchParams) }));
}).listen(4999, () => console.log('✅ mock CLIENT listening on http://localhost:4999 (returns 200)'));
