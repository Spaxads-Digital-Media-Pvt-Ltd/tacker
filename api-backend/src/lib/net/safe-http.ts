/**
 * Outbound HTTP for URLs a tenant controls (partner postbacks, postback tests). Blocks SSRF:
 * only http/https, never follows redirects, and refuses loopback / private / link-local (cloud
 * metadata) / reserved addresses. The address check runs inside the socket's DNS lookup, so it
 * applies to the IP actually connected to — a DNS answer can't be swapped between check and use.
 * Private targets are allowed only in NODE_ENV=development, so a local receiver still works there.
 */
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { env } from '../../config/env.js';

export class BlockedDestinationError extends Error {
  constructor(public readonly reason: string) {
    super(`blocked_destination: ${reason}`);
    this.name = 'BlockedDestinationError';
  }
}

const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}

export function isPrivateAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isPrivateAddress(mapped[1]!);
  if (net.isIPv4(ip)) {
    const n = v4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (v4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === '::' || l === '::1' || /^f[cd]/.test(l) || /^fe[89ab]/.test(l) || l.startsWith('ff');
  }
  return true; // not an IP at all — refuse rather than guess
}

function defaultAllowPrivate(): boolean {
  return env.NODE_ENV === 'development';
}

export interface SafeResponse { status: number; body: string }

export interface SafeRequestOptions {
  method: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  /** Max response bytes kept (the rest is discarded). */
  maxBodyBytes?: number;
  /** Override the environment default (tests). */
  allowPrivate?: boolean;
}

/** Validate scheme + literal-IP host up front; throws BlockedDestinationError. */
export function assertOutboundUrl(raw: string, allowPrivate = defaultAllowPrivate()): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new BlockedDestinationError('malformed_url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new BlockedDestinationError('unsupported_scheme');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new BlockedDestinationError('no_host');
  if (!allowPrivate && net.isIP(host) && isPrivateAddress(host)) throw new BlockedDestinationError('private_address');
  return u;
}

export function safeRequest(raw: string, opts: SafeRequestOptions): Promise<SafeResponse> {
  const allowPrivate = opts.allowPrivate ?? defaultAllowPrivate();
  const url = assertOutboundUrl(raw, allowPrivate);
  const lib = url.protocol === 'https:' ? https : http;
  const maxBytes = opts.maxBodyBytes ?? 4096;

  // Runs for hostnames (Node skips lookup for IP literals, which assertOutboundUrl already checked).
  const lookup: net.LookupFunction = (hostname, options, cb) => {
    dns.lookup(hostname, { all: true }, (err, addrs) => {
      if (err) return cb(err, '', 0);
      const list = addrs as dns.LookupAddress[];
      if (!allowPrivate && list.some((a) => isPrivateAddress(a.address))) {
        return cb(new BlockedDestinationError('private_address'), '', 0);
      }
      if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
      const first = list[0];
      if (!first) return cb(new Error('no_address'), '', 0);
      cb(null, first.address, first.family);
    });
  };

  return new Promise<SafeResponse>((resolve, reject) => {
    const req = lib.request(url, {
      method: opts.method,
      headers: opts.headers,
      lookup,
      timeout: opts.timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => { if (size < maxBytes) { chunks.push(c); size += c.length; } });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { name: 'AbortError' })));
    req.on('error', reject);
    if (opts.body != null) req.write(opts.body);
    req.end();
  });
}
