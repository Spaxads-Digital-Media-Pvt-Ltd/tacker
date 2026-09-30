/**
 * IP targeting helpers. Exact entries accept IPv4 or IPv6; range entries accept IPv4 CIDR
 * (`203.0.113.0/24`) or an inclusive IPv4 span (`203.0.113.10-203.0.113.50`).
 */
import { isIP } from 'node:net';

function ipv4ToInt(ip: string): number | null {
  if (isIP(ip) !== 4) return null;
  return ip.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

/** Strip IPv4-mapped IPv6 prefix so `::ffff:1.2.3.4` compares as `1.2.3.4`. */
export function normalizeIp(ip: string): string {
  return ip.trim().toLowerCase().replace(/^::ffff:/, '');
}

export function isValidExactIp(v: string): boolean {
  return isIP(normalizeIp(v)) !== 0;
}

interface Span { lo: number; hi: number }

export function parseRange(v: string): Span | null {
  const s = v.trim();
  if (s.includes('/')) {
    const [net, bitsRaw] = s.split('/');
    const base = ipv4ToInt(net ?? '');
    const bits = Number(bitsRaw);
    if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    const lo = (base & mask) >>> 0;
    return { lo, hi: (lo | (~mask >>> 0)) >>> 0 };
  }
  if (s.includes('-')) {
    const [a, b] = s.split('-').map((x) => x.trim());
    const lo = ipv4ToInt(a ?? '');
    const hi = ipv4ToInt(b ?? '');
    if (lo === null || hi === null || lo > hi) return null;
    return { lo, hi };
  }
  return null;
}

export function isValidIpRange(v: string): boolean {
  return parseRange(v) !== null;
}

export function ipInRange(ip: string, range: string): boolean {
  const n = ipv4ToInt(normalizeIp(ip));
  const span = parseRange(range);
  return n !== null && span !== null && n >= span.lo && n <= span.hi;
}
