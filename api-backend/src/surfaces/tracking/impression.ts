/**
 * /impression (alias /imp) — an ad impression: the partner puts it on the page where the ad shows, as an image
 *
 *   <img src="https://<tracking-domain>/impression?offer_id=12&pub_id=7&sub1=…" width="1" height="1" alt="">
 *
 * or calls it from their ad server with &format=json (a server-side impression; the visitor's `ip` / `ua` are
 * honoured when the offer allows server-side clicks). Impressions go through the same checks as a click —
 * offer active, an active partner, approved for a private offer, the platform blocklist and the network's IP
 * blacklist, GEO, device and targeting, traffic controls and blocking, a fraud block — and a rejected one is
 * recorded with its reason as its first flag (Reports › Impressions), never billed or matched. Nothing waits on
 * Postgres: the row is written by the impression-persist worker.
 *
 * An accepted impression
 *  - is unique for its offer + address within the offer's unique-click window (impressions and clicks apart);
 *  - is counted for CPM billing when the offer bills this partner per 1000 impressions (the payout model CPM, or
 *    Revenue Action "Impression" — lib/offer-settings/billing.ts) and it's valid (no flags, a partner);
 *  - is kept for view-through attribution while the offer has it on (conversions/view-through.ts), and the
 *    browser gets the impression cookie for the offer;
 *  - answers a 1×1 GIF, or — when the offer has an impression URL (the advertiser's or MMP's) — a redirect
 *    there with {imp_id} / {impression_id} and the click macros filled; &format=json answers
 *    { impression_id, redirect_url }.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { errorEnvelope } from '../../lib/http/index.js';
import { resolveHostToNetwork } from '../../middleware/host-resolver.js';
import { geoAvailable, carrierAvailable } from '../../lib/geo/geoip.js';
import { evaluateTargeting, primaryLanguage } from './targeting-eval.js';
import { resolveEntityId } from './ref-resolver.js';
import { getPartnerStatus } from './partner-status.js';
import { getNetworkIpBlacklist } from '../../lib/net/ip-lists.js';
import { getPlatformBlocklist, recordBlocklistHit } from '../../lib/platform/blocklist.js';
import { getFraudConfigCached } from '../../lib/fraud/rules.js';
import { tierPayout } from '../../lib/partner-tiers.js';
import { parseUA } from '../../lib/ua.js';
import { SOURCE_PARAMS, firstNonBlank, firstStr, asIp } from './click-params.js';
import { getOfferConfig } from './offer-cache.js';
import { evaluateTrafficControls } from './traffic-controls-eval.js';
import { isTrafficBlocked } from './traffic-blocking-eval.js';
import { evaluateGeoRules } from './geo-rules.js';
import { visitorGeo } from './visitor-geo.js';
import { checkTrackingRateLimit, IMPRESSION_LIMIT } from '../../lib/tracking-rate-limit.js';
import { markUnique } from './dedup.js';
import { fraudPreSignals } from './fraud-presignals.js';
import { buildMacros, substituteMacros } from './macros.js';
import { enqueueImpression, type ImpressionJob } from './impression-job.js';
import { actionPricing } from '../../lib/offer-settings/billing.js';
import { storeImpressionForViewThrough, viewThroughWindowS, vtCookieName } from './conversions/view-through.js';
import { getRedirectUrlRejectReason } from '../../lib/url-security.js';
import type { ClickRejectionReason } from '../../lib/click-rejections.js';

/** 1x1 transparent GIF (the pixel endpoints' answer). */
export const PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const gif = (reply: FastifyReply) => reply.code(200).header('content-type', 'image/gif').header('cache-control', 'no-store').send(PIXEL_GIF);

export function registerImpressionRoutes(app: FastifyInstance, opts: { rateLimits: boolean }): void {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    if (opts.rateLimits) {
      const clientIp = (req.ip as string | undefined) ?? 'unknown';
      const rl = await checkTrackingRateLimit(clientIp, 'impression', IMPRESSION_LIMIT);
      if (rl.limited) return reply.code(429).header('retry-after', String(rl.retryAfterSeconds)).send(errorEnvelope('rate_limited', 'Too many requests', 429));
    }
    const tenant = await resolveHostToNetwork((req.headers.host ?? '').toString());
    if (!tenant) return reply.code(404).send(errorEnvelope('not_found', 'unknown_tracking_host', 404));

    const q = req.query as Record<string, unknown>;
    const json = firstStr(q['format']) === 'json';
    const rawOfferId = firstStr(q['offer_id']) ?? firstStr(q['o']);
    if (!rawOfferId) return reply.code(400).send(errorEnvelope('bad_request', 'missing_offer_id', 400));
    const offerId = await resolveEntityId('offer', tenant.networkId, rawOfferId);
    const nothing = () => (json ? reply.code(204).send() : gif(reply));
    if (!offerId) return nothing();
    const requestedPublisherId = await resolveEntityId('publisher', tenant.networkId, firstStr(q['pub_id']) ?? firstStr(q['aff_id']) ?? firstStr(q['p']));
    const subs = [1, 2, 3, 4, 5].map((i) => firstStr(q[`sub${i}`]));
    const sourceId = firstNonBlank(q, SOURCE_PARAMS);
    const creativeId = firstNonBlank(q, ['creative_id', 'cr'])?.slice(0, 200) ?? null;

    const [offer, partnerStatus, ipBlacklist, fraudCfg, platformBlocklist] = await Promise.all([
      getOfferConfig(tenant.networkId, offerId),
      requestedPublisherId ? getPartnerStatus(tenant.networkId, requestedPublisherId) : null,
      getNetworkIpBlacklist(tenant.networkId),
      getFraudConfigCached(tenant.networkId),
      getPlatformBlocklist(),
    ]);
    if (!offer) return nothing();

    // A server-side impression names its visitor only on an offer that allows server-side clicks (same rule).
    const serverSide = json && Boolean(offer.attribution?.serverSideClick);
    const visitorIp = serverSide ? asIp(firstStr(q['ip']) ?? firstStr(q['user_ip'])) : null;
    const visitorUa = serverSide ? ((firstStr(q['user_agent']) ?? firstStr(q['ua']))?.trim().slice(0, 512) || null) : null;
    const ip = visitorIp ?? (req.ip || null);
    const userAgent = visitorUa ?? (req.headers['user-agent'] as string | undefined) ?? null;
    const ua = parseUA(userAgent ?? undefined);
    const where = visitorGeo({
      ip, socketAddress: (req.raw.socket?.remoteAddress ?? null), cfCountry: req.headers['cf-ipcountry'],
      geoParam: firstStr(q['geo']), testGeoParam: firstStr(q['test_geo']),
    });
    const geo = where.geo;
    const country = where.country;
    const referrer = firstStr(req.headers['referer']) ?? null;
    const impressionId = randomUUID().replace(/-/g, '');
    const job = (over: Partial<ImpressionJob>): ImpressionJob => ({
      impressionId, networkId: tenant.networkId, offerId: offer.id,
      publisherId: requestedPublisherId && partnerStatus !== null ? requestedPublisherId : null,
      ts: new Date().toISOString(), ip, country, region: where.region, city: geo?.city ?? null, isp: geo?.isp ?? null,
      device: ua.device, os: ua.os, browser: ua.browser, referrer, userAgent,
      sub1: subs[0] ?? null, sub2: subs[1] ?? null, sub3: subs[2] ?? null, sub4: subs[3] ?? null, sub5: subs[4] ?? null,
      sourceId, creativeId, isUnique: false, fraudScore: 0, fraudFlags: [],
      resolvedPayout: '0.0000', resolvedRevenue: '0.0000', currency: offer.currency, cpm: null,
      ...over,
    });
    const reject = async (reason: ClickRejectionReason, fraud?: { score: number; flags: string[] }) => {
      await enqueueImpression(job({ fraudScore: fraud?.score ?? 0, fraudFlags: [reason, ...(fraud?.flags ?? [])] }));
      return nothing();
    };

    if (offer.status !== 'active') return reject('offer_not_active');
    if (requestedPublisherId && partnerStatus !== 'active') {
      return reject(partnerStatus === null ? 'unknown_partner' : partnerStatus === 'pending' ? 'partner_pending' : 'partner_inactive');
    }
    const publisherId = requestedPublisherId;
    if (publisherId && offer.deniedPublishers.includes(publisherId)) return reject('partner_blocked');
    if (offer.visibility && offer.visibility !== 'public' && !(publisherId && (offer.approvedPublishers ?? []).includes(publisherId))) {
      return reject('partner_not_approved');
    }
    const platformHit = platformBlocklist?.match({ ip, userAgent, referrer });
    if (platformHit) { recordBlocklistHit(platformHit.id); return reject('platform_blocked'); }
    if (ip && ipBlacklist?.check(ip)) return reject('ip_blacklisted');
    const geoDecision = evaluateGeoRules(offer.geoRules, country, where.known, where.regionKeys);
    if (!geoDecision.allowed) return reject('geo_not_allowed');
    const allowedTypes = offer.allowedTrafficTypes ?? [];
    if (allowedTypes.length > 0 && !(ua.device && allowedTypes.includes(ua.device))) return reject('device_not_allowed');
    const targeting = evaluateTargeting(offer.targeting, {
      platform: ua.osName, browser: ua.browserName, deviceBrand: ua.deviceBrand, osVersion: ua.osVersion,
      language: primaryLanguage(firstStr(req.headers['accept-language'])),
      country, region: where.region, regionName: geo?.regionName ?? null, city: geo?.city ?? null, dma: geo?.dma ?? null,
      mobileCarrier: geo?.carrier ?? null, isp: geo?.isp ?? null, zip: geo?.postal ?? null, ip,
    }, { geo: geoAvailable(), country: where.known, carrier: carrierAvailable() });
    if (!targeting.allowed) return reject('targeting_not_matched');
    const tcMatch = evaluateTrafficControls(offer.trafficControls, {
      sub1: subs[0] ?? null, sub2: subs[1] ?? null, sub3: subs[2] ?? null, sub4: subs[3] ?? null, sub5: subs[4] ?? null,
      referrer, ip, country, device: ua.device, os: ua.os, browser: ua.browser, userAgent,
    }, publisherId);
    if (tcMatch?.action === 'block') return reject('traffic_control_blocked');
    if (isTrafficBlocked(offer.trafficBlockings ?? [], publisherId, {
      sub1: subs[0] ?? null, sub2: subs[1] ?? null, sub3: subs[2] ?? null, sub4: subs[3] ?? null, sub5: subs[4] ?? null, sourceId,
    })) return reject('traffic_blocked');
    const fraud = await fraudPreSignals({
      networkId: tenant.networkId, ip, isDatacenter: geo?.isDatacenter ?? false, userAgent, ipqs: offer.attribution?.ipqs?.enabled ?? false,
    }, fraudCfg);
    if (fraudCfg.enabled && fraudCfg.blockScore != null && fraud.score >= fraudCfg.blockScore && !(serverSide && !visitorIp)) {
      return reject('fraud_blocked', fraud);
    }

    const isUnique = ip ? await markUnique(offer.id, ip, offer.dedupWindowS, 'impression') : true;
    // The rates, as a click would get them (partner override › tier margin › country override › default).
    const partnerPayout = publisherId ? offer.partnerPayouts?.[publisherId] ?? null : null;
    const resolvedRevenue = geoDecision.revenueOverride ?? offer.defaultRevenue;
    const tierRate = publisherId ? tierPayout(resolvedRevenue, offer.tierMargins?.[publisherId]) : null;
    const resolvedPayout = partnerPayout ?? tierRate ?? geoDecision.payoutOverride ?? offer.defaultPayout;
    const attrs = { country, device: ua.device, os: ua.os, browser: ua.browser };
    const pricing = actionPricing(offer, publisherId, attrs, new Date(), { payout: resolvedPayout, revenue: resolvedRevenue });
    const fraudFlags = tcMatch?.action === 'fail_traffic' ? [...fraud.flags, 'traffic_control'] : fraud.flags;
    const perImpression = pricing.payout.action === 'impression' || pricing.revenue.action === 'impression';
    const accepted = job({
      publisherId, isUnique, fraudScore: fraud.score, fraudFlags, resolvedPayout, resolvedRevenue,
      cpm: perImpression ? {
        payout: pricing.payout.action === 'impression' ? pricing.payout.rate : null,
        revenue: pricing.revenue.action === 'impression' ? pricing.revenue.rate : null,
        advertiserId: offer.advertiserId,
      } : null,
    });
    await enqueueImpression(accepted);

    const viewThrough = Boolean(offer.attribution?.viewThrough);
    if (viewThrough) {
      await storeImpressionForViewThrough(tenant.networkId, impressionId, ip, {
        offer_id: offer.id, publisher_id: publisherId, created_at: accepted.ts,
        resolved_payout: resolvedPayout, resolved_revenue: resolvedRevenue, currency: offer.currency,
        sub1: accepted.sub1, sub2: accepted.sub2, sub3: accepted.sub3, sub4: accepted.sub4, sub5: accepted.sub5,
        ...attrs,
      }, viewThroughWindowS(offer));
    }

    // The advertiser's / MMP's impression URL, with the impression's macros (an unsafe result is dropped).
    let redirectUrl: string | null = null;
    if (offer.impressionUrl) {
      const url = substituteMacros(offer.impressionUrl, {
        ...buildMacros({ clickId: impressionId, offerId: offer.id, publisherId, country: country ?? undefined, device: ua.device, subs }),
        imp_id: impressionId, impression_id: impressionId, source_id: sourceId ?? '', creative_id: creativeId ?? '',
      });
      if (getRedirectUrlRejectReason(url)) req.log.warn({ offerId: offer.id, source: 'impression_url' }, 'redirect_blocked');
      else redirectUrl = url;
    }
    if (json) return reply.code(200).header('cache-control', 'no-store').send({ ok: true, data: { impression_id: impressionId, redirect_url: redirectUrl } });
    if (viewThrough) {
      reply.header('set-cookie', `${vtCookieName(offer.id)}=${impressionId}; Max-Age=${viewThroughWindowS(offer)}; Path=/; HttpOnly; SameSite=None; Secure`);
    }
    if (redirectUrl) return reply.code(302).header('location', redirectUrl).header('cache-control', 'no-store').send();
    return gif(reply);
  };
  app.get('/impression', handler);
  app.get('/imp', handler);
}
