/**
 * /sdk.js — the JavaScript tag for direct linking (Edit Offer › Click Tracking Type "Redirect + Direct Linking").
 * The advertiser puts it on their site; partners then link straight to the advertiser's page with our
 * parameters, no redirect through the tracking domain:
 *
 *   https://advertiser.example/landing?offer_id=12&pub_id=7&sub1=…
 *
 *   <script src="https://<tracking-domain>/sdk.js"></script>
 *   <script>trk.click();</script>                      — on the landing page (or data-auto-click on the tag)
 *   <script>trk.conversion({ event: 'purchase', txn_id: 'ORDER-1' });</script>   — on the thank-you page
 *
 * trk.click() reads offer_id / pub_id (oid / affid / aff_id), sub1–sub5 and source_id from the page URL and
 * registers the click (/click?format=json from the visitor's browser — accepted only from the offer's own site)
 * and keeps the click id in a first-party cookie + localStorage on the advertiser's domain for the offer's
 * attribution window. A visitor who arrived through a redirect tracking link already has our click id in the
 * URL (click_id, or the parameter named by clickIdParam) — it is kept instead of a new click. trk.conversion()
 * fires the conversion pixel with it (pixels are bound to the offer's site and never set a price); with no
 * click it sends the offer instead, for view-through. Brand-neutral global: `trk`.
 */
import type { FastifyInstance } from 'fastify';
import { errorEnvelope } from '../../lib/http/index.js';
import { resolveHostToNetwork } from '../../middleware/host-resolver.js';

export const SDK_JS = `(function () {
  'use strict';
  if (window.trk && window.trk.version) return;
  var script = document.currentScript;
  var BASE = script && script.src ? new URL(script.src).origin : '';
  var PREFIX = '_trk_cid_';
  var DEFAULT_AGE = 2592000;
  function param(names) {
    var u = new URL(window.location.href);
    for (var i = 0; i < names.length; i++) { var v = u.searchParams.get(names[i]); if (v) return v; }
    return null;
  }
  function readCookie(name) {
    var parts = document.cookie ? document.cookie.split('; ') : [];
    for (var i = 0; i < parts.length; i++) {
      var j = parts[i].indexOf('=');
      if (parts[i].slice(0, j) === name) return decodeURIComponent(parts[i].slice(j + 1));
    }
    return null;
  }
  function store(offerId, clickId, ageS) {
    var age = Math.max(60, Math.min(ageS || DEFAULT_AGE, 31536000));
    var attrs = '; max-age=' + age + '; path=/; SameSite=Lax' + (window.location.protocol === 'https:' ? '; Secure' : '');
    document.cookie = PREFIX + offerId + '=' + encodeURIComponent(clickId) + attrs;
    document.cookie = '_trk_cid=' + encodeURIComponent(clickId) + attrs;
    try {
      var rec = JSON.stringify({ id: clickId, exp: Date.now() + age * 1000 });
      window.localStorage.setItem(PREFIX + offerId, rec);
      window.localStorage.setItem('_trk_cid', rec);
    } catch (e) { /* storage blocked: the cookie is enough */ }
  }
  function stored(offerId) {
    var key = offerId ? PREFIX + offerId : '_trk_cid';
    var fromCookie = readCookie(key);
    if (fromCookie) return fromCookie;
    try {
      var rec = JSON.parse(window.localStorage.getItem(key) || 'null');
      if (rec && rec.id && rec.exp > Date.now()) return rec.id;
    } catch (e) { /* ignore */ }
    return null;
  }
  var trk = {
    version: 1,
    click: function (opts) {
      opts = opts || {};
      var offerId = opts.offer_id || param(['offer_id', 'oid']);
      var pubId = opts.pub_id || opts.affiliate_id || param(['pub_id', 'aff_id', 'affid']);
      var existing = opts.click_id || param(opts.clickIdParam ? [opts.clickIdParam] : ['click_id', '_trk_cid']);
      if (!offerId) return Promise.resolve(existing || null);
      if (existing) { store(offerId, existing, opts.max_age); return Promise.resolve(existing); }
      var q = new URLSearchParams({ offer_id: offerId, format: 'json' });
      if (pubId) q.set('pub_id', pubId);
      ['sub1', 'sub2', 'sub3', 'sub4', 'sub5', 'source_id'].forEach(function (k) { var v = opts[k] || param([k]); if (v) q.set(k, v); });
      if (document.referrer) q.set('referrer', document.referrer);
      return fetch(BASE + '/click?' + q.toString(), { credentials: 'omit', redirect: 'manual' })
        .then(function (r) { return r.status === 200 ? r.json() : null; })
        .then(function (j) {
          var d = j && j.data;
          if (d && d.click_id) { store(offerId, d.click_id, d.attribution_window_s); return d.click_id; }
          return null;
        })
        .catch(function () { return null; });
    },
    conversion: function (opts) {
      opts = opts || {};
      var offerId = opts.offer_id || null;
      var clickId = opts.click_id || stored(offerId) || stored(null);
      var q = new URLSearchParams();
      if (clickId) q.set('click_id', clickId);
      else if (offerId) q.set('offer_id', offerId);
      else return Promise.resolve(false);
      ['event', 'txn_id', 'transaction_id', 'sale_amount', 'email'].forEach(function (k) { if (opts[k] != null) q.set(k, String(opts[k])); });
      return new Promise(function (resolve) {
        var img = new Image(1, 1);
        img.onload = function () { resolve(true); };
        img.onerror = function () { resolve(false); };
        img.src = BASE + '/pixel?' + q.toString();
      });
    },
    getClickId: function (offerId) { return stored(offerId); }
  };
  window.trk = trk;
  if (script && script.hasAttribute('data-auto-click')) trk.click();
})();
`;

export function registerSdkRoutes(app: FastifyInstance): void {
  app.get('/sdk.js', async (req, reply) => {
    // Served only on the network's own tracking domains, like every other tracking endpoint.
    if (!(await resolveHostToNetwork((req.headers.host ?? '').toString()))) {
      return reply.code(404).send(errorEnvelope('not_found', 'unknown_tracking_host', 404));
    }
    return reply.code(200).header('content-type', 'application/javascript; charset=utf-8')
      .header('cache-control', 'public, max-age=3600').send(SDK_JS);
  });
}

/** The snippet an advertiser puts on their site (shown with the offer's links). */
export function sdkSnippet(trackingBase: string): { landing: string; conversion: string } {
  return {
    landing: `<script src="${trackingBase}/sdk.js" data-auto-click></script>`,
    conversion: `<script src="${trackingBase}/sdk.js"></script>\n<script>trk.conversion({ event: 'purchase', txn_id: 'ORDER_ID' });</script>`,
  };
}
