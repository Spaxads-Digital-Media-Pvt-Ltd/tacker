/**
 * Origin binding for browser-fired conversions (audit F-01 / F-14).
 *
 * /pixel and /iframe are fired by the visitor's browser, so they carry no secret. What a browser
 * does carry is the page it fired from: Referer (image and frame requests) or Origin (CORS/POST).
 * Requiring that page to belong to the offer's own site stops "pixel stuffing" — a partner
 * embedding the advertiser's conversion pixel on their own pages so real visitors' browsers fire
 * it. A script can forge these headers, which is why browser-fired conversions also never take a
 * client-supplied payout/revenue (see record.ts); money-critical offers should use the
 * authenticated S2S postback.
 *
 * Matching:
 *  - the tracking domain the request was served on: exact host only (tenant subdomains share the
 *    tracking base domain, so a site-level match there would admit other tenants' subdomains);
 *  - the offer's landing pages (default destination + geo-rule destination overrides): exact host
 *    or same registrable domain, since thank-you pages often sit on a sibling subdomain of the
 *    landing page (lp.brand.com → checkout.brand.com).
 * The registrable domain is a dependency-free heuristic (this repo carries no Public Suffix List):
 * common shared-hosting suffixes (myshopify.com, github.io, …) and two-part ccTLD suffixes
 * (co.uk, com.au, …) count as public suffixes, everything else keeps its last two labels.
 */
import { isIP } from 'node:net';
import type { OfferConfig } from '../offer-cache.js';

/** Shared-hosting suffixes where every customer subdomain is a separate site. */
const SHARED_HOSTING_SUFFIXES = [
  'myshopify.com', 'github.io', 'herokuapp.com', 'vercel.app', 'netlify.app', 'pages.dev',
  'workers.dev', 'wixsite.com', 'web.app', 'firebaseapp.com', 'azurewebsites.net',
  'cloudfront.net', 'appspot.com', 'blogspot.com', 'wordpress.com', 'squarespace.com',
  'webflow.io', 'onrender.com', 'fly.dev', 'glitch.me', 'amazonaws.com',
];

/** Second-level labels that form a public suffix under a two-letter ccTLD (co.uk, com.au, …). */
const CC_SECOND_LEVEL = new Set([
  'ac', 'co', 'com', 'edu', 'gov', 'net', 'org', 'mil', 'nic', 'ltd', 'plc', 'sch', 'nhs',
  'gen', 'firm', 'biz', 'info', 'or', 'ne', 'go', 'lg', 'ed', 'gr', 'nom',
]);

export interface RequestOrigin {
  /** Referer header — image and frame requests carry it. */
  referer: string | null;
  /** Origin header — CORS/POST requests carry it. The literal "null" (opaque origin) counts as absent. */
  origin: string | null;
  /** Host header of this request: the tracking domain the pixel/iframe was served from. */
  host: string | null;
}

function isIpHost(host: string): boolean {
  return isIP(host.replace(/^\[|\]$/g, '')) !== 0;
}

/** Hostname of a URL as the parser sees it (lower-cased, no trailing dot), or null. Lenient: a
 * templated host such as "{sub1}.brand.com" parses too. */
function parsedHostname(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw || raw === 'null') return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
    return u.hostname.toLowerCase().replace(/\.$/, '') || null;
  } catch {
    return null;
  }
}

/** Lower-cased hostname of a URL or bare host (port dropped), or null when it doesn't parse or
 * isn't a plain DNS / IP host — a templated "{sub1}.brand.com" is not a host. */
export function hostOf(value: string | null | undefined): string | null {
  const h = parsedHostname(value);
  return h && (/^[a-z0-9.-]+$/.test(h) || /^\[[0-9a-f:.]+\]$/.test(h)) ? h : null;
}

/**
 * The site a landing page names. A plain host is itself; a host that is partly a macro
 * ("https://{sub1}.brand.com/") still names its site through the concrete labels after the last
 * templated one — when they form at least a registrable domain ("lp.{brand}.com" names nothing).
 */
function destinationSite(url: string | null | undefined): string | null {
  const exact = hostOf(url);
  if (exact) return exact;
  const h = parsedHostname(url);
  if (!h) return null;
  const labels = h.split('.');
  let last = -1;
  labels.forEach((l, i) => { if (/[{}]/.test(l)) last = i; });
  const concrete = labels.slice(last + 1);
  if (last < 0 || concrete.length < 2 || concrete.some((l) => !/^[a-z0-9-]+$/.test(l))) return null;
  return concrete.join('.');
}

/** eTLD+1 heuristic (see the file comment). IP literals and single-label hosts come back unchanged. */
export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (isIpHost(h) || !h.includes('.')) return h;
  const labels = h.split('.');
  for (const suffix of SHARED_HOSTING_SUFFIXES) {
    if (h.endsWith(`.${suffix}`)) return labels.slice(-(suffix.split('.').length + 1)).join('.');
  }
  if (labels.length <= 2) return h;
  const tld = labels[labels.length - 1]!;
  const sld = labels[labels.length - 2]!;
  return labels.slice(tld.length === 2 && CC_SECOND_LEVEL.has(sld) ? -3 : -2).join('.');
}

function sameSite(a: string, b: string): boolean {
  if (a === b) return true;
  // IP literals and single-label hosts (localhost) only ever match exactly.
  if (isIpHost(a) || isIpHost(b) || !a.includes('.') || !b.includes('.')) return false;
  return registrableDomain(a) === registrableDomain(b);
}

export interface AllowedConversionHosts {
  /** Tracking domain(s): exact match only. */
  exact: string[];
  /** Offer landing-page hosts: exact or same registrable domain. */
  site: string[];
}

/**
 * Hosts a browser-fired conversion may come from. Destinations usually carry macros ({click_id}…)
 * in the path / query, which don't affect the host; a host that is itself partly templated is
 * reduced to the site it still names (see destinationSite).
 */
export function allowedConversionHosts(
  offer: Pick<OfferConfig, 'destinationUrl' | 'geoRules'> | null,
  requestHost: string | null,
): AllowedConversionHosts {
  const site = new Set<string>();
  const addSite = (v: string | null | undefined) => { const h = destinationSite(v); if (h) site.add(h); };
  if (offer) {
    addSite(offer.destinationUrl);
    for (const g of offer.geoRules ?? []) addSite(g.destinationOverride);
  }
  const tracking = hostOf(requestHost);
  return { exact: tracking ? [tracking] : [], site: [...site] };
}

/** The page host a browser-fired conversion came from: Origin when present, else Referer. */
export function conversionSourceHost(o: RequestOrigin | undefined): string | null {
  if (!o) return null;
  return hostOf(o.origin) ?? hostOf(o.referer);
}

/** True when the request came from the offer's site or from the tracking domain itself. */
export function conversionOriginAllowed(o: RequestOrigin | undefined, allowed: AllowedConversionHosts): boolean {
  const source = conversionSourceHost(o);
  if (!source) return false;
  return allowed.exact.includes(source) || allowed.site.some((h) => sameSite(source, h));
}

/** Is this URL on one of the offer's own sites (its landing pages — the default and each country's)? For deep links. */
export function onOfferSite(url: string, offer: Pick<OfferConfig, 'destinationUrl' | 'geoRules'>): boolean {
  const h = hostOf(url);
  if (!h || !/^https?:\/\//i.test(url)) return false;
  return allowedConversionHosts(offer, null).site.some((site) => sameSite(h, site));
}

/**
 * The page a partner deep-links to (&url=…), carrying every query parameter of the offer's own URL that the
 * deep link doesn't set itself — so the click id (and the other macros) still reach the advertiser the way the
 * offer URL passes them. Raw string work: the template's {macros} must survive to be filled in afterwards.
 */
export function deepLinkDestination(deep: string, template: string): string {
  const [base, ...hashParts] = deep.split('#');
  const hash = hashParts.length ? `#${hashParts.join('#')}` : '';
  const have = new Set<string>();
  const qi = base!.indexOf('?');
  if (qi >= 0) for (const seg of base!.slice(qi + 1).split('&')) if (seg) have.add(decodeURIComponent(seg.split('=')[0]!.replace(/\+/g, ' ')));
  const tq = template.indexOf('?');
  const extra = tq < 0 ? [] : template.slice(tq + 1).split('#')[0]!.split('&')
    .filter((seg) => seg && !have.has(decodeURIComponent(seg.split('=')[0]!.replace(/\+/g, ' '))));
  if (!extra.length) return deep;
  return `${base}${qi >= 0 ? (base!.endsWith('?') || base!.endsWith('&') ? '' : '&') : '?'}${extra.join('&')}${hash}`;
}
