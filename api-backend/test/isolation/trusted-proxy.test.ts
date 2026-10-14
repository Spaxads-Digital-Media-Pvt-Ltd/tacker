/**
 * Proxy trust (lib/net/trusted-proxy.ts — every surface): only loopback, Cloudflare's PUBLISHED
 * ranges and TRACKING_TRUSTED_PROXIES may report a client address, and req.ip is the first
 * untrusted X-Forwarded-For hop walking from the right. Plus the production guard that rejects
 * direct (non-proxied) connections. No DB needed — /healthz never touches Postgres.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import Fastify from 'fastify';
import { buildTrustedProxyCheck, configuredProxies, CLOUDFLARE_IPV4, CLOUDFLARE_IPV6 } from '../../src/lib/net/trusted-proxy.js';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { env } from '../../src/config/env.js';

const trusted = buildTrustedProxyCheck();

describe('trusted proxy list', () => {
  it('matches Cloudflare\'s published ranges exactly (cloudflare.com/ips-v4, /ips-v6)', () => {
    expect([...CLOUDFLARE_IPV4].sort()).toEqual([
      '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '104.16.0.0/13', '104.24.0.0/14', '108.162.192.0/18',
      '131.0.72.0/22', '141.101.64.0/18', '162.158.0.0/15', '172.64.0.0/13', '173.245.48.0/20', '188.114.96.0/20',
      '190.93.240.0/20', '197.234.240.0/22', '198.41.128.0/17',
    ]);
    expect([...CLOUDFLARE_IPV6].sort()).toEqual([
      '2400:cb00::/32', '2405:8100::/32', '2405:b500::/32', '2606:4700::/32', '2803:f800::/32', '2a06:98c0::/29', '2c0f:f248::/32',
    ]);
  });
  it('trusts Cloudflare IPv4 and IPv6 edges (incl. IPv4-mapped IPv6)', () => {
    for (const ip of ['104.16.0.1', '162.159.255.254', '104.27.1.1', '173.245.63.255', '::ffff:104.16.0.1', '2606:4700::6810:84e5', '2a06:98c7:ffff::1', '2400:cb00:2049::1']) {
      expect(trusted(ip), ip).toBe(true);
    }
  });
  it('trusts loopback (Nginx on the same host / local dev)', () => {
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(trusted(ip), ip).toBe(true);
  });
  it('does NOT trust ranges the old hand-made list wrongly included, or anything else', () => {
    for (const ip of ['173.1.2.3', '141.1.2.3', '197.1.2.3', '198.51.100.7', '162.247.74.1', '185.45.0.1', '188.114.112.1',
      '203.0.113.7', '10.0.0.1', '192.168.1.10', '127.0.0.2', '0.0.0.0', '2001:db8::1', '2606:4701::1', 'fe80::1']) {
      expect(trusted(ip), ip).toBe(false);
    }
  });
  it('rejects empty / malformed peers', () => {
    for (const ip of ['', 'garbage', '1.2.3', '104.16.0.1/13', '::ffff:']) expect(trusted(ip), ip).toBe(false);
  });
  it('TRACKING_TRUSTED_PROXIES adds IPv4/IPv6 IPs and CIDRs; malformed entries are ignored, not widened', () => {
    const invalid: string[] = [];
    const t = buildTrustedProxyCheck(' 10.1.0.0/16, 192.0.2.5 ,fd00:1::/64, 2001:db8::7, nonsense, 10.2.0.0/99, 0.0.0.0/0/1', (e) => invalid.push(e));
    expect([t('10.1.200.3'), t('192.0.2.5'), t('fd00:1::abcd'), t('2001:db8::7')]).toEqual([true, true, true, true]);
    expect([t('10.2.0.1'), t('192.0.2.6'), t('fd00:2::1'), t('8.8.8.8')]).toEqual([false, false, false, false]);
    expect(invalid).toEqual(['nonsense', '10.2.0.0/99', '0.0.0.0/0/1']);
  });
});

describe('req.ip with the trust check (Fastify X-Forwarded-For walk)', () => {
  const app = Fastify({ trustProxy: (a: string) => trusted(a) });
  app.get('/ip', async (req) => ({ ip: req.ip }));
  const ipFor = async (remoteAddress: string, xff?: string) =>
    (await app.inject({ method: 'GET', url: '/ip', remoteAddress, headers: xff ? { 'x-forwarded-for': xff } : {} })).json().ip as string;

  it('local dev: a direct loopback request keeps 127.0.0.1', async () => {
    expect(await ipFor('127.0.0.1')).toBe('127.0.0.1');
    expect(await ipFor('::1')).toBe('::1');
  });
  it('Cloudflare IPv4 edge → client', async () => {
    expect(await ipFor('104.16.0.9', '203.0.113.7')).toBe('203.0.113.7');
  });
  it('Cloudflare IPv6 edge → client (IPv4 or IPv6 client)', async () => {
    expect(await ipFor('2606:4700::1', '203.0.113.7')).toBe('203.0.113.7');
    expect(await ipFor('2606:4700::1', '2001:db8::42')).toBe('2001:db8::42');
  });
  it('full chain Cloudflare → Nginx (loopback): a client-written left-hand entry is ignored', async () => {
    // Client sends "X-Forwarded-For: 6.6.6.6"; Cloudflare appends the client; Nginx appends the edge.
    expect(await ipFor('127.0.0.1', '6.6.6.6, 198.18.5.5, 104.16.0.9')).toBe('198.18.5.5');
    expect(await ipFor('127.0.0.1', '6.6.6.6, 1.1.1.1, 2001:db8::9, 2606:4700::1')).toBe('2001:db8::9');
  });
  it('an untrusted sender cannot set its IP — X-Forwarded-For is ignored entirely', async () => {
    expect(await ipFor('198.18.0.9', '1.2.3.4')).toBe('198.18.0.9');
    expect(await ipFor('2001:db8::5', '1.2.3.4, 104.16.0.9')).toBe('2001:db8::5');
    // 173.x was "Cloudflare" in the old list (173.0.0.0/8) — no longer trusted.
    expect(await ipFor('173.1.2.3', '1.2.3.4')).toBe('173.1.2.3');
  });
  it('a forged "trusted" hop in the middle of the chain is not skipped past an untrusted one', async () => {
    expect(await ipFor('104.16.0.9', '6.6.6.6, 104.16.0.1, 198.18.7.7')).toBe('198.18.7.7');
  });
});

describe('production guard: direct (non-proxied) connections are rejected', () => {
  let app: ReturnType<typeof buildTrackingApp>;
  const original = env.NODE_ENV;
  beforeAll(async () => { app = buildTrackingApp(); await app.ready(); });
  afterEach(() => { (env as { NODE_ENV: string }).NODE_ENV = original; });

  const health = (remoteAddress: string, xff?: string) =>
    app.inject({ method: 'GET', url: '/healthz', remoteAddress, headers: xff ? { 'x-forwarded-for': xff } : {} });

  it('in production an untrusted peer gets 403 even with a forged X-Forwarded-For', async () => {
    (env as { NODE_ENV: string }).NODE_ENV = 'production';
    expect((await health('198.18.0.9')).statusCode).toBe(403);
    expect((await health('173.1.2.3', '104.16.0.1')).statusCode).toBe(403);
    expect((await health('2001:db8::5')).statusCode).toBe(403);
  });
  it('in production Cloudflare (IPv4 / IPv6) and loopback Nginx are let through', async () => {
    (env as { NODE_ENV: string }).NODE_ENV = 'production';
    for (const peer of ['104.16.0.9', '2606:4700::1', '127.0.0.1']) expect((await health(peer, '203.0.113.7')).statusCode, peer).toBe(200);
  });
  it('in test/dev the guard is off (local work)', async () => {
    expect((await health('198.18.0.9')).statusCode).toBe(200);
  });
});

describe('TRUSTED_PROXIES (O2): `private` for a load balancer inside a VPC, merged with the older name', () => {
  it('`private` trusts RFC 1918 + IPv6 unique-local addresses, nothing public', () => {
    const check = buildTrustedProxyCheck('private');
    for (const ip of ['10.0.3.17', '172.16.0.1', '172.31.255.254', '192.168.1.20', 'fd12:3456::1', '::ffff:10.1.2.3']) expect(check(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '11.0.0.1', '2001:db8::1', '100.64.0.1']) expect(check(ip), ip).toBe(false);
    expect(check('104.16.0.1')).toBe(true); // Cloudflare stays trusted
  });
  it('keywords mix with CIDRs; unknown words are reported, never widened', () => {
    const bad: string[] = [];
    const check = buildTrustedProxyCheck('PRIVATE, cloudflare, 198.51.100.0/24, everything', (e) => bad.push(e));
    expect(check('198.51.100.9')).toBe(true);
    expect(check('10.9.9.9')).toBe(true);
    expect(check('203.0.113.1')).toBe(false);
    expect(bad).toEqual(['everything']);
  });
  it('configuredProxies merges TRUSTED_PROXIES with TRACKING_TRUSTED_PROXIES', () => {
    expect(configuredProxies({ TRUSTED_PROXIES: 'private', TRACKING_TRUSTED_PROXIES: '198.51.100.7' })).toBe('private,198.51.100.7');
    expect(configuredProxies({ TRUSTED_PROXIES: ' ', TRACKING_TRUSTED_PROXIES: undefined })).toBe('');
  });
});
