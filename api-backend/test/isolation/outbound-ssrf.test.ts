/**
 * SSRF guard for tenant-controlled outbound URLs (partner postbacks + postback "Test" buttons).
 * Before the guard, a tenant admin could fire http://169.254.169.254/... from our servers and the
 * Test endpoint returned the response body.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { isPrivateAddress, assertOutboundUrl, safeRequest, BlockedDestinationError } from '../../src/lib/net/safe-http.js';
import { firePostbackTest, sampleMacros } from '../../src/lib/postback/test.js';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254',
  ])('blocks %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111'])('allows %s', (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe('assertOutboundUrl', () => {
  it('rejects non-http schemes and private literal hosts', () => {
    expect(() => assertOutboundUrl('file:///etc/passwd', false)).toThrow(BlockedDestinationError);
    expect(() => assertOutboundUrl('http://169.254.169.254/latest/meta-data', false)).toThrow(/private_address/);
    expect(() => assertOutboundUrl('http://[::1]:8080/', false)).toThrow(/private_address/);
    expect(() => assertOutboundUrl('https://partner.example.com/pb?cid={click_id}', false)).not.toThrow();
  });
});

describe('safeRequest', () => {
  let server: http.Server;
  let port = 0;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/redirect') { res.writeHead(302, { location: 'http://169.254.169.254/' }); res.end(); return; }
      if (req.url === '/big') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('x'.repeat(10_000)); return; }
      if (req.url === '/drip') {
        // Keeps the socket busy (so the inactivity timeout never fires) but never finishes.
        res.writeHead(200, { 'content-type': 'text/plain' });
        const t = setInterval(() => res.write('.'), 20);
        res.on('close', () => clearInterval(t));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' }); res.end('hello');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('blocks a hostname that resolves to loopback (DNS path, not just literal IPs)', async () => {
    await expect(safeRequest(`http://localhost:${port}/`, { method: 'GET', timeoutMs: 2000, allowPrivate: false }))
      .rejects.toBeInstanceOf(BlockedDestinationError);
  });

  it('works when private targets are explicitly allowed', async () => {
    const r = await safeRequest(`http://localhost:${port}/`, { method: 'GET', timeoutMs: 2000, allowPrivate: true });
    expect(r.status).toBe(200);
    expect(r.body).toBe('hello');
  });

  it('never follows redirects', async () => {
    const r = await safeRequest(`http://127.0.0.1:${port}/redirect`, { method: 'GET', timeoutMs: 2000, allowPrivate: true });
    expect(r.status).toBe(302);
  });

  it('cuts a body longer than maxBodyBytes off there and flags it truncated (F-06)', async () => {
    const big = await safeRequest(`http://127.0.0.1:${port}/big`, { method: 'GET', timeoutMs: 2000, maxBodyBytes: 100, allowPrivate: true });
    expect(big).toMatchObject({ status: 200, truncated: true });
    expect(big.body).toBe('x'.repeat(100));
    const small = await safeRequest(`http://127.0.0.1:${port}/`, { method: 'GET', timeoutMs: 2000, maxBodyBytes: 100, allowPrivate: true });
    expect(small.truncated).toBeUndefined();
  });

  it('deadlineMs caps the whole exchange even while data keeps trickling in (F-06)', async () => {
    const started = Date.now();
    const err = await safeRequest(`http://127.0.0.1:${port}/drip`, {
      method: 'GET', timeoutMs: 5000, deadlineMs: 300, maxBodyBytes: 1_000_000, allowPrivate: true,
    }).catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('postback Test endpoint helper', () => {
  it('refuses cloud-metadata targets instead of returning their body', async () => {
    const r = await firePostbackTest('http://169.254.169.254/latest/meta-data/?c={click_id}', 'GET', sampleMacros());
    expect(r.ok).toBe(false);
    expect(r.body).toBeNull();
    expect(r.error).toMatch(/Blocked/);
  });
});
