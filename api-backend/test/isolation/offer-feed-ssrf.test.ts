/**
 * Offer-feed sync fetches through the SSRF guard (audit F-06). The feed URL is tenant-supplied; it
 * used to be a plain fetch() in every environment, so a feed URL could read internal services
 * (http://127.0.0.1:4005/health) or probe ports. Outside NODE_ENV=development (here: test) private,
 * loopback and link-local targets are refused before any request is made; public feeds still parse.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SafeRequestOptions, SafeResponse } from '../../src/lib/net/safe-http.js';
import { fetchFeed, FEED_MAX_BYTES } from '../../src/lib/integrations/offer-feed-sync.js';

// The real guard by default; individual tests hand back a canned response from a "public" feed.
const safe = vi.hoisted(() => ({ canned: [] as (SafeResponse | Error)[], calls: [] as { url: string; opts: SafeRequestOptions }[] }));
vi.mock('../../src/lib/net/safe-http.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/net/safe-http.js')>();
  return {
    ...actual,
    safeRequest: async (url: string, opts: SafeRequestOptions) => {
      safe.calls.push({ url, opts });
      const next = safe.canned.shift();
      if (next instanceof Error) throw next;
      return next ?? actual.safeRequest(url, opts);
    },
  };
});

const feed = [
  { id: 'ext-1', name: 'Feed Offer One', destinationUrl: 'https://brand.example/one?cid={click_id}', payout: '4.00', revenue: '6.00', currency: 'USD' },
  { offer_id: 'ext-2', title: 'Feed Offer Two', url: 'https://brand.example/two', status: 'paused' },
];
const ok = (body: string, extra: Partial<SafeResponse> = {}): SafeResponse => ({ status: 200, body, ...extra });

beforeEach(() => {
  safe.canned.length = 0;
  safe.calls.length = 0;
});

describe('private / internal feed URLs are blocked outside development', () => {
  let server: http.Server;
  let port = 0;
  let hits = 0;
  beforeAll(async () => {
    server = http.createServer((_req, res) => { hits++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(feed)); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it.each([
    ['loopback IP (the audit repro)', 'http://127.0.0.1:4005/health'],
    ['a hostname resolving to loopback', 'http://localhost:4005/health'],
    ['cloud metadata (link-local)', 'http://169.254.169.254/latest/meta-data/'],
    ['IPv6 loopback', 'http://[::1]:4005/'],
    ['private range', 'http://10.0.0.5/feed.json'],
  ])('%s → blocked_destination, nothing fetched', async (_label, url) => {
    await expect(fetchFeed(url, 'key')).rejects.toThrow(/^blocked_destination: private_address — offer feeds can only be fetched from public internet addresses$/);
  });

  it('a live local feed is never reached (literal IP and via DNS)', async () => {
    await expect(fetchFeed(`http://127.0.0.1:${port}/feed`, undefined)).rejects.toThrow(/blocked_destination/);
    await expect(fetchFeed(`http://localhost:${port}/feed`, undefined)).rejects.toThrow(/blocked_destination/);
    expect(hits).toBe(0);
  });

  it('non-http schemes are refused', async () => {
    await expect(fetchFeed('file:///etc/passwd', undefined)).rejects.toThrow(/blocked_destination: unsupported_scheme/);
    await expect(fetchFeed('gopher://feeds.example.com/', undefined)).rejects.toThrow(/blocked_destination: unsupported_scheme/);
  });
});

describe('a public feed still parses', () => {
  it('passes the auth headers, a 30 s timeout and the size cap; parses offers', async () => {
    safe.canned.push(ok(JSON.stringify(feed)));
    const offers = await fetchFeed('https://feeds.example.com/offers.json', 'secret-key');
    expect(offers.map((o) => [o.id, o.name, o.destinationUrl, o.status])).toEqual([
      ['ext-1', 'Feed Offer One', 'https://brand.example/one?cid={click_id}', 'active'],
      ['ext-2', 'Feed Offer Two', 'https://brand.example/two', 'paused'],
    ]);
    expect(safe.calls[0]).toEqual({
      url: 'https://feeds.example.com/offers.json',
      opts: {
        method: 'GET',
        headers: { accept: 'application/json', authorization: 'Bearer secret-key', 'x-api-key': 'secret-key' },
        timeoutMs: 30_000, deadlineMs: 30_000, maxBodyBytes: 16 * 1024 * 1024,
      },
    });
  });

  it('accepts { offers: [...] } / { data: [...] } and a UTF-8 BOM', async () => {
    safe.canned.push(ok(JSON.stringify({ offers: feed })), ok('﻿' + JSON.stringify({ data: feed })));
    expect(await fetchFeed('https://feeds.example.com/a', undefined)).toHaveLength(2);
    expect(await fetchFeed('https://feeds.example.com/b', undefined)).toHaveLength(2);
  });

  it('demo://offer-feed still short-circuits (no request)', async () => {
    expect(await fetchFeed('demo://offer-feed', undefined)).toHaveLength(3);
    expect(safe.calls).toHaveLength(0);
  });
});

describe('feed errors keep the "Feed …" messages', () => {
  it('non-2xx → Feed HTTP N; a redirect says it is not followed', async () => {
    safe.canned.push({ status: 500, body: 'oops' }, { status: 301, body: '' });
    await expect(fetchFeed('https://feeds.example.com/x', undefined)).rejects.toThrow(/^Feed HTTP 500$/);
    await expect(fetchFeed('https://feeds.example.com/x', undefined)).rejects.toThrow(/^Feed HTTP 301 \(redirects are not followed/);
  });

  it('oversize → Feed is larger than 16 MB; bad JSON; no valid offers; timeout', async () => {
    safe.canned.push(
      ok('[{"id":"1"', { truncated: true }),
      ok('<html>not json</html>'),
      ok(JSON.stringify([{ id: 'x', name: '', url: '' }])),
      Object.assign(new Error('timeout'), { name: 'AbortError' }),
    );
    expect(FEED_MAX_BYTES).toBe(16 * 1024 * 1024);
    await expect(fetchFeed('https://feeds.example.com/x', undefined)).rejects.toThrow(/^Feed is larger than 16 MB$/);
    await expect(fetchFeed('https://feeds.example.com/x', undefined)).rejects.toThrow(/^Feed is not valid JSON$/);
    await expect(fetchFeed('https://feeds.example.com/x', undefined)).rejects.toThrow(/^Feed returned no valid offers$/);
    await expect(fetchFeed('https://feeds.example.com/x', undefined)).rejects.toThrow(/^Feed request timed out after 30s$/);
  });
});
