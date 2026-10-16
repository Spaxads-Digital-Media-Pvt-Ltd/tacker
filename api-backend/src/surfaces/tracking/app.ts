/**
 * Tracking hot-path surface (spec §2.1 #1, §5) — click / postback / pixel / iframe.
 * Fastify for the latency budget. NO api-key auth; tenant resolved from the tracking DOMAIN.
 *
 * NON-NEGOTIABLE #1: the click path NEVER touches Postgres synchronously. Config comes from the
 * Redis cache (load-through), caps/dedup/velocity are atomic Redis ops, and the durable write is
 * deferred to a queue. The only goal after decisions are made is the fastest possible 302.
 */
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { buildHealthReport, buildLivenessReport, buildReadinessReport, errorEnvelope } from '../../lib/http/index.js';
import { resolveHostToNetwork } from '../../middleware/host-resolver.js';
import { lookupGeo, geoAvailable, carrierAvailable } from '../../lib/geo/geoip.js';
import { evaluateTargeting, primaryLanguage } from './targeting-eval.js';
import { resolveEntityId } from './ref-resolver.js';
import { getPartnerStatus } from './partner-status.js';
import { getNetworkIpBlacklist } from '../../lib/net/ip-lists.js';
import { getFraudConfigCached } from '../../lib/fraud/rules.js';
import { tierPayout } from '../../lib/partner-tiers.js';
import { parseUA } from '../../lib/ua.js';
import { logger } from '../../lib/logger.js';
import { buildTrustedProxyCheck, configuredProxies } from '../../lib/net/trusted-proxy.js';
import { SOURCE_PARAMS, firstNonBlank } from './click-params.js';
import { getOfferConfig } from './offer-cache.js';
import { evaluateTrafficControls } from './traffic-controls-eval.js';
import { isTrafficBlocked } from './traffic-blocking-eval.js';
import { evaluateGeoRules, resolveForcedGeo } from './geo-rules.js';
import {
 checkTrackingRateLimit, peekTrackingRateLimit, chargeTrackingRateLimit, CLICK_LIMIT, POSTBACK_LIMIT, POSTBACK_PER_CLICK_LIMIT,
} from '../../lib/tracking-rate-limit.js';
import { isClickCapped, isCustomClickCapped, clickCapReached } from './caps.js';
import { getSmartLinkConfig } from './smart-link-cache.js';
import { applicableSettings } from '../../lib/offer-settings/custom-settings.js';
import type { ClickRejectionReason } from '../../lib/click-rejections.js';
import { markUnique } from './dedup.js';
import { fraudPreSignals } from './fraud-presignals.js';
import { buildMacros, substituteMacros } from './macros.js';
import { enqueueClick, type ClickJob } from './click-job.js';
import { storeClickForAttribution } from './click-store.js';
import { recordConversion, SALE_AMOUNT_PARAMS, type RecordConversionResult } from './conversions/record.js';
import { logInbound, type InboundPostback } from './conversions/inbound-log.js';
import { clicksTotal, redirectLatency, metricsText, metricsContentType } from '../../lib/metrics.js';
import { captureError } from '../../lib/observability/sentry.js';
import { isRedirectUrlSafe, getRedirectUrlRejectReason } from '../../lib/url-security.js';

// 1x1 transparent GIF for the pixel endpoint.
const PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function firstStr(v: unknown): string | null {
 return typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Return the value only if it's a valid UUID (else null) — guards uuid columns downstream. */
/** A plain IPv4 / IPv6 address, else null (a visitor IP passed on a server-to-server click, D2). */
function asIp(v: string | null): string | null {
 const s = v?.trim() ?? '';
 return s && s.length <= 45 && isIP(s) ? s : null;
}

function asUuid(v: string | null): string | null {
 return v && UUID_RE.test(v) ? v : null;
}

/** Weighted-random pick of an offer_id from smart-link items (weight 0 excluded; ties → uniform). */
function pickWeighted(items: { offer_id: string; weight: number }[]): string | null {
 const pool = items.filter((i) => i.weight > 0);
 const usable = pool.length ? pool : items; // all-zero weights → uniform over all
 if (usable.length === 0) return null;
 const total = usable.reduce((s, i) => s + (pool.length ? i.weight : 1), 0);
 let r = Math.random() * total;
 for (const i of usable) { r -= pool.length ? i.weight : 1; if (r <= 0) return i.offer_id; }
 return usable[usable.length - 1]!.offer_id;
}

// A soft exit: divert to the offer's fallback if configured AND safe, else a neutral 204 (never a
// hard error to an end user — spec §5). Runtime guard (AP-3): old/bad DB values are caught here.
function divert(reply: FastifyReply, fallbackUrl: string | null, offerId?: string): FastifyReply {
 if (fallbackUrl && isRedirectUrlSafe(fallbackUrl)) {
 return reply.code(302).header('location', fallbackUrl).header('cache-control', 'no-store').send();
 }
 if (fallbackUrl && offerId) {
 reply.log.warn({ offerId, reason: 'unsafe_fallback_url' }, 'redirect_blocked');
 }
 return reply.code(204).send();
}

/** Priority mechanism: lowest Position wins (unset positions sort last, in list order among themselves). */
function pickByPriority(items: { offer_id: string; position: number | null }[]): string | null {
 if (!items.length) return null;
 const sorted = [...items].sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
 return sorted[0]!.offer_id;
}

// A smart link with no eligible offer diverts to its Catch-All Offer (via /click, so the normal
// caps/macros/attribution pipeline still applies) — or a neutral 204 if none is configured.

// Defense-in-depth (M-1): the tracking surface has no per-request auth, so the Host and
// X-Forwarded-For headers cannot be trusted unless the immediate socket peer is a known proxy.
// Cloudflare + nginx must be the only direct front-ends. A direct-connect attacker who bypasses
// them hits this check regardless of host-header spoofing. Skipped in dev/test for local work.
// Loopback, Cloudflare's published ranges (IPv4 + IPv6) and TRUSTED_PROXIES — see lib/net/trusted-proxy.ts.
const isTrustedProxy = buildTrustedProxyCheck(configuredProxies(env), (entry) =>
 logger.warn({ entry }, 'TRUSTED_PROXIES: ignoring malformed entry (not an IP, CIDR or "private")'));

/** `rateLimits`: the per-IP / per-click limits (default: on, except in development and tests). */
export function buildTrackingApp(opts: { rateLimits?: boolean } = {}): FastifyInstance {
 const rateLimits = opts.rateLimits ?? (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test');
 const app = Fastify({
 logger: { level: env.LOG_LEVEL },
 // Cloudflare → load balancer → us. X-Forwarded-For is walked from the RIGHT and only hops from a trusted
 // proxy (isTrustedProxy: loopback, Cloudflare, TRUSTED_PROXIES) are skipped, so req.ip is
 // the first untrusted address — the real client. `true` trusted every hop and took the LEFTMOST
 // entry, which the client itself can write (a spoofed "X-Forwarded-For: 1.2.3.4" became the click IP).
 // A direct connection (no trusted proxy in front) keeps its socket address — e.g. 127.0.0.1 locally.
 trustProxy: (address: string) => isTrustedProxy(address),
 disableRequestLogging: true, // hot path: we log our own compact line
 });

 // Defense-in-depth (M-1): reject direct (non-proxied) connections that could spoof Host /
 // X-Forwarded-For headers. Skipped in dev/test so local development still works.
 app.addHook('onRequest', async (req, reply) => {
 if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') return;
 const raw = req as unknown as { socket?: { remoteAddress?: string } };
 if (!isTrustedProxy(raw.socket?.remoteAddress ?? '')) {
 return reply.code(403).send(errorEnvelope('forbidden', 'Direct connection not allowed', 403));
 }
 });

 // Report unexpected handler errors to Sentry (no-op when disabled), then hand back to Fastify's
 // default error response — the hot path must still fail fast and cheap.
 app.setErrorHandler((err, req, reply) => {
  const errCode = (err as any).code || 'internal';
  const errMsg = (err as any).message || 'Internal server error';
  captureError(err, { url: req.url, code: errCode });
  req.log.error({ err, code: errCode }, 'tracking handler error');
  reply.code(err.statusCode ?? 500).send(errorEnvelope(errCode, errMsg, err.statusCode ?? 500));
 });

 app.get('/health', async (_req, reply) => {
 const report = await buildHealthReport('tracking');
 return reply.code(report.status === 'unready' ? 503 : 200).send(report);
 });

 // Health/liveness/readiness probes (from origin/main — combined with security branch).
 app.get('/healthz', (_req, reply) => {
 return reply.code(200).send(buildLivenessReport('tracking'));
 });

 app.get('/readyz', async (_req, reply) => {
 const report = await buildReadinessReport('tracking');
 return reply.code(report.status === 'unready' ? 503 : 200).send(report);
 });

 // Prometheus scrape endpoint (spec §2). Fastify has no res buffering concern here.
 app.get('/metrics', async (_req, reply) => {
 return reply.header('content-type', metricsContentType).send(await metricsText());
 });

 // Record click hot-path latency + outcome for EVERY /click response, regardless of which exit
 // path it took (redirect / divert / error). reply.elapsedTime is ms; the histogram is seconds.
 app.addHook('onResponse', (req, reply, done) => {
 if (req.url.split('?')[0] === '/click') {
 redirectLatency.observe(reply.elapsedTime / 1000);
 const code = reply.statusCode;
 const outcome = code === 302 ? 'redirect' : code === 204 ? 'divert' : code === 404 ? 'unknown_host' : code === 400 ? 'bad_request' : 'other';
 clicksTotal.inc({ outcome });
 }
 done();
 });

 // Certificate "ask" hook for the edge (F-15): an on-demand-TLS proxy (Caddy `on_demand_tls ask`,
 // and similar) calls this before issuing a certificate for an incoming hostname. 200 only for a host
 // that is active + verified — exactly the hosts /click serves — so nobody can make the edge mint
 // certificates for arbitrary names. See lib/tracking-domains/verify.ts.
 app.get('/_tls/ask', async (req, reply) => {
 const domain = firstStr((req.query as Record<string, unknown>)['domain'])?.trim().toLowerCase() ?? '';
 if (!domain || domain.length > 253) return reply.code(400).send(errorEnvelope('bad_request', 'domain is required', 400));
 return (await resolveHostToNetwork(domain))
 ? reply.code(200).send({ ok: true, data: { domain } })
 : reply.code(404).send(errorEnvelope('not_found', 'unknown_or_unverified_host', 404));
 });

 app.get('/click', async (req, reply) => {
 const started = process.hrtime.bigint();

 // 0. Rate limit (AP-1): fail fast before any infra work. Skipped in dev/test.
 if (rateLimits) {
 const clientIp = (req.ip as string | undefined) ?? (req as { socket?: { remoteAddress?: string } }).socket?.remoteAddress ?? 'unknown';
 const rl = await checkTrackingRateLimit(clientIp, 'click', CLICK_LIMIT);
 if (rl.limited) {
 req.log.warn({ endpoint: '/click', limited: true, count: rl.count }, 'rate_limited');
 return reply.code(429).header('retry-after', String(rl.retryAfterSeconds)).send(errorEnvelope('rate_limited', 'Too many requests', 429));
 }
 }

 // 1. Resolve tenant from the tracking host.
 const host = (req.headers.host ?? '').toString();
 const tenant = await resolveHostToNetwork(host);
 if (!tenant) return reply.code(404).send(errorEnvelope('not_found', 'unknown_tracking_host', 404));

 const q = req.query as Record<string, unknown>;
 const rawOfferId = firstStr(q['offer_id']) ?? firstStr(q['o']);
 if (!rawOfferId) return reply.code(400).send(errorEnvelope('bad_request', 'missing_offer_id', 400));
 // offer_id / pub_id accept either the full UUID or the short numeric ref (e.g. offer_id=190).
 const offerId = await resolveEntityId('offer', tenant.networkId, rawOfferId);
 if (!offerId) return divert(reply, null);
 // publisher_id is a UUID column downstream (clicks/conversions). Ignore a malformed value rather
 // than 500 the conversion later — a bad pub_id shouldn't break attribution or the redirect.
 const requestedPublisherId = await resolveEntityId('publisher', tenant.networkId, firstStr(q['pub_id']) ?? firstStr(q['aff_id']) ?? firstStr(q['p']));
 const smartLinkId = asUuid(firstStr(q['sl'])); // set when a smart link routed this click
 const subs = [1, 2, 3, 4, 5].map((i) => firstStr(q[`sub${i}`]));
 // Blank / whitespace-only → null, and a blank alias falls through (source_id → source → src).
 const sourceId = firstNonBlank(q, SOURCE_PARAMS);

 // 2. Offer config + partner status from Redis (load-through, in parallel). No sync Postgres read
 // on the hot path — Postgres is only the cold-cache fallback.
 const [offer, partnerStatus, ipBlacklist, fraudCfg] = await Promise.all([
 getOfferConfig(tenant.networkId, offerId),
 requestedPublisherId ? getPartnerStatus(tenant.networkId, requestedPublisherId) : null,
 getNetworkIpBlacklist(tenant.networkId),
 getFraudConfigCached(tenant.networkId),
 ]);
 if (!offer) return divert(reply, null);

 // 2a. Who the visitor is (D2). A server-to-server click (format=json on an offer that allows it)
 // comes from the partner's server, so the connection's IP and user agent describe that server. When
 // it passes the VISITOR's (`ip` / `user_ip`, `user_agent` / `ua`), those are what geo, the IP lists,
 // dedup, fraud checks and the stored click use — and a fraud block then applies like to any click;
 // without the visitor's IP it is scored on the server but never blocked.
 const serverSideClick = Boolean(offer.attribution?.serverSideClick) && firstStr(q['format']) === 'json';
 const visitorIp = serverSideClick ? asIp(firstStr(q['ip']) ?? firstStr(q['user_ip']) ?? firstStr(q['visitor_ip'])) : null;
 const visitorUa = serverSideClick ? ((firstStr(q['user_agent']) ?? firstStr(q['ua']))?.trim().slice(0, 512) || null) : null;
 const ip = visitorIp ?? (req.ip || null);
 const userAgent = visitorUa ?? (req.headers['user-agent'] as string | undefined) ?? null;
 const geo = ip ? lookupGeo(ip) : null;
 const ua = parseUA(userAgent ?? undefined);
 // A `geo=XX` query param forces the country (dev/testing when no MaxMind db, or to simulate a
 // country) — geo is then treated as known so allow-list rules actually apply.
 const forcedGeo = resolveForcedGeo(env.NODE_ENV, firstStr(q['geo']), firstStr(q['test_geo']));
 const country = forcedGeo ?? geo?.country ?? null;

 // A click that isn't sent to the offer is still recorded — as an INVALID click whose first fraud flag
 // is the reason (Everflow standard; lib/click-rejections.ts) — so reports show the rejected traffic
 // and why, on the partner when they're one of this network's (D1). Nobody is credited: no payout,
 // never stored for attribution, and its id never leaves — the visitor goes to the fallback (the
 // offer's, else the network's, else a neutral 204), never to the advertiser.
 const reject = async (reason: ClickRejectionReason, fraud?: { score: number; flags: string[] }) => {
 await enqueueClick({
 clickId: randomUUID().replace(/-/g, ''), networkId: tenant.networkId, offerId: offer.id,
 publisherId: requestedPublisherId && partnerStatus !== null ? requestedPublisherId : null,
 ts: new Date().toISOString(), ip,
 country, region: geo?.region ?? null, city: geo?.city ?? null, isp: geo?.isp ?? null,
 device: ua.device, os: ua.os, browser: ua.browser,
 referrer: firstStr(req.headers['referer']) ?? null, userAgent,
 sub1: subs[0] ?? null, sub2: subs[1] ?? null, sub3: subs[2] ?? null, sub4: subs[3] ?? null, sub5: subs[4] ?? null,
 isUnique: false, fraudScore: fraud?.score ?? 0, fraudFlags: [reason, ...(fraud?.flags ?? [])],
 resolvedPayout: '0.0000', resolvedRevenue: '0.0000', currency: offer.currency, smartLinkId,
 sourceId, fbclid: firstNonBlank(q, ['fbclid']), gclid: firstNonBlank(q, ['gclid']),
 });
 req.log.info({ offerId: offer.id, pubId: requestedPublisherId, reason }, 'click_rejected');
 return divert(reply, offer.fallbackUrl, offer.id);
 };

 if (offer.status !== 'active') return reject('offer_not_active');

 // 2b. Only an active partner of this network can run traffic (F-08, D1): a pending, inactive or
 // unknown pub_id is rejected.
 if (requestedPublisherId && partnerStatus !== 'active') {
 return reject(partnerStatus === null ? 'unknown_partner' : partnerStatus === 'pending' ? 'partner_pending' : 'partner_inactive');
 }
 const publisherId = requestedPublisherId;

 // 2c. Affiliate blocking — a publisher explicitly denied on this offer never gets traffic.
 if (publisherId && offer.deniedPublishers.includes(publisherId)) return reject('partner_blocked');
 // 2d. Private / Request-access offers only run for partners an admin approved (allow + approved).
 // `visibility` is undefined only on a config cached before this check existed (≤ cache TTL).
 if (offer.visibility && offer.visibility !== 'public'
 && !(publisherId && (offer.approvedPublishers ?? []).includes(publisherId))) {
 return reject('partner_not_approved');
 }

 // 3. Network IP blacklist (Control Center › Security, F-16): a listed address is rejected, the same
 // outcome as a blocking traffic control. req.ip is the real client (trusted-proxy aware, above).
 if (ip && ipBlacklist?.check(ip)) return reject('ip_blacklisted');

 // 4. Geo targeting.
 const geoKnown = geoAvailable() || forcedGeo != null;
 const geoDecision = evaluateGeoRules(offer.geoRules, country, geoKnown);
 if (!geoDecision.allowed) return reject('geo_not_allowed');

 // 4a. Offer targeting (Edit Offer › Targeting). Device Type is the offer's allowed traffic types.
 const allowedTypes = offer.allowedTrafficTypes ?? [];
 if (allowedTypes.length > 0 && !(ua.device && allowedTypes.includes(ua.device))) return reject('device_not_allowed');
 const targetingDecision = evaluateTargeting(offer.targeting, {
 platform: ua.osName, browser: ua.browserName, deviceBrand: ua.deviceBrand, osVersion: ua.osVersion,
 language: primaryLanguage(firstStr(req.headers['accept-language'])),
 country, region: geo?.region ?? null, city: geo?.city ?? null, dma: geo?.dma ?? null,
 mobileCarrier: geo?.carrier ?? null, isp: geo?.isp ?? null, zip: geo?.postal ?? null, ip,
 }, { geo: geoAvailable(), country: geoKnown, carrier: carrierAvailable() });
 if (!targetingDecision.allowed) return reject('targeting_not_matched');

 // 4b. Traffic Controls — real Blacklist/Whitelist rules on sub-values, geo, device, etc.
 // (Offers › Traffic Controls). "Block" rejects like any other rule; "Fail Traffic" lets the
 // click through but flags it, so it already shows up as invalid in existing fraud reporting.
 const tcFields = {
 sub1: subs[0] ?? null, sub2: subs[1] ?? null, sub3: subs[2] ?? null, sub4: subs[3] ?? null, sub5: subs[4] ?? null,
 referrer: firstStr(req.headers['referer']) ?? null, ip, country,
 device: ua.device, os: ua.os, browser: ua.browser, userAgent,
 };
 const tcMatch = evaluateTrafficControls(offer.trafficControls, tcFields, publisherId);
 if (tcMatch?.action === 'block') return reject('traffic_control_blocked');

 // 4c. Traffic Blocking — per Partner+Offer rules on sub placements / Source ID (Partners ›
 // Traffic Blocking). A matching rule rejects the click, same outcome as a blacklist control.
 if (isTrafficBlocked(offer.trafficBlockings ?? [], publisherId, {
 sub1: subs[0] ?? null, sub2: subs[1] ?? null, sub3: subs[2] ?? null, sub4: subs[3] ?? null, sub5: subs[4] ?? null,
 sourceId,
 })) return reject('traffic_blocked');

 // 4d. Cheap fraud pre-signals (datacenter, velocity, bot user agent, the IP's cached IPQS verdict),
 // weighted by the network's fraud rules. DECISION (F-23): at or over the network's block score the
 // click is rejected — not attributed, not sent on — instead of only flagged. It's opt-in (no block
 // score = flag only, as before) and runs ahead of the caps and dedup, so blocked traffic can't use up
 // a cap. A server-side click (format=json on an offer that allows it) comes from the partner's
 // server, so its IP and user agent describe that server, not the visitor: it's scored, never blocked.
 const fraud = await fraudPreSignals({
 networkId: tenant.networkId, ip, isDatacenter: geo?.isDatacenter ?? false,
 userAgent, ipqs: offer.attribution?.ipqs?.enabled ?? false,
 }, fraudCfg);
 if (fraudCfg.enabled && fraudCfg.blockScore != null && fraud.score >= fraudCfg.blockScore && !(serverSideClick && !visitorIp)) {
 req.log.info({ offerId: offer.id, fraud: fraud.score, flags: fraud.flags }, 'click_blocked');
 return reject('fraud_blocked', fraud);
 }

 // 5. Cap check (atomic). Over the cap: rejected — "Cap has been exceeded".
 if (await isClickCapped(offer.id, offer.dailyClickCap)) return reject('cap_exceeded');

 // 5b. Offer Custom Settings for this partner (F-12): their click caps, and (step 11) landing page.
 const clickAttrs = { country, device: ua.device, os: ua.os, browser: ua.browser };
 const customFor = (category: 'caps' | 'landing_pages') =>
 (publisherId && offer.customSettings?.length ? applicableSettings(offer.customSettings, category, publisherId, clickAttrs, new Date()) : []);
 const customCaps = customFor('caps');
 if (customCaps.length && await isCustomClickCapped(customCaps, publisherId!)) return reject('partner_cap_exceeded');

 // 6. Unique / dedup.
 const isUnique = ip ? await markUnique(offer.id, ip, offer.dedupWindowS) : true;

 // 7. Unguessable click id.
 const clickId = randomUUID().replace(/-/g, '');

 // Resolve payout/revenue (frozen onto the click for later attribution). A partner's own payout
 // override on this offer is the most specific rate, then their tier's margin off the revenue (Partner
 // Tiers, F-17b), then the country override, then the default.
 const partnerPayout = publisherId ? offer.partnerPayouts?.[publisherId] ?? null : null;
 const resolvedRevenue = geoDecision.revenueOverride ?? offer.defaultRevenue;
 const tierRate = publisherId ? tierPayout(resolvedRevenue, offer.tierMargins?.[publisherId]) : null;
 const resolvedPayout = partnerPayout ?? tierRate ?? geoDecision.payoutOverride ?? offer.defaultPayout;

 // 10. Enqueue durable write (async) — the hot path never blocks on Postgres.
 const job: ClickJob = {
 clickId, networkId: tenant.networkId, offerId: offer.id, publisherId,
 ts: new Date().toISOString(), ip,
 country, region: geo?.region ?? null, city: geo?.city ?? null, isp: geo?.isp ?? null,
 device: ua.device, os: ua.os, browser: ua.browser,
 referrer: firstStr(req.headers['referer']) ?? null, userAgent,
 sub1: subs[0] ?? null, sub2: subs[1] ?? null, sub3: subs[2] ?? null, sub4: subs[3] ?? null, sub5: subs[4] ?? null,
 isUnique, fraudScore: fraud.score,
 fraudFlags: tcMatch?.action === 'fail_traffic' ? [...fraud.flags, 'traffic_control'] : fraud.flags,
 resolvedPayout, resolvedRevenue, currency: offer.currency,
 smartLinkId,
 // Taken verbatim from the click URL (already parsed — no extra work on the hot path); absent → null.
 sourceId, fbclid: firstNonBlank(q, ['fbclid']), gclid: firstNonBlank(q, ['gclid']),
 ipqs: offer.attribution?.ipqs?.enabled ?? false,
 };
 await enqueueClick(job);

 // Stash a short-lived click record in Redis so a conversion can attribute immediately
 // (before async DB persistence) and without a DB read on the conversion path (spec §6).
 await storeClickForAttribution(
 tenant.networkId, clickId,
 {
 offer_id: offer.id, publisher_id: publisherId, created_at: job.ts,
 resolved_payout: resolvedPayout, resolved_revenue: resolvedRevenue, currency: offer.currency,
 sub1: job.sub1, sub2: job.sub2, sub3: job.sub3, sub4: job.sub4, sub5: job.sub5,
 ...clickAttrs,
 },
 offer.attributionWindowS,
 );

 // 11. Build destination with macros and 302 out — the fastest exit.
 // A partner's custom landing page (Offer Custom Settings, F-12) beats a per-country destination.
 const customLanding = customFor('landing_pages').find((c) => c.landingPageUrl)?.landingPageUrl;
 const dest = customLanding ?? geoDecision.destinationOverride ?? offer.destinationUrl;
 const finalUrl = substituteMacros(
 dest,
 buildMacros({ clickId, offerId: offer.id, publisherId, country: country ?? undefined, device: ua.device, subs }),
 );

 const micros = Number(process.hrtime.bigint() - started) / 1000;
 req.log.info({
 offerId: offer.id, clickId, unique: isUnique, fraud: fraud.score, us: Math.round(micros),
 }, 'click');

 // AP-3 runtime guard: validate final URL after macro substitution before setting Location header.
 const urlViolation = getRedirectUrlRejectReason(finalUrl);
 if (urlViolation) {
 reply.log.warn({ offerId: offer.id, reason: urlViolation, source: 'destination' }, 'redirect_blocked');
 return reply.code(204).send();
 }
 // Server-side click (Attribution › Enable Server-Side Click): a server can create the click and
 // get the click_id back as JSON instead of following a redirect.
 if (serverSideClick) {
 return reply.code(200).header('cache-control', 'no-store').send({ ok: true, data: { click_id: clickId, redirect_url: finalUrl } });
 }
 return reply.code(302).header('location', finalUrl).header('cache-control', 'no-store').send();
 });

 // Smart link resolver — pick an offer (Weight / Priority / KPI) and hand off to /click so all the
 // normal click logic (caps, macros, attribution, smart_link_id) applies. F-17b: the link comes from
 // Redis (no Postgres read per request); a visitor no item is targeted at goes to the catch-all offer
 // (it used to get any item, ignoring their targeting); an item whose offer would only dead-end at
 // /click — not active, today's click cap reached, geo-blocked, or this partner blocked / not
 // approved on a non-public offer — is skipped; KPI links rotate by the worker's computed weights.
 app.get('/sl', async (req, reply) => {
 // Rate limit (AP-1): skip in dev/test.
 if (rateLimits) {
 const clientIp = (req.ip as string | undefined) ?? (req as { socket?: { remoteAddress?: string } }).socket?.remoteAddress ?? 'unknown';
 const rl = await checkTrackingRateLimit(clientIp, 'sl', CLICK_LIMIT);
 if (rl.limited) {
 return reply.code(429).header('retry-after', String(rl.retryAfterSeconds)).send(errorEnvelope('rate_limited', 'Too many requests', 429));
 }
 }

 const host = (req.headers.host ?? '').toString();
 const tenant = await resolveHostToNetwork(host);
 if (!tenant) return reply.code(404).send(errorEnvelope('not_found', 'unknown_tracking_host', 404));

 const q = req.query as Record<string, unknown>;
 const slId = asUuid(firstStr(q['id']) ?? firstStr(q['sl']));
 if (!slId) return reply.code(400).send(errorEnvelope('bad_request', 'missing_smart_link_id', 400));
 const pub = firstStr(q['pub_id']) ?? firstStr(q['aff_id']) ?? firstStr(q['p']);

 // Forward to /click, preserving pub_id + subs and tagging the smart link — for the picked offer
 // and for the catch-all alike (the catch-all used to lose the partner and subs).
 const forward = (offerId: string) => {
 const params = new URLSearchParams({ offer_id: offerId, sl: slId });
 if (pub) params.set('pub_id', pub);
 for (const i of [1, 2, 3, 4, 5]) { const s = firstStr(q[`sub${i}`]); if (s) params.set(`sub${i}`, s); }
 // Source ID too — Traffic Blocking rules can match on it at /click — and the ad click ids, so a
 // smart-link click records them like a direct one (blank values are not forwarded).
 const src = firstNonBlank(q, SOURCE_PARAMS);
 if (src) params.set('source_id', src);
 for (const k of ['fbclid', 'gclid']) { const v = firstNonBlank(q, [k]); if (v) params.set(k, v); }
 return reply.code(302).header('location', `/click?${params.toString()}`).header('cache-control', 'no-store').send();
 };

 const link = await getSmartLinkConfig(tenant.networkId, slId);
 const catchAll = () => (link?.catchAllOfferId ? forward(link.catchAllOfferId) : reply.code(204).send());
 if (!link || link.status !== 'active') return catchAll();

 const geo = req.ip ? lookupGeo(req.ip) : null;
 const country = geo?.country ?? null;
 const targeted = link.items.filter((i) => !i.country || i.country === country);
 if (!targeted.length) return catchAll();

 // The partner as /click will see it: only an active partner of this network counts (F-08).
 const requestedPub = pub ? await resolveEntityId('publisher', tenant.networkId, pub) : null;
 const partner = requestedPub && (await getPartnerStatus(tenant.networkId, requestedPub)) === 'active' ? requestedPub : null;
 const offers = await Promise.all(targeted.map((i) => getOfferConfig(tenant.networkId, i.offerId)));
 const capped = await Promise.all(offers.map((o) => (o ? clickCapReached(o.id, o.dailyClickCap) : true)));
 const eligible = targeted.filter((_, k) => {
 const o = offers[k];
 if (!o || o.status !== 'active' || capped[k]) return false;
 if (partner && o.deniedPublishers.includes(partner)) return false;
 if (o.visibility && o.visibility !== 'public' && !(partner && (o.approvedPublishers ?? []).includes(partner))) return false;
 return evaluateGeoRules(o.geoRules, country, geoAvailable()).allowed;
 });

 // Priority: lowest Position wins. Weight: the configured weights. KPI: the worker's weights once
 // computed (lib/smart-links/kpi.ts), an even rotation until then.
 const chosen = link.mechanism === 'priority'
 ? pickByPriority(eligible.map((i) => ({ offer_id: i.offerId, position: i.position })))
 : pickWeighted(eligible.map((i) => ({ offer_id: i.offerId, weight: link.mechanism === 'kpi' ? (i.kpiWeight ?? 0) : i.weight })));
 return chosen ? forward(chosen) : catchAll();
 });

 // ---- Conversion methods (spec §6) — all three normalize into recordConversion() ----

 /** The click id of a conversion request, from any of its aliases (query string first, then body). */
 function clickIdOf(req: FastifyRequest): string | null {
 const q = req.query as Record<string, unknown>;
 const b = (req.body ?? {}) as Record<string, unknown>;
 for (const k of ['click_id', 'cid', 'clickid']) {
 const v = firstStr(q[k]) ?? firstStr(b[k]);
 if (v != null) return v;
 }
 return null;
 }

 /** The HTTP status /postback answers an outcome with (pixel / iframe always answer 200). */
 const postbackHttpStatus = (outcome: RecordConversionResult['outcome']): number =>
 outcome === 'click_not_found' ? 404 : outcome === 'security_failed' ? 403 : 200;

 async function handleConversion(
 req: FastifyRequest,
 source: 'postback' | 'pixel' | 'iframe',
 ): Promise<RecordConversionResult & { networkResolved: boolean }> {
 const host = (req.headers.host ?? '').toString();
 const tenant = await resolveHostToNetwork(host);
 if (!tenant) return { outcome: 'click_not_found', networkResolved: false };

 const q = req.query as Record<string, unknown>;
 const b = (req.body ?? {}) as Record<string, unknown>;
 const pick = (...keys: string[]): string | null => {
 for (const k of keys) {
 const v = firstStr(q[k]) ?? firstStr(b[k]);
 if (v != null) return v;
 }
 return null;
 };

 const clickId = clickIdOf(req);
 const txnId = pick('txn_id', 'transaction_id', 'tid');
 const event = pick('event', 'event_name', 'goal');
 const saleAmount = pick(...SALE_AMOUNT_PARAMS);
 const rawParams = { ...q, ...b };
 // Every processed request goes to the inbound postback log — recorded or not, and why.
 const log = (result: InboundPostback['result'], httpStatus: number) => logInbound({
 networkId: tenant.networkId, source, method: req.method, clickId, transactionId: txnId, event, saleAmount, httpStatus,
 ip: (req.ip as string | undefined) ?? null, userAgent: firstStr(req.headers['user-agent']), params: rawParams, result,
 });
 if (!clickId) {
 const missing: RecordConversionResult = { outcome: 'click_not_found', reason: 'missing_click_id' };
 await log(missing, source === 'postback' ? 404 : 200);
 return { ...missing, networkResolved: true };
 }

 let result: RecordConversionResult;
 try {
 result = await recordConversion({
 networkId: tenant.networkId,
 clickId,
 txnId,
 event,
 statusHint: pick('status'),
 // `payout` is the only payout override (F-02). `amount` is the sale / order value across the
 // industry, so it joins sale_amount / order_amount as the Percentage-revenue base — never payout.
 payoutParam: pick('payout'),
 revenueParam: pick('revenue'),
 saleAmount,
 secureCode: pick('secure_code', 'security_code'),
 source,
 rawParams,
 // Pixel / iframe are browser-fired: record.ts binds them to the offer's site via these headers.
 requestOrigin: source === 'postback' ? undefined : {
 referer: firstStr(req.headers['referer']),
 origin: firstStr(req.headers['origin']),
 host,
 },
 });
 } catch (err) {
 await log({ outcome: 'error', reason: 'internal_error' }, 500);
 throw err;
 }
 await log(result, source === 'postback' ? postbackHttpStatus(result.outcome) : 200);
 return { ...result, networkResolved: true };
 }

 // A. S2S / postback (primary). GET and POST both supported.
 // O3: an authenticated postback (a valid security code) is NEVER throttled — an advertiser's server
 // may send thousands, and several per click (upsells, rev-share). Only FAILED postbacks (no / wrong
 // code, unknown click, unknown host) use up the sending IP's budget and the click id's (a leaked
 // click id can't be hammered from many IPs); an IP or click id over its budget is refused until
 // the window moves on. Skipped in dev / tests.
 const postback = async (req: FastifyRequest, reply: FastifyReply) => {
 reply.header('cache-control', 'no-store'); // never let the edge cache a conversion ack
 const clientIp = (req.ip as string | undefined) ?? (req as { socket?: { remoteAddress?: string } }).socket?.remoteAddress ?? 'unknown';
 const cid = clickIdOf(req);
 if (rateLimits) {
 const [ipFailures, clickFailures] = await Promise.all([
 peekTrackingRateLimit(clientIp, 'postback'), cid ? peekTrackingRateLimit(cid, 'postback_click') : Promise.resolve(0),
 ]);
 if (ipFailures >= POSTBACK_LIMIT || clickFailures >= POSTBACK_PER_CLICK_LIMIT) {
 return reply.code(429).header('retry-after', '60').send(errorEnvelope('rate_limited', 'Too many failed postbacks — check the security code and click id', 429));
 }
 }

 const r = await handleConversion(req, 'postback');
 if (rateLimits && (!r.networkResolved || r.outcome === 'click_not_found' || r.outcome === 'security_failed')) {
 await Promise.all([
 chargeTrackingRateLimit(clientIp, 'postback'), cid ? chargeTrackingRateLimit(cid, 'postback_click') : Promise.resolve(),
 ]);
 }
 if (!r.networkResolved) return reply.code(404).send(errorEnvelope('not_found', 'unknown_tracking_host', 404));
 if (r.outcome === 'click_not_found') return reply.code(404).send(errorEnvelope('not_found', 'click_not_found', 404));
 if (r.outcome === 'security_failed') return reply.code(403).send(errorEnvelope('forbidden', 'invalid or missing secure_code', 403));
 return reply.code(200).send({ status: r.outcome, conversion_id: r.conversionId ?? null });
 };
 app.get('/postback', postback);
 app.post('/postback', postback);

 // B. Pixel / image tag — always returns the 1x1 gif so the page renders (spec §6 caveats apply).
 app.get('/pixel', async (req, reply) => {
 // Rate limit (AP-1): skip in dev/test.
 if (rateLimits) {
 const clientIp = (req.ip as string | undefined) ?? (req as { socket?: { remoteAddress?: string } }).socket?.remoteAddress ?? 'unknown';
 const rl = await checkTrackingRateLimit(clientIp, 'pixel', POSTBACK_LIMIT);
 if (rl.limited) {
 return reply.code(429).header('retry-after', String(rl.retryAfterSeconds)).send(errorEnvelope('rate_limited', 'Too many requests', 429));
 }
 }

 await handleConversion(req, 'pixel');
 return reply.code(200).header('content-type', 'image/gif').header('cache-control', 'no-store').send(PIXEL_GIF);
 });

 // C. Iframe — serves a tiny document; same attribution core.
 app.get('/iframe', async (req, reply) => {
 // Rate limit (AP-1): skip in dev/test.
 if (rateLimits) {
 const clientIp = (req.ip as string | undefined) ?? (req as { socket?: { remoteAddress?: string } }).socket?.remoteAddress ?? 'unknown';
 const rl = await checkTrackingRateLimit(clientIp, 'iframe', POSTBACK_LIMIT);
 if (rl.limited) {
 return reply.code(429).header('retry-after', String(rl.retryAfterSeconds)).send(errorEnvelope('rate_limited', 'Too many requests', 429));
 }
 }

 await handleConversion(req, 'iframe');
 return reply
 .code(200)
 .header('content-type', 'text/html')
 .header('cache-control', 'no-store')
 .send('<!doctype html><title>ok</title>');
 });

 return app;
}
