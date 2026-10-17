/**
 * The harness behind the offer end-to-end suites (test/integration/offer-e2e-*.test.ts): offers configured
 * through the DASHBOARD API exactly as the UI saves them, clicks and conversions through the REAL tracking app
 * (/click, /sl, /postback), the real click-persist worker writing every click (accepted or rejected, with its
 * reason), and the real GeoIP code on MaxMind's test databases (test/fixtures/geoip) — so a setting that is
 * saved but not enforced shows up as a failure.
 *
 * Each click carries a unique sub5 marker so the stored row (country, device, flags, payout) is found exactly.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { Express } from 'express';
import type { FastifyInstance } from 'fastify';
import type { Worker } from 'bullmq';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { loadGeoIp } from '../../src/lib/geo/geoip.js';
import { query } from '../../src/lib/db/pool.js';
import { CLICK_REJECTION_REASONS } from '../../src/lib/click-rejections.js';
import { startClickPersistWorker } from '../../src/surfaces/workers/processors/click-persist.js';
import { getQueue, QUEUE } from '../../src/surfaces/workers/queues.js';
import { seedFixture, type Fixture } from './db.js';
import { operatorToken, bearer } from './tokens.js';

const fixture = (f: string) => fileURLToPath(new URL(`../fixtures/geoip/${f}`, import.meta.url));

export const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  bot: 'curl/8.4.0',
} as const;

/** Addresses with known answers in MaxMind's test databases (see test/fixtures/geoip/README.md). */
export const IP = {
  US_WA: '216.160.83.56',      // US, WA, Milton, 98354, DMA 819, ISP Century Link
  US_MOBILE: '149.101.100.1',  // US, Verizon Wireless (mobile carrier)
  GB_LONDON: '81.2.69.142',    // GB, ENG, London
  GB_BOXFORD: '2.125.160.216', // GB, ENG, Boxford, OX1
  SE: '89.160.20.112',         // SE, E, Linköping, ASN Bredband2
  CN: '175.16.199.0',          // CN, 22, Changchun
  PH: '202.196.224.0',         // PH
  JP: '2001:218::1',           // JP
  UNKNOWN: '10.0.0.1',         // not in the database
} as const;

export const CLOUDFLARE_EDGE = '173.245.48.10';

export interface ClickResult {
  status: number; location: string | undefined; clickId: string | null; json: Record<string, unknown> | null;
  /** The stored click (null if none was recorded). */
  row: Record<string, unknown> | null;
  /** Why it was rejected (its first flag, when that is a rejection reason), or null when it went to the offer. */
  reason: string | null;
}

export interface Lab {
  fx: Fixture; host: string; track: FastifyInstance; dash: Express; admin: Record<string, string>;
  api: <T = any>(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body?: unknown) => Promise<T>;
  apiRaw: (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body?: unknown) => Promise<request.Response>;
  offer: (body?: Record<string, unknown>, extra?: { geo?: Record<string, unknown>[]; goals?: Record<string, unknown>[]; approve?: string[] }) => Promise<{ id: string; ref: number }>;
  partner: (status?: 'active' | 'pending' | 'inactive') => Promise<string>;
  click: (offerId: string, opts?: ClickOpts) => Promise<ClickResult>;
  postback: (params: Record<string, string | undefined>, opts?: { secureCode?: string | null }) => Promise<{ status: number; body: any }>;
  conversion: (conversionId: string) => Promise<Record<string, any> | null>;
  close: () => Promise<void>;
}

export interface ClickOpts {
  pub?: string | null; ip?: string; ua?: string | null; lang?: string; referer?: string; qs?: string; remote?: string; cf?: string;
  path?: '/click' | '/sl';
  /** Skip waiting for the stored row (e.g. a smart-link hop). */
  noRow?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startLab(name: string): Promise<Lab> {
  await loadGeoIp({ city: fixture('GeoIP2-City-Test.mmdb'), asn: fixture('GeoLite2-ASN-Test.mmdb'), isp: fixture('GeoIP2-ISP-Test.mmdb') });
  const fx = await seedFixture(`${name}-${randomUUID().slice(0, 8)}`);
  const host = `${name}-${randomUUID().slice(0, 8)}.test`;
  await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
  setHostResolver(new DbHostResolver());
  const track = buildTrackingApp();
  await track.ready();
  const dash = buildDashboardApp();
  const admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
  // Other files leave click jobs no worker took (test Redis only) — drop them, or ours would wait behind them.
  await getQueue(QUEUE.clickPersist).drain(true);
  const worker: Worker = startClickPersistWorker();

  const apiRaw: Lab['apiRaw'] = (method, path, body) => {
    const r = request(dash)[method](`/api${path}`).set(admin);
    return (body === undefined ? r : r.send(body as object)) as unknown as Promise<request.Response>;
  };
  const api: Lab['api'] = async (method, path, body) => {
    const r = await apiRaw(method, path, body);
    if (r.status >= 300) throw new Error(`${method.toUpperCase()} /api${path} → ${r.status} ${JSON.stringify(r.body?.error ?? r.body)}`);
    return r.body?.data;
  };
  let n = 0;
  const offer: Lab['offer'] = async (body = {}, extra = {}) => {
    const o = await api<{ id: string; ref: number }>('post', '/offers', {
      advertiserId: fx.advA, name: `E2E ${name} ${++n}`, status: 'active', defaultPayout: '5.00', defaultRevenue: '8.00',
      destinationUrl: 'https://adv.example.com/lp?cid={click_id}&s1={sub1}&o={offer_id}&p={publisher_id}&c={country}&d={device}',
      ...body,
    });
    for (const g of extra.geo ?? []) await api('post', `/offers/${o.id}/geo-rules`, { action: 'allow', ...g });
    for (const g of extra.goals ?? []) await api('post', `/offers/${o.id}/goals`, g);
    for (const p of extra.approve ?? []) await api('post', `/offers/${o.id}/publishers`, { publisherId: p, access: 'allow', approvalStatus: 'approved' });
    return o;
  };
  const partner: Lab['partner'] = async (status = 'active') =>
    (await api<{ id: string }>('post', '/publishers', { name: `E2E partner ${++n}`, status })).id;

  const click: Lab['click'] = async (offerId, opts = {}) => {
    const marker = `m${randomUUID().slice(0, 12)}`;
    const pub = opts.pub === undefined ? fx.pubA1 : opts.pub;
    const qs = [opts.path === '/sl' ? `id=${offerId}` : `offer_id=${offerId}`, pub ? `pub_id=${pub}` : '', opts.qs ?? '', `sub5=${marker}`].filter(Boolean).join('&');
    const headers: Record<string, string> = { host };
    if (opts.ua !== null) headers['user-agent'] = opts.ua ?? UA.windows;
    if (opts.ip) headers['x-forwarded-for'] = opts.ip;
    if (opts.lang) headers['accept-language'] = opts.lang;
    if (opts.referer) headers['referer'] = opts.referer;
    if (opts.cf) headers['cf-ipcountry'] = opts.cf;
    const res = await track.inject({ method: 'GET', url: `${opts.path ?? '/click'}?${qs}`, headers, ...(opts.remote ? { remoteAddress: opts.remote } : {}) });
    const location = res.headers['location'] as string | undefined;
    let json: Record<string, unknown> | null = null;
    try { json = res.headers['content-type']?.toString().includes('json') ? res.json() : null; } catch { json = null; }
    const target = (json?.['data'] as { redirect_url?: string } | undefined)?.redirect_url ?? location;
    const clickId = target && /^https?:/.test(target) ? new URL(target).searchParams.get('cid') : ((json?.['data'] as { click_id?: string } | undefined)?.click_id ?? null);
    let row: Record<string, unknown> | null = null;
    if (!opts.noRow) {
      for (let i = 0; i < 60 && !row; i++) {
        row = (await query(`SELECT click_id, country, region, city, isp, device, os, browser, ip, user_agent, referrer, sub1, sub2, sub3, fraud_score, fraud_flags,
                                   is_unique, resolved_payout::text AS payout, resolved_revenue::text AS revenue, currency, publisher_id, smart_link_id
                              FROM clicks WHERE network_id = $1 AND sub5 = $2`, [fx.networkA, marker])).rows[0] ?? null;
        if (!row) await sleep(100);
      }
    }
    const first = (row?.['fraud_flags'] as string[] | undefined)?.[0];
    const reason = first && (CLICK_REJECTION_REASONS as readonly string[]).includes(first) ? first : null;
    return { status: res.statusCode, location, clickId, json, row, reason };
  };

  const postback: Lab['postback'] = async (params, opts = {}) => {
    const p = new URLSearchParams();
    const code = opts.secureCode === undefined ? fx.secureCodeA : opts.secureCode;
    if (code) p.set('secure_code', code);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) p.set(k, v);
    const r = await track.inject({ method: 'GET', url: `/postback?${p.toString()}`, headers: { host } });
    let body: unknown = null;
    try { body = r.json(); } catch { body = r.body; }
    return { status: r.statusCode, body };
  };

  const conversion: Lab['conversion'] = async (conversionId) => (await query(
    `SELECT conversion_id, status, reason, event_name, goal_id, payout::text AS payout, revenue::text AS revenue, currency, publisher_id, raw_params
       FROM conversions WHERE conversion_id = $1`, [conversionId])).rows[0] ?? null;

  const close = async () => { await worker.close(); await track.close(); };
  return { fx, host, track, dash, admin, api, apiRaw, offer, partner, click, postback, conversion, close };
}
