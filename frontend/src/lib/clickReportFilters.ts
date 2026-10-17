/**
 * Click Report filter modal — pure state, validation, URL / API mapping and the field catalog.
 * No React or DOM here so `node --test` exercises the real logic (see lib/__tests__).
 *
 * Filters are single-value per category (the row-level `/api/reports/clicks` endpoint takes one value
 * per filter). URL params use the same names the API takes, so a shared link and the request agree:
 * offerId, publisherId, advertiserId, smartLinkId, country, device, conversionStatus, clickIds, ip,
 * sourceId, fbclid, gclid, isUnique (Visibility), plus `cols` for the selected Click Report Fields.
 */

export type Visibility = 'all' | 'unique' | 'duplicate';

export interface ClickFilters {
  offer: string;
  partner: string;
  advertiser: string;
  smartLink: string;
  country: string;
  device: string;
  conversionStatus: string;
  clickIds: string[];
  ip: string;
  /** Exact values captured from the click URL (?source_id|source|src, ?fbclid, ?gclid). */
  sourceId: string;
  fbclid: string;
  gclid: string;
  visibility: Visibility;
}

export const EMPTY_CLICK_FILTERS: ClickFilters = {
  offer: '', partner: '', advertiser: '', smartLink: '', country: '', device: '', conversionStatus: '',
  clickIds: [], ip: '', sourceId: '', fbclid: '', gclid: '', visibility: 'all',
};

/** Exact-match click-URL filters — same limit the API enforces. */
export const CAPTURED_FILTER_KEYS = ['sourceId', 'fbclid', 'gclid'] as const;
export type CapturedFilterKey = typeof CAPTURED_FILTER_KEYS[number];
export const MAX_CAPTURED_VALUE = 500;
export function capturedValueError(text: string): string | null {
  return text.trim().length > MAX_CAPTURED_VALUE ? `At most ${MAX_CAPTURED_VALUE} characters` : null;
}

export const VISIBILITY_OPTIONS: { value: Visibility; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unique', label: 'Unique clicks' },
  { value: 'duplicate', label: 'Duplicate clicks' },
];

// ── Click IDs ──────────────────────────────────────────────────────────────────────────────────
/** Same limit and format the API enforces (`clickIds` on /api/reports/clicks and /grouped). */
export const MAX_CLICK_IDS = 100;
const CLICK_ID_RE = /^[0-9a-f]{32}$/;

export interface ParsedClickIds { ids: string[]; invalid: string[] }

/**
 * Comma- (or line-) separated click IDs → trimmed, lower-cased, de-duplicated, empty entries dropped.
 * Entries that aren't a 32-character hex click ID are returned in `invalid` (never sent).
 */
export function parseClickIds(text: string): ParsedClickIds {
  const ids: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[,\n\r]+/)) {
    const s = raw.trim().toLowerCase();
    if (!s) continue;
    if (!CLICK_ID_RE.test(s)) { if (!invalid.includes(raw.trim())) invalid.push(raw.trim()); continue; }
    if (!ids.includes(s)) ids.push(s);
  }
  return { ids, invalid };
}

export function clickIdsError(text: string): string | null {
  const { ids, invalid } = parseClickIds(text);
  if (invalid.length) return `Not a click ID: ${invalid.slice(0, 3).join(', ')}${invalid.length > 3 ? ` (+${invalid.length - 3} more)` : ''} — click IDs are 32 hex characters`;
  if (ids.length > MAX_CLICK_IDS) return `At most ${MAX_CLICK_IDS} click IDs (${ids.length} entered)`;
  return null;
}

// ── IP address ─────────────────────────────────────────────────────────────────────────────────
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function isIpAddress(text: string): boolean {
  const s = text.trim();
  if (!s) return false;
  if (IPV4_RE.test(s)) return true;
  if (!s.includes(':') || /[^0-9a-fA-F:.]/.test(s)) return false;
  try {
    // The URL parser validates (and canonicalises) IPv6 literals.
    return new URL(`http://[${s}]/`).hostname.length > 2;
  } catch {
    return false;
  }
}

export function ipError(text: string): string | null {
  return text.trim() === '' || isIpAddress(text) ? null : 'Enter a valid IPv4 or IPv6 address';
}

// ── Draft (modal) state ────────────────────────────────────────────────────────────────────────
/** What the modal edits: the text inputs stay as typed until Apply. */
export interface ClickFilterDraft {
  filters: ClickFilters;
  clickIdsText: string;
  ipText: string;
  timezone: string; // '' = Auto
  fields: string[];
}

export function draftFromApplied(filters: ClickFilters, timezone: string, fields: Iterable<string>): ClickFilterDraft {
  return { filters: { ...filters, clickIds: [...filters.clickIds] }, clickIdsText: filters.clickIds.join(', '), ipText: filters.ip, timezone, fields: [...fields] };
}

export interface DraftErrors { clickIds?: string; ip?: string; sourceId?: string; fbclid?: string; gclid?: string; fields?: string }

export function draftErrors(d: ClickFilterDraft): DraftErrors {
  const e: DraftErrors = {};
  const c = clickIdsError(d.clickIdsText); if (c) e.clickIds = c;
  const i = ipError(d.ipText); if (i) e.ip = i;
  for (const k of CAPTURED_FILTER_KEYS) { const m = capturedValueError(d.filters[k]); if (m) e[k] = m; }
  if (!d.fields.some((k) => isSelectable(k))) e.fields = 'Select at least one field';
  return e;
}

/** The applied filters a valid draft commits (text inputs parsed). Call only when draftErrors is empty. */
export function filtersFromDraft(d: ClickFilterDraft): ClickFilters {
  return {
    ...d.filters, clickIds: parseClickIds(d.clickIdsText).ids, ip: d.ipText.trim(),
    sourceId: d.filters.sourceId.trim(), fbclid: d.filters.fbclid.trim(), gclid: d.filters.gclid.trim(),
  };
}

// ── Count / API / URL ──────────────────────────────────────────────────────────────────────────
/** Applied DATA filters with a non-default value. Dates, timezone and selected columns never count. */
export function appliedFilterCount(f: ClickFilters): number {
  return [f.offer, f.partner, f.advertiser, f.smartLink, f.country, f.device, f.conversionStatus, f.ip, f.sourceId, f.fbclid, f.gclid]
    .filter((v) => v !== '').length + (f.clickIds.length ? 1 : 0) + (f.visibility !== 'all' ? 1 : 0);
}

/** Request params shared by /api/reports/clicks and /api/reports/grouped (undefined = not sent). */
export function toApiParams(f: ClickFilters): Record<string, string | undefined> {
  const v = (s: string) => (s === '' ? undefined : s);
  return {
    offerId: v(f.offer), publisherId: v(f.partner), advertiserId: v(f.advertiser), smartLinkId: v(f.smartLink),
    country: v(f.country), device: v(f.device), conversionStatus: v(f.conversionStatus),
    clickIds: f.clickIds.length ? f.clickIds.join(',') : undefined,
    ip: v(f.ip),
    sourceId: v(f.sourceId), fbclid: v(f.fbclid), gclid: v(f.gclid),
    isUnique: f.visibility === 'unique' ? 'true' : f.visibility === 'duplicate' ? 'false' : undefined,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (sp: URLSearchParams, key: string) => (sp.get(key) ?? '').split(',')[0]!.trim();

/**
 * Applied filters from the URL (reload / shared link). Anything malformed is dropped rather than sent
 * — ids must be UUIDs, conversionStatus / device must be one of the offered values.
 */
export function filtersFromUrl(sp: URLSearchParams, opts: { conversionStatuses: readonly string[]; devices: readonly string[] }): ClickFilters {
  const id = (key: string) => { const s = first(sp, key); return UUID_RE.test(s) ? s : ''; };
  const country = first(sp, 'country');
  const device = first(sp, 'device');
  const status = first(sp, 'conversionStatus');
  const ip = (sp.get('ip') ?? '').trim();
  const isUnique = sp.get('isUnique');
  // Whole value (not comma-split — the API matches it exactly); over-long values are dropped.
  const captured = (key: string) => { const s = (sp.get(key) ?? '').trim(); return s.length <= MAX_CAPTURED_VALUE ? s : ''; };
  return {
    offer: id('offerId'), partner: id('publisherId'), advertiser: id('advertiserId'), smartLink: id('smartLinkId'),
    country: /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : '',
    device: opts.devices.includes(device) ? device : '',
    conversionStatus: opts.conversionStatuses.includes(status) ? status : '',
    clickIds: parseClickIds(sp.get('clickIds') ?? '').ids.slice(0, MAX_CLICK_IDS),
    ip: isIpAddress(ip) ? ip : '',
    sourceId: captured('sourceId'), fbclid: captured('fbclid'), gclid: captured('gclid'),
    visibility: isUnique === 'true' ? 'unique' : isUnique === 'false' ? 'duplicate' : 'all',
  };
}

/** Write applied filters into `next` with the API's param names (defaults are omitted). */
export function writeFiltersToUrl(next: URLSearchParams, f: ClickFilters): void {
  for (const [k, v] of Object.entries(toApiParams(f))) if (v !== undefined) next.set(k, v);
}

// ── Active-filter chips ────────────────────────────────────────────────────────────────────────
/** Applied filters as `{ chipCategory: [values] }` (one chip per click ID; defaults produce none). */
export function chipValues(f: ClickFilters): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const one = (k: string, v: string) => { if (v !== '') out[k] = [v]; };
  one('offer', f.offer); one('partner', f.partner); one('advertiser', f.advertiser); one('smartLink', f.smartLink);
  one('country', f.country); one('device', f.device); one('conversionStatus', f.conversionStatus); one('ip', f.ip);
  one('sourceId', f.sourceId); one('fbclid', f.fbclid); one('gclid', f.gclid);
  if (f.clickIds.length) out['clickIds'] = [...f.clickIds];
  if (f.visibility !== 'all') out['visibility'] = [f.visibility];
  return out;
}

/** Remove one chip: a click ID drops just that ID, any other filter returns to its default. */
export function withoutChip(f: ClickFilters, key: string, value: string): ClickFilters {
  if (key === 'clickIds') return { ...f, clickIds: f.clickIds.filter((id) => id !== value) };
  if (key === 'visibility') return { ...f, visibility: 'all' };
  if (key in EMPTY_CLICK_FILTERS) return { ...f, [key]: '' };
  return f;
}

// ── Rejected clicks ────────────────────────────────────────────────────────────────────────────
/** Why /click didn't send a click to the offer — its first fraud flag (backend lib/click-rejections.ts). */
const CLICK_REJECTION_LABELS: Record<string, string> = {
  offer_not_active: 'Offer not active',
  unknown_partner: 'Unknown partner',
  partner_pending: 'Partner pending approval',
  partner_inactive: 'Partner inactive',
  partner_blocked: 'Partner blocked on the offer',
  partner_not_approved: 'Partner not approved for the offer',
  platform_blocked: 'Blocked platform-wide',
  ip_blacklisted: 'IP blacklisted',
  geo_not_allowed: 'Geo not allowed',
  device_not_allowed: 'Device not allowed',
  targeting_not_matched: 'Targeting not matched',
  traffic_control_blocked: 'Blocked by a traffic control',
  traffic_blocked: 'Blocked by traffic blocking',
  fraud_blocked: 'Blocked as fraud',
  cap_exceeded: 'Cap has been exceeded',
  partner_cap_exceeded: 'Partner cap has been exceeded',
};

/** The rejection reason in words, or null for a click that was sent to the offer. */
export function clickRejection(fraudFlags: readonly string[] | null | undefined): string | null {
  const first = fraudFlags?.[0];
  return first != null ? CLICK_REJECTION_LABELS[first] ?? null : null;
}

// ── Click Report Fields ────────────────────────────────────────────────────────────────────────
/**
 * `stored`  — a column of `clicks`, returned by /api/reports/clicks.
 * `lookup`  — resolved from the network's own offers / partners / advertisers lists (already loaded).
 * `unavailable` — not tracked anywhere in this schema: listed (so the field set matches the reference)
 *                 but disabled, never requested, shown or exported.
 */
export type FieldSupport = 'stored' | 'lookup' | 'unavailable';
export interface ClickField { key: string; label: string; support: FieldSupport; hint?: string }

// Each disabled field names exactly what is missing (see docs/claude/FRONTEND.md › Click report fields).
const NO_LANDING_PAGE = 'Not tracked — offers have one destination URL; a click never records a landing page';
const NO_PARAM = (what: string) => `Not tracked — the click URL has no ${what} parameter and nothing stores one`;
const NO_DEVICE_ID = 'Not tracked — needs a defined click-URL parameter and a privacy / retention decision for device advertising IDs';
const NO_FULL_URL = 'Not stored — keeping full URLs per click needs a storage and redaction decision (query strings can carry tokens)';

/** Reference order (the checkbox grid), then this report's existing columns that the reference lacks. */
export const CLICK_FIELDS: readonly ClickField[] = [
  { key: 'clickId', label: 'Click ID', support: 'stored' },
  { key: 'offerId', label: 'Offer ID', support: 'lookup', hint: "The offer's numeric ID" },
  { key: 'offerTitle', label: 'Offer Title', support: 'lookup' },
  { key: 'partnerId', label: 'Partner ID', support: 'lookup', hint: "The partner's numeric ID" },
  { key: 'partnerName', label: 'Partner Name', support: 'lookup', hint: "The partner's contact person" },
  { key: 'partnerCompany', label: 'Partner Company', support: 'lookup', hint: "The partner's name (company)" },
  { key: 'smartLinkId', label: 'Smart Link ID', support: 'stored' },
  { key: 'advertiserId', label: 'Advertiser ID', support: 'lookup', hint: "The offer's advertiser's numeric ID" },
  { key: 'advertiserName', label: 'Advertiser Name', support: 'lookup' },
  { key: 'advertiserCompany', label: 'Advertiser Company', support: 'unavailable', hint: 'Advertisers have one name (shown as Advertiser Name) — no separate company is stored' },
  { key: 'landingPageId', label: 'Landing Page ID', support: 'unavailable', hint: NO_LANDING_PAGE },
  { key: 'landingPageTitle', label: 'Landing Page Title', support: 'unavailable', hint: NO_LANDING_PAGE },
  { key: 'source', label: 'Source', support: 'stored', hint: 'Traffic source from the click URL (source_id / source / src) — empty on clicks recorded before it was captured' },
  { key: 'ip', label: 'IP Address', support: 'stored' },
  { key: 'country', label: 'Country', support: 'stored' },
  { key: 'region', label: 'Region', support: 'stored' },
  { key: 'city', label: 'City', support: 'stored' },
  { key: 'isp', label: 'ISP', support: 'stored' },
  { key: 'device', label: 'Device', support: 'stored' },
  { key: 'browser', label: 'Browser', support: 'stored' },
  { key: 'os', label: 'Operating System', support: 'stored' },
  { key: 'userAgent', label: 'User Agent', support: 'stored' },
  { key: 'referer', label: 'Referer', support: 'stored', hint: 'Referring page URL (credentials in it are redacted)' },
  { key: 'isUnique', label: 'Is Unique', support: 'stored' },
  { key: 'note', label: 'Note', support: 'unavailable', hint: 'Not tracked — clicks have no note and nothing writes one' },
  { key: 'referrerOfferId', label: 'Referrer Offer ID', support: 'unavailable', hint: 'Not tracked — a click forwarded from another offer does not record that offer' },
  { key: 'gaid', label: 'GAID', support: 'unavailable', hint: NO_DEVICE_ID },
  { key: 'idfa', label: 'IDFA', support: 'unavailable', hint: NO_DEVICE_ID },
  { key: 'appId', label: 'App ID', support: 'unavailable', hint: NO_PARAM('app') },
  { key: 'appName', label: 'App Name', support: 'unavailable', hint: NO_PARAM('app') },
  { key: 'currency', label: 'Currency', support: 'stored' },
  { key: 'creativeName', label: 'Creative Name', support: 'unavailable', hint: NO_PARAM('creative') },
  { key: 'payout', label: 'Payout', support: 'stored', hint: 'Payout rate frozen on the click (paid only when it converts)' },
  { key: 'revenue', label: 'Revenue', support: 'stored', hint: 'Revenue rate frozen on the click (earned only when it converts)' },
  { key: 'isRejected', label: 'Is Rejected', support: 'stored', hint: 'Not sent to the offer (cap exceeded, geo, partner blocked, …) — recorded as an invalid click with the reason' },
  { key: 'connectionType', label: 'Connection Type', support: 'unavailable', hint: 'Not tracked — needs a connection-type database (e.g. MaxMind GeoIP2 Connection-Type), which is not loaded' },
  { key: 'proxy', label: 'Proxy', support: 'unavailable', hint: 'Not tracked — only offers with IPQualityScore are checked and whether a check ran is not stored, so "no flag" cannot be shown as "not a proxy"' },
  { key: 'proxyCountry', label: 'Proxy Country', support: 'unavailable', hint: 'Not tracked — no connected provider returns it' },
  { key: 'latitude', label: 'Latitude', support: 'unavailable', hint: 'Not tracked — needs the MaxMind City database at click time plus new click columns' },
  { key: 'longitude', label: 'Longitude', support: 'unavailable', hint: 'Not tracked — needs the MaxMind City database at click time plus new click columns' },
  { key: 'erid', label: 'ERID', support: 'unavailable', hint: NO_PARAM('ERID (ad marking)') },
  { key: 'fbClickId', label: 'FB Click ID', support: 'stored', hint: 'fbclid from the click URL — empty when the traffic source did not append it' },
  { key: 'googleClickId', label: 'Google Click ID', support: 'stored', hint: 'gclid from the click URL — empty when the traffic source did not append it' },
  { key: 'finalUrl', label: 'Final URL', support: 'unavailable', hint: NO_FULL_URL },
  { key: 'clickUrl', label: 'Click URL', support: 'unavailable', hint: NO_FULL_URL },
  { key: 'createdDate', label: 'Created Date', support: 'stored' },
  // This report's existing columns the reference list doesn't have.
  { key: 'converted', label: 'Converted', support: 'stored', hint: 'Has any conversion (approved, pending or rejected)' },
  { key: 'fraudScore', label: 'Fraud Score', support: 'stored' },
  { key: 'rejectionReason', label: 'Rejection Reason', support: 'stored', hint: 'Why /click did not send the click to the offer' },
  ...(['1', '2', '3', '4', '5'] as const).map((n) => ({ key: `sub${n}`, label: `Sub${n}`, support: 'stored' as const })),
];

const BY_KEY = new Map(CLICK_FIELDS.map((f) => [f.key, f]));
export const fieldByKey = (key: string): ClickField | undefined => BY_KEY.get(key);
export const isSelectable = (key: string): boolean => { const f = BY_KEY.get(key); return f != null && f.support !== 'unavailable'; };

/** The columns this report showed before the modal existed — the default selection. */
export const DEFAULT_FIELDS: readonly string[] = [
  'createdDate', 'converted', 'offerTitle', 'partnerCompany', 'country', 'region', 'city', 'isp', 'device', 'os',
  'browser', 'isUnique', 'fraudScore', 'ip', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5',
];

/** Table / export column order: date and conversion first (as before), then the catalog order. */
export const TABLE_ORDER: readonly string[] = [
  'createdDate', 'converted',
  ...CLICK_FIELDS.map((f) => f.key).filter((k) => k !== 'createdDate' && k !== 'converted'),
];

/** Selected, selectable fields in table order — the ONE list both <thead> and <tbody> (and exports) iterate. */
export function visibleColumns(selected: Iterable<string>): string[] {
  const s = new Set(selected);
  return TABLE_ORDER.filter((k) => s.has(k) && isSelectable(k));
}

/** Fields whose label matches the search (case-insensitive), in catalog order. */
export function searchFields(query: string): ClickField[] {
  const q = query.trim().toLowerCase();
  return q ? CLICK_FIELDS.filter((f) => f.label.toLowerCase().includes(q)) : [...CLICK_FIELDS];
}

/** "Select All" state over the SELECTABLE fields among `matching` (the current search results). */
export function selectAllState(selected: Iterable<string>, matching: readonly ClickField[]): 'all' | 'some' | 'none' {
  const s = new Set(selected);
  const keys = matching.filter((f) => f.support !== 'unavailable').map((f) => f.key);
  const on = keys.filter((k) => s.has(k)).length;
  return keys.length === 0 || on === 0 ? 'none' : on === keys.length ? 'all' : 'some';
}

/** Turn every selectable field in `matching` on or off; fields outside the search are left alone. */
export function setAllFields(selected: Iterable<string>, matching: readonly ClickField[], on: boolean): string[] {
  const s = new Set(selected);
  for (const f of matching) if (f.support !== 'unavailable') { if (on) s.add(f.key); else s.delete(f.key); }
  return TABLE_ORDER.filter((k) => s.has(k));
}

/**
 * One field's checkbox: turn `key` on/off in the selection. An untracked (unavailable) or unknown
 * field never changes the selection, whatever the DOM does.
 */
export function toggleField(selected: Iterable<string>, key: string, on: boolean): string[] {
  const f = BY_KEY.get(key);
  return f ? setAllFields(selected, [f], on) : TABLE_ORDER.filter((k) => new Set(selected).has(k));
}

/** `cols` URL value → selection; null when absent or nothing usable (→ defaults). */
export function fieldsFromUrl(sp: URLSearchParams): string[] | null {
  const raw = sp.get('cols');
  if (raw == null) return null;
  const keys = visibleColumns(raw.split(',').map((s) => s.trim()));
  return keys.length ? keys : null;
}

/** Write `cols` only when the selection differs from the default (keeps ordinary links short). */
export function writeFieldsToUrl(next: URLSearchParams, fields: Iterable<string>): void {
  const vis = visibleColumns(fields);
  const dflt = visibleColumns(DEFAULT_FIELDS);
  if (vis.length !== dflt.length || vis.some((k, i) => k !== dflt[i])) next.set('cols', vis.join(','));
}

// ── Fields list layout (modal) ────────────────────────────────────────────────────────────────
/**
 * The modal's field list split into the selectable fields (shown) and the untracked ones (behind the
 * collapsed "Show untracked fields" toggle). Display only — catalog order is kept within each part, so
 * Sub1–Sub5 stay last among the tracked fields; selection / URL / export logic never use this split.
 */
export function partitionFields(fields: readonly ClickField[]): { tracked: ClickField[]; untracked: ClickField[] } {
  return {
    tracked: fields.filter((f) => f.support !== 'unavailable'),
    untracked: fields.filter((f) => f.support === 'unavailable'),
  };
}

/** Text of the untracked-fields toggle, with the count of untracked fields it reveals. */
export function untrackedToggleLabel(count: number, open: boolean): string {
  return `${open ? 'Hide' : 'Show'} untracked fields (${count})`;
}

// ── Group By mode ──────────────────────────────────────────────────────────────────────────────
/**
 * Header for the grouped table's dimension column. Day groups are calendar days of the report's time
 * zone (D7 — the API buckets in it, and the date range is its days too); the label names the zone.
 */
export function groupDimensionHeader(groupBy: string, label: string, zone = 'UTC'): { label: string; title?: string } {
  return groupBy === 'day'
    ? { label: `${label} (${zone})`, title: `Each row is one calendar day in the report's time zone (${zone})` }
    : { label };
}

/** Grouped money and conversions count APPROVED conversions only; Converted (individual clicks) is any status. */
export const GROUPED_CONVERSIONS_NOTE = 'Approved conversions of these clicks (pending and rejected are not counted)';

/** One export record: the visible columns, in table order, keyed by their labels. */
export function exportRecord(columns: readonly string[], valueOf: (key: string) => string | number): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const k of columns) out[fieldByKey(k)?.label ?? k] = valueOf(k);
  return out;
}
