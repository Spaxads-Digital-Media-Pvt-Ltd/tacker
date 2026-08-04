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
import { buildHealthReport } from '../../lib/http/health.js';
import { resolveHostToNetwork } from '../../middleware/host-resolver.js';
import { lookupGeo, geoAvailable } from '../../lib/geo/geoip.js';
import { parseUA } from '../../lib/ua.js';
import { getOfferConfig } from './offer-cache.js';
import { evaluateGeoRules } from './geo-rules.js';
import { isClickCapped } from './caps.js';
import { markUnique } from './dedup.js';
import { fraudPreSignals } from './fraud-presignals.js';
import { buildMacros, substituteMacros } from './macros.js';
import { enqueueClick, type ClickJob } from './click-job.js';
import { storeClickForAttribution } from './click-store.js';
import { recordConversion, type RecordConversionResult } from './conversions/record.js';
import { clicksTotal, redirectLatency, metricsText, metricsContentType } from '../../lib/metrics.js';
import { captureError } from '../../lib/observability/sentry.js';
import { query } from '../../lib/db/pool.js';

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

// A soft exit: divert to the offer's fallback if configured, else a neutral 204 (never a hard
// error to an end user — spec §5).
function divert(reply: FastifyReply, fallbackUrl: string | null): FastifyReply {
  if (fallbackUrl) return reply.code(302).header('location', fallbackUrl).send();
  return reply.code(204).send();
}

export function buildTrackingApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    trustProxy: true, // Cloudflare → Nginx → us; req.ip is the real client IP.
    disableRequestLogging: true, // hot path: we log our own compact line
  });

  // Report unexpected handler errors to Sentry (no-op when disabled), then hand back to Fastify's
  // default error response — the hot path must still fail fast and cheap.
  app.setErrorHandler((err, req, reply) => {
    captureError(err, { url: req.url });
    req.log.error({ err }, 'tracking handler error');
    reply.code(err.statusCode ?? 500).send({ error: 'internal_error' });
  });

  app.get('/health', async (_req, reply) => {
    const report = await buildHealthReport('tracking');
    return reply.code(report.status === 'ok' ? 200 : 503).send(report);
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

  app.get('/click', async (req, reply) => {
    const started = process.hrtime.bigint();

    // 1. Resolve tenant from the tracking host.
    const host = (req.headers.host ?? '').toString();
    const tenant = await resolveHostToNetwork(host);
    if (!tenant) return reply.code(404).send({ error: 'unknown_tracking_host' });

    const q = req.query as Record<string, unknown>;
    const offerId = firstStr(q['offer_id']) ?? firstStr(q['o']);
    if (!offerId) return reply.code(400).send({ error: 'missing_offer_id' });
    // publisher_id is a UUID column downstream (clicks/conversions). Ignore a malformed value rather
    // than 500 the conversion later — a bad pub_id shouldn't break attribution or the redirect.
    const publisherId = asUuid(firstStr(q['pub_id']) ?? firstStr(q['aff_id']) ?? firstStr(q['p']));
    const smartLinkId = asUuid(firstStr(q['sl'])); // set when a smart link routed this click
    const subs = [1, 2, 3, 4, 5].map((i) => firstStr(q[`sub${i}`]));

    // 2. Offer config from Redis (load-through). No sync Postgres read on the hot path.
    const offer = await getOfferConfig(tenant.networkId, offerId);
    if (!offer || offer.status !== 'active') {
      return divert(reply, offer?.fallbackUrl ?? null);
    }

    // 2b. Affiliate blocking — a publisher explicitly denied on this offer never gets traffic.
    if (publisherId && offer.deniedPublishers.includes(publisherId)) {
      return divert(reply, offer.fallbackUrl);
    }

    // 3. Enrich geo + device in-process.
    const ip = req.ip || null;
    const geo = ip ? lookupGeo(ip) : null;
    const ua = parseUA(req.headers['user-agent']);

    // 4. Geo targeting. A `geo=XX` query param forces the country (dev/testing when no MaxMind db,
    // or to simulate a country) — geo is then treated as known so allow-list rules actually apply.
    const forcedGeo = (firstStr(q['geo']) ?? firstStr(q['test_geo']) ?? '').toUpperCase().slice(0, 2) || null;
    const country = forcedGeo ?? geo?.country ?? null;
    const geoKnown = geoAvailable() || forcedGeo != null;
    const geoDecision = evaluateGeoRules(offer.geoRules, country, geoKnown);
    if (!geoDecision.allowed) return divert(reply, offer.fallbackUrl);

    // 5. Cap check (atomic).
    if (await isClickCapped(offer.id, offer.dailyClickCap)) return divert(reply, offer.fallbackUrl);

    // 6. Unique / dedup.
    const isUnique = ip ? await markUnique(offer.id, ip, offer.dedupWindowS) : true;

    // 7. Unguessable click id.
    const clickId = randomUUID().replace(/-/g, '');

    // 8/9. Cheap fraud pre-signals (datacenter + velocity).
    const fraud = await fraudPreSignals(ip, geo?.isDatacenter ?? false);

    // Resolve payout/revenue with geo overrides (frozen onto the click for later attribution).
    const resolvedPayout = geoDecision.payoutOverride ?? offer.defaultPayout;
    const resolvedRevenue = geoDecision.revenueOverride ?? offer.defaultRevenue;

    // 10. Enqueue durable write (async) — the hot path never blocks on Postgres.
    const job: ClickJob = {
      clickId, networkId: tenant.networkId, offerId: offer.id, publisherId,
      ts: new Date().toISOString(), ip,
      country, region: geo?.region ?? null, city: geo?.city ?? null, isp: geo?.isp ?? null,
      device: ua.device, os: ua.os, browser: ua.browser,
      referrer: firstStr(req.headers['referer']) ?? null, userAgent: req.headers['user-agent'] ?? null,
      sub1: subs[0] ?? null, sub2: subs[1] ?? null, sub3: subs[2] ?? null, sub4: subs[3] ?? null, sub5: subs[4] ?? null,
      isUnique, fraudScore: fraud.score, fraudFlags: fraud.flags,
      resolvedPayout, resolvedRevenue, currency: offer.currency,
      smartLinkId,
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
      },
      offer.attributionWindowS,
    );

    // 11. Build destination with macros and 302 out — the fastest exit.
    const dest = geoDecision.destinationOverride ?? offer.destinationUrl;
    const finalUrl = substituteMacros(
      dest,
      buildMacros({ clickId, offerId: offer.id, publisherId, country: country ?? undefined, device: ua.device, subs }),
    );

    const micros = Number(process.hrtime.bigint() - started) / 1000;
    req.log.info({ offerId: offer.id, clickId, unique: isUnique, fraud: fraud.score, us: Math.round(micros) }, 'click');

    return reply.code(302).header('location', finalUrl).header('cache-control', 'no-store').send();
  });

  // Smart link resolver — pick an offer by weighted rotation (geo-aware) and hand off to /click so
  // all the normal click logic (caps, macros, attribution, smart_link_id) applies. Lower volume than
  // /click, so a small Postgres read here is acceptable (documented departure from the hot-path rule).
  app.get('/sl', async (req, reply) => {
    const host = (req.headers.host ?? '').toString();
    const tenant = await resolveHostToNetwork(host);
    if (!tenant) return reply.code(404).send({ error: 'unknown_tracking_host' });

    const q = req.query as Record<string, unknown>;
    const slId = asUuid(firstStr(q['id']) ?? firstStr(q['sl']));
    if (!slId) return reply.code(400).send({ error: 'missing_smart_link_id' });

    const linkRes = await query<{ id: string; status: string; fallback_url: string | null }>(
      `SELECT id, status, fallback_url FROM smart_links WHERE id = $1 AND network_id = $2 LIMIT 1`,
      [slId, tenant.networkId],
    );
    const link = linkRes.rows[0];
    if (!link || link.status !== 'active') return divert(reply, link?.fallback_url ?? null);

    const itemsRes = await query<{ offer_id: string; weight: number; country: string | null }>(
      `SELECT offer_id, weight, country FROM smart_link_items WHERE smart_link_id = $1 AND network_id = $2`,
      [slId, tenant.networkId],
    );
    // Geo filter: keep items with no country target or one matching the visitor's country.
    const geo = req.ip ? lookupGeo(req.ip) : null;
    const country = geo?.country ?? null;
    const eligible = itemsRes.rows.filter((i) => !i.country || i.country === country);
    const pool = eligible.length ? eligible : itemsRes.rows;
    const chosen = pickWeighted(pool);
    if (!chosen) return divert(reply, link.fallback_url);

    // Forward to /click, preserving pub_id + subs and tagging the smart link.
    const params = new URLSearchParams({ offer_id: chosen, sl: slId });
    const pub = firstStr(q['pub_id']) ?? firstStr(q['aff_id']) ?? firstStr(q['p']);
    if (pub) params.set('pub_id', pub);
    for (const i of [1, 2, 3, 4, 5]) { const s = firstStr(q[`sub${i}`]); if (s) params.set(`sub${i}`, s); }
    return reply.code(302).header('location', `/click?${params.toString()}`).header('cache-control', 'no-store').send();
  });

  // ---- Conversion methods (spec §6) — all three normalize into recordConversion() ----

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

    const clickId = pick('click_id', 'cid', 'clickid');
    if (!clickId) return { outcome: 'click_not_found', networkResolved: true };

    const result = await recordConversion({
      networkId: tenant.networkId,
      clickId,
      txnId: pick('txn_id', 'transaction_id', 'tid'),
      event: pick('event', 'event_name', 'goal'),
      statusHint: pick('status'),
      payoutParam: pick('payout', 'amount'),
      revenueParam: pick('revenue'),
      secureCode: pick('secure_code', 'security_code'),
      source,
      rawParams: { ...q, ...b },
    });
    return { ...result, networkResolved: true };
  }

  // A. S2S / postback (primary). GET and POST both supported.
  const postback = async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header('cache-control', 'no-store'); // never let the edge cache a conversion ack
    const r = await handleConversion(req, 'postback');
    if (!r.networkResolved) return reply.code(404).send({ error: 'unknown_tracking_host' });
    if (r.outcome === 'click_not_found') return reply.code(404).send({ status: 'click_not_found' });
    if (r.outcome === 'security_failed') return reply.code(403).send({ status: 'security_failed', error: 'invalid or missing secure_code' });
    return reply.code(200).send({ status: r.outcome, conversion_id: r.conversionId ?? null });
  };
  app.get('/postback', postback);
  app.post('/postback', postback);

  // B. Pixel / image tag — always returns the 1x1 gif so the page renders (spec §6 caveats apply).
  app.get('/pixel', async (req, reply) => {
    await handleConversion(req, 'pixel');
    return reply.code(200).header('content-type', 'image/gif').header('cache-control', 'no-store').send(PIXEL_GIF);
  });

  // C. Iframe — serves a tiny document; same attribution core.
  app.get('/iframe', async (req, reply) => {
    await handleConversion(req, 'iframe');
    return reply
      .code(200)
      .header('content-type', 'text/html')
      .header('cache-control', 'no-store')
      .send('<!doctype html><title>ok</title>');
  });

  return app;
}
