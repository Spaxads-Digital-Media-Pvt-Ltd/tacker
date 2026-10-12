/**
 * Report-output redaction. The tracking surface stores every inbound conversion param verbatim in
 * `conversions.raw_params` (surfaces/tracking/app.ts), which includes the advertiser's postback
 * secret (`secure_code` / `security_code`) and whatever other credential a caller appends. Reports
 * must never hand a secret back out (screen or export), so its VALUE is replaced while the key is
 * kept — the reader can still see a code was sent.
 *
 * `isSensitiveParamKey` is the ONE definition of "this raw param is a secret": the report sanitizer
 * below, Customer Value data points (which may not read such a key — routes + evaluate) and any
 * future raw_params reader all use it — and `redactUrl` applies it to the query params of an outbound
 * postback URL (Partner Postback report).
 */
export const REDACTED = '[redacted]';

// Matched on the key lower-cased with `_` / `-` removed, so `secure_code`, `Secure-Code` and
// `SECURECODE` are one key — but only as the WHOLE name: look-alikes such as `secure_code_hint` or
// `promo_token` stay ordinary params.
const SENSITIVE_PARAM_KEYS = new Set([
  'securecode', 'securitycode', // the advertiser's postback secret (tracking /postback)
  'secret', 'clientsecret', 'apisecret',
  'token', 'accesstoken', 'refreshtoken', 'authtoken', 'idtoken',
  'apikey', 'password', 'passwd', 'signature', 'authorization', 'privatekey',
]);

/** True when a raw-param key names a secret (postback secure code, token, api key, password…). */
export function isSensitiveParamKey(key: string): boolean {
  return SENSITIVE_PARAM_KEYS.has(key.toLowerCase().replace(/[-_]/g, ''));
}

/** A query-string key as written (`api%5Fkey`, `a+b`) → its decoded form; the raw key when it won't decode. */
function decodeKey(raw: string): string {
  try { return decodeURIComponent(raw.replace(/\+/g, ' ')); } catch { return raw; }
}

/** `a=1&token=x;b` → `a=1&token=[redacted];b`: only sensitive VALUES change, every other byte is kept. */
function redactPairs(qs: string): string {
  // The capture group keeps the `&` / `;` separators in the split, so the join restores them as written.
  return qs.split(/([&;])/).map((pair, i) => {
    const eq = pair.indexOf('=');
    if (i % 2 === 1 || eq < 0 || !isSensitiveParamKey(decodeKey(pair.slice(0, eq)))) return pair;
    return `${pair.slice(0, eq)}=${REDACTED}`;
  }).join('');
}

// Fallback for a value that isn't a parseable URL (a half-substituted template, a bare query
// string, an error message quoting one): any `key=value` whose key is sensitive.
const LOOSE_PAIR = /(^|[?&#;\s])([^=&?#;\s]+)=([^&#;\s]*)/g;

/**
 * An outbound postback URL as it may be shown in a report: the partner's own credentials — userinfo
 * (`user:pass@`) and the VALUE of any query/fragment param whose key `isSensitiveParamKey` matches
 * (`token`, `api_key`, …) — become `[redacted]`; keys, order and every other param are kept as
 * written. Never throws. Secrets embedded in the path itself can't be told apart and are left alone.
 */
export function redactUrl(url: string): string {
  if (typeof url !== 'string' || url === '') return url;
  // Userinfo = everything before the LAST `@` of the authority (which ends at the first / ? #).
  let out = url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, `$1${REDACTED}@`);
  let parsed: boolean;
  try { parsed = new URL(url).protocol !== ''; } catch { parsed = false; }
  if (!parsed) {
    return out.replace(LOOSE_PAIR, (m, lead: string, key: string) => (isSensitiveParamKey(decodeKey(key)) ? `${lead}${key}=${REDACTED}` : m));
  }
  const hash = out.indexOf('#');
  const fragment = hash >= 0 ? out.slice(hash + 1) : null;
  const beforeHash = hash >= 0 ? out.slice(0, hash) : out;
  const q = beforeHash.indexOf('?');
  out = q >= 0 ? `${beforeHash.slice(0, q + 1)}${redactPairs(beforeHash.slice(q + 1))}` : beforeHash;
  return fragment == null ? out : `${out}#${redactPairs(fragment)}`;
}

/** Copy of `raw` with every sensitive param value (any case, at any depth) replaced by `[redacted]`. */
export function redactRawParams<T>(raw: T): T {
  if (Array.isArray(raw)) return raw.map((v) => redactRawParams(v)) as T;
  if (raw == null || typeof raw !== 'object') return raw;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = isSensitiveParamKey(k) ? REDACTED : redactRawParams(v);
  }
  return out as T;
}
