/**
 * Tracking hot-path surface (spec §2.1 #1, §5) — click / postback / pixel / iframe.
 * Fastify for the latency budget. NO api-key auth; tenant resolved from the tracking DOMAIN.
 *
 * NON-NEGOTIABLE #1: the click path NEVER touches Postgres synchronously. Config comes from the
 * Redis cache (load-through), caps/dedup/velocity are atomic Redis ops, and the durable write is
 * deferred to a queue. The only goal after decisions are made is the fastest possible 302.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { buildHealthReport, buildLivenessReport, buildReadinessReport, errorEnvelope } from '../../lib/http/index.js';
import { resolveHostToNetwork } from '../../middleware/host-resolver.js';
import { lookupGeo, geoAvailable, carrierAvailable } from '../../lib/geo/geoip.js';
import { evaluateTargeting, primaryLanguage } from './targeting-eval.js';
import { resolveEntityId } from './ref-resolver.js';
import { isActivePartner } from './partner-status.js';
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
import { checkTrackingRateLimit, CLICK_LIMIT, POSTBACK_LIMIT, POSTBACK_PER_CLICK_LIMIT } from '../../lib/tracking-rate-limit.js';
import { isClickCapped, isCustomClickCapped, clickCapReached } from './caps.js';
import { getSmartLinkConfig } from './smart-link-cache.js';
import { applicableSettings } from '../../lib/offer-settings/custom-settings.js';
import { markUnique } from './dedup.js';
import { fraudPreSignals } from './fraud-presignals.js';
import { buildMacros, substituteMacros } from './macros.js';
import { enqueueClick, type ClickJob } from './click-job.js';
import { storeClickForAttribution } from './click-store.js';
import { recordConversion, SALE_AMOUNT_PARAMS, type RecordConversionResult } from './conversions/record.js';
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

export function buildTrackingApp(): FastifyInstance {
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
 if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
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
 const [offer, partnerActive, ipBlacklist, fraudCfg] = await Promise.all([
 getOfferConfig(tenant.networkId, offerId),
 requestedPublisherId ? isActivePartner(tenant.networkId, requestedPublisherId) : false,
 getNetworkIpBlacklist(tenant.networkId),
 getFraudConfigCached(tenant.networkId),
 ]);
 // 2a. Only an active partner of this network can earn (F-08). A pending, inactive or unknown
 // pub_id is DROPPED from the click instead of diverting the visitor: the redirect still happens,
 // but the click — and every conversion on it — belongs to no partner, so no payout or ledger
 // entry is ever booked to them. Everything below sees no partner (a private offer then diverts,
 // as for any click without an approved partner).
 const publisherId = partnerActive ? requestedPublisherId : null;
 if (!offer || offer.status !== 'active') {
 return divert(reply, offer?.fallbackUrl ?? null, offer?.id);
 }

 // 2b. Affiliate blocking — a publisher explicitly denied on this offer never gets traffic.
 if (publisherId && offer.deniedPublishers.includes(publisherId)) {
 return divert(reply, offer.fallbackUrl, offer.id);
 }
 // 2c. Private / Request-access offers only run for partners an admin approved (allow + approved).
 // `visibility` is undefined only on a config cached before this check existed (≤ cache TTL).
 if (offer.visibility && offer.visibility !== 'public'
 && !(publisherId && (offer.approvedPublishers ?? []).includes(publisherId))) {
 return divert(reply, offer.fallbackUrl, offer.id);
 }

 // 3. Enrich geo + device in-process.
 const ip = req.ip || null;
 // 3a. Network IP blacklist (Control Center › Security, F-16): a listed address is diverted, the same
 // outcome as a blocking traffic control. req.ip is the real client (trusted-proxy aware, above).
 if (ip && ipBlacklist?.check(ip)) return divert(reply, offer.fallbackUrl, offer.id);
 const geo = ip ? lookupGeo(ip) : null;
 const ua = parseUA(req.headers['user-agent']);

 // 4. Geo targeting. A `geo=XX` query param forces the country (dev/testing when no MaxMind db,
 // or to simulate a country) — geo is then treated as known so allow-list rules actually apply.
 const forcedGeo = resolveForcedGeo(env.NODE_ENV, firstStr(q['geo']), firstStr(q['test_geo']));
 const country = forcedGeo ?? geo?.country ?? null;
 const geoKnown = geoAvailable() || forcedGeo != null;
 const geoDecision = evaluateGeoRules(offer.geoRules, country, geoKnown);
 if (!geoDecision.allowed) return divert(reply, offer.fallbackUrl, offer.id);

 // 4a. Offer targeting (Edit Offer › Targeting). Device Type is the offer's allowed traffic types.
 const allowedTypes = offer.allowedTrafficTypes ?? [];
 if (allowedTypes.length > 0 && !(ua.device && allowedTypes.includes(ua.device))) {
 return divert(reply, offer.fallbackUrl, offer.id);
 }
 const targetingDecision = evaluateTargeting(offer.targeting, {
 platform: ua.osName, browser: ua.browserName, deviceBrand: ua.deviceBrand, osVersion: ua.osVersion,
 language: primaryLanguage(firstStr(req.headers['accept-language'])),
 country, region: geo?.region ?? null, city: geo?.city ?? null, dma: geo?.dma ?? null,
 mobileCarrier: geo?.carrier ?? null, isp: geo?.isp ?? null, zip: geo?.postal ?? null, ip,
 }, { geo: geoAvailable(), country: geoKnown, carrier: carrierAvailable() });
 if (!targetingDecision.allowed) return divert(reply, offer.fallbackUrl, offer.id);

 // 4b. Traffic Controls — real Blacklist/Whitelist rules on sub-values, geo, device, etc.
 // (Offers › Traffic Controls). "Block" diverts like any other rule; "Fail Traffic" lets the
 // click through but flags it, so it already shows up as invalid in existing fraud reporting.
 const tcFields = {
 sub1: subs[0] ?? null, sub2: subs[1] ?? null, sub3: subs[2] ?? null, sub4: subs[3] ?? null, sub5: subs[4] ?? null,
 referrer: firstStr(req.headers['referer']) ?? null, ip, country,
 device: ua.device, os: ua.os, browser: ua.browser, userAgent: (req.headers['user-agent'] as string) ?? null,
 };
 const tcMatch = evaluateTrafficControls(offer.trafficControls, tcFields, publisherId);
 if (tcMatch?.action === 'block') return divert(reply, offer.fallbackUrl, offer.id);

 // 4c. Traffic Blocking — per Partner+Offer rules on sub placements / Source ID (Partners ›
 // Traffic Blocking). A matching rule rejects the click, same outcome as a blacklist control.
 if (isTrafficBlocked(offer.trafficBlockings ?? [], publisherId, {
 sub1: subs[0] ?? null, sub2: subs[1] ?? null, sub3: subs[2] ?? null, sub4: subs[3] ?? null, sub5: subs[4] ?? null,
 sourceId,
 })) return divert(reply, offer.fallbackUrl, offer.id);

 // 4d. Cheap fraud pre-signals (datacenter, velocity, bot user agent, the IP's cached IPQS verdict),
 // weighted by the network's fraud rules. DECISION (F-23): at or over the network's block score the
 // click is diverted — not attributed, not counted — instead of only flagged. It's opt-in (no block
 // score = flag only, as before) and runs ahead of the caps and dedup, so blocked traffic can't use up
 // a cap. A server-side click (format=json on an offer that allows it) comes from the partner's
 // server, so its IP and user agent describe that server, not the visitor: it's scored, never blocked.
 const fraud = await fraudPreSignals({
 networkId: tenant.networkId, ip, isDatacenter: geo?.isDatacenter ?? false,
 userAgent: req.headers['user-agent'] ?? null, ipqs: offer.attribution?.ipqs?.enabled ?? false,
 }, fraudCfg);
 const serverSideClick = Boolean(offer.attribution?.serverSideClick) && firstStr(q['format']) === 'json';
 if (fraudCfg.enabled && fraudCfg.blockScore != null && fraud.score >= fraudCfg.blockScore && !serverSideClick) {
 req.log.info({ offerId: offer.id, fraud: fraud.score, flags: fraud.flags }, 'click_blocked');
 return divert(reply, offer.fallbackUrl, offer.id);
 }

 // 5. Cap check (atomic).
 if (await isClickCapped(offer.id, offer.dailyClickCap)) return divert(reply, offer.fallbackUrl, offer.id);

 // 5b. Offer Custom Settings for this partner (F-12): their click caps, and (step 11) landing page.
 const clickAttrs = { country, device: ua.device, os: ua.os, browser: ua.browser };
 const customFor = (category: 'caps' | 'landing_pages') =>
 (publisherId && offer.customSettings?.length ? applicableSettings(offer.customSettings, category, publisherId, clickAttrs, new Date()) : []);
 const customCaps = customFor('caps');
 if (customCaps.length && await isCustomClickCapped(customCaps, publisherId!)) return divert(reply, offer.fallbackUrl, offer.id);

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
 referrer: firstStr(req.headers['referer']) ?? null, userAgent: req.headers['user-agent'] ?? null,
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
 ...(requestedPublisherId && !publisherId ? { droppedPartner: requestedPublisherId } : {}),
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
 if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
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
 const partner = requestedPub && (await isActivePartner(tenant.networkId, requestedPub)) ? requestedPub : null;
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
 if (!clickId) return { outcome: 'click_not_found', networkResolved: true };

 const result = await recordConversion({
 networkId: tenant.networkId,
 clickId,
 txnId: pick('txn_id', 'transaction_id', 'tid'),
 event: pick('event', 'event_name', 'goal'),
 statusHint: pick('status'),
 // `payout` is the only payout override (F-02). `amount` is the sale / order value across the
 // industry, so it joins sale_amount / order_amount as the Percentage-revenue base — never payout.
 payoutParam: pick('payout'),
 revenueParam: pick('revenue'),
 saleAmount: pick(...SALE_AMOUNT_PARAMS),
 secureCode: pick('secure_code', 'security_code'),
 source,
 rawParams: { ...q, ...b },
 // Pixel / iframe are browser-fired: record.ts binds them to the offer's site via these headers.
 requestOrigin: source === 'postback' ? undefined : {
 referer: firstStr(req.headers['referer']),
 origin: firstStr(req.headers['origin']),
 host,
 },
 });
 return { ...result, networkResolved: true };
 }

 // A. S2S / postback (primary). GET and POST both supported.
 const postback = async (req: FastifyRequest, reply: FastifyReply) => {
 reply.header('cache-control', 'no-store'); // never let the edge cache a conversion ack
 // Rate limit (AP-1): skip in dev/test.
 if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
 const clientIp = (req.ip as string | undefined) ?? (req as { socket?: { remoteAddress?: string } }).socket?.remoteAddress ?? 'unknown';
 const rl = await checkTrackingRateLimit(clientIp, 'postback', POSTBACK_LIMIT);
 if (rl.limited) {
 return reply.code(429).header('retry-after', String(rl.retryAfterSeconds)).send(errorEnvelope('rate_limited', 'Too many requests', 429));
 }
 // Per click_id too (F-01): a leaked click_id can't be hammered from many IPs at once.
 const cid = clickIdOf(req);
 if (cid) {
 const rlc = await checkTrackingRateLimit(cid, 'postback_click', POSTBACK_PER_CLICK_LIMIT);
 if (rlc.limited) {
 return reply.code(429).header('retry-after', String(rlc.retryAfterSeconds)).send(errorEnvelope('rate_limited', 'Too many requests', 429));
 }
 }
 }

 const r = await handleConversion(req, 'postback');
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
 if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
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
 if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
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
