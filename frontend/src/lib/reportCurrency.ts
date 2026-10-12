/**
 * Which currency a report row's money is in — mixed currencies are never summed silently.
 *
 * The reporting API sends `currencies: string[]` per row (and on the groupBy=none summary): the
 * distinct currencies of the money-bearing (approved) conversions in that row, [] when there are
 * none. Its payout/revenue are plain SUMs, so a row whose conversions span several currencies has a
 * meaningless total (no FX conversion exists yet). Every report page resolves the row's currency
 * here, once:
 *
 *  - single → format the row's money in THAT currency (an all-USD row on a EUR network shows $)
 *  - mixed  → every money cell / money-derived ratio shows "Mixed" (no number)
 *  - none   → the fallback (network / row) currency — the money is zero anyway
 *
 * An older API omits `currencies` → treated as `none`, i.e. today's behaviour (fallback currency).
 * Pure (imports only lib/reportMath's formatter) — `node --test` exercises the real module
 * (lib/__tests__/reportCurrency.test.ts).
 */
import { money } from './reportMath.ts';

export type RowCurrency =
  | { kind: 'single'; currency: string }
  | { kind: 'mixed'; currencies: string[] }
  | { kind: 'none'; currency: string };

/** Distinct, upper-cased, sorted currency codes from an API `currencies` value (anything else → null). */
function codes(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const set = new Set<string>();
  for (const c of v) if (typeof c === 'string' && c.trim()) set.add(c.trim().toUpperCase());
  return [...set].sort();
}

function fromCodes(list: string[] | null, fallback: string): RowCurrency {
  if (!list || list.length === 0) return { kind: 'none', currency: fallback };
  if (list.length === 1) return { kind: 'single', currency: list[0]! };
  return { kind: 'mixed', currencies: list };
}

/** A row's currency from its `currencies` value; `fallback` when absent (old API) or empty. */
export function resolveCurrency(currencies: unknown, fallback: string): RowCurrency {
  return fromCodes(codes(currencies), fallback);
}

/** The `currencies` value inside a `/api/reports` metrics bag (typed as numbers/strings elsewhere). */
export function currenciesOf(metrics: unknown): unknown {
  return metrics && typeof metrics === 'object' ? (metrics as Record<string, unknown>)['currencies'] : undefined;
}

/**
 * One currency for several rows together (a graph series, a multi-row summary): the union of their
 * currencies — so two single-currency rows in different currencies are mixed as a whole.
 */
export function combineCurrencies(lists: readonly unknown[], fallback: string): RowCurrency {
  let seen = false;
  const set = new Set<string>();
  for (const l of lists) {
    const c = codes(l);
    if (!c) continue;
    seen = true;
    for (const x of c) set.add(x);
  }
  return fromCodes(seen ? [...set].sort() : null, fallback);
}

export const isMixed = (rc: RowCurrency): rc is { kind: 'mixed'; currencies: string[] } => rc.kind === 'mixed';

/** What a mixed money cell shows, and its explanation (title / tooltip). */
export const MIXED_LABEL = 'Mixed';
export function mixedTitle(currencies: readonly string[]): string {
  return `Mixed currencies (${currencies.join(', ')}) — not added together; no FX conversion yet`;
}

/** The `currency` column value an export writes for a mixed row. */
export const MIXED_EXPORT = 'MIXED';

/** Money (and money-derived) keys of the aggregate reports' export rows — blanked on mixed rows. */
export const REPORT_MONEY_EXPORT_KEYS = ['cpc', 'cpa', 'epc', 'rpc', 'rpa', 'revenue', 'payout', 'profit', 'margin'] as const;

/**
 * An export row with its `currency` column: the row's single currency (or the fallback when it has
 * no money), or "MIXED" with every money column left empty — never a summed number. `currency` is
 * written last, so it stays the trailing column (the order lib/export's withCurrencyColumn uses).
 */
export function withRowCurrency(
  row: Record<string, unknown>,
  rc: RowCurrency,
  moneyKeys: readonly string[] = REPORT_MONEY_EXPORT_KEYS,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  delete out['currency'];
  if (rc.kind !== 'mixed') { out['currency'] = rc.currency; return out; }
  for (const k of moneyKeys) if (k in out) out[k] = '';
  out['currency'] = MIXED_EXPORT;
  return out;
}

/**
 * Metric-filter fields whose values are money. A threshold has no currency, so these filters apply
 * only while every loaded row is in one currency — see moneyFilterBlockedBy below and ReportPageKit's
 * passesMetricFilters (`skipMoney`).
 */
export const MONEY_METRIC_FILTER_KEYS: readonly string[] = ['payout', 'revenue'];
export const isMoneyMetricKey = (key: string): boolean => MONEY_METRIC_FILTER_KEYS.includes(key);

/** A `/api/reports` metrics list plus `currencies` — request it wherever money metrics are requested. */
export const withCurrenciesMetric = (metrics: string): string => `${metrics},currencies`;

/**
 * Whether a row's money can be compared with an amount in `currency` (e.g. Pacing's actual vs the
 * offer group's cap): only when the row has no money or its one currency is that currency.
 */
export function comparableTo(rc: RowCurrency, currency: string): boolean {
  return rc.kind === 'none' || (rc.kind === 'single' && rc.currency === currency.trim().toUpperCase());
}

/** `withCurrenciesMetric` plus the per-currency breakdown — for summary (groupBy=none) queries only. */
export const withBreakdownMetrics = (metrics: string): string => `${metrics},currencies,money_by_currency`;

// ── Per-currency breakdowns ──────────────────────────────────────────────────────────────────────
// Newer APIs send, next to the summed money, `money_by_currency` (`/api/reports` opt-in metric) or
// `moneyByCurrency` (dashboard / summary / grouped / goals / pacing / offer groups):
// `{ [currency]: { payout, revenue, margin } }` as decimal strings — only the fields the audience may
// see. A mixed total can then be shown as its per-currency parts ("€30.25 · $13.00") instead of a bare
// "Mixed" — amounts are only ever added within one currency, never across.

export type MoneyField = 'payout' | 'revenue' | 'margin';
export const MONEY_FIELDS: readonly MoneyField[] = ['payout', 'revenue', 'margin'];
export type MoneyByCurrency = Record<string, Partial<Record<MoneyField, string>>>;

const DECIMAL = /^[-+]?(\d+(\.\d*)?|\.\d+)$/;

/** An API breakdown, normalised (upper-cased codes, decimal-string amounts); null when absent/malformed (older API). */
export function parseMoneyByCurrency(v: unknown): MoneyByCurrency | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: MoneyByCurrency = {};
  for (const [code, bag] of Object.entries(v as Record<string, unknown>)) {
    const c = code.trim().toUpperCase();
    if (!c || !bag || typeof bag !== 'object' || Array.isArray(bag)) continue;
    const entry: Partial<Record<MoneyField, string>> = { ...out[c] };
    for (const f of MONEY_FIELDS) {
      const raw = (bag as Record<string, unknown>)[f];
      const s = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
      if (DECIMAL.test(s)) entry[f] = s;
    }
    out[c] = entry;
  }
  return out;
}

/** The `money_by_currency` value inside a `/api/reports` metrics bag, parsed. */
export function moneyByCurrencyOf(metrics: unknown): MoneyByCurrency | null {
  return metrics && typeof metrics === 'object' ? parseMoneyByCurrency((metrics as Record<string, unknown>)['money_by_currency']) : null;
}

/** Exact decimal-string addition (no float drift) — used only for amounts in the SAME currency. */
export function addDecimal(a: string, b: string): string {
  const parse = (s: string) => {
    const t = s.trim();
    const [i = '', f = ''] = t.replace(/^[-+]/, '').split('.');
    return { neg: t.startsWith('-'), i: i || '0', f };
  };
  const x = parse(a), y = parse(b);
  const scale = Math.max(x.f.length, y.f.length);
  const big = (p: { neg: boolean; i: string; f: string }) => (p.neg ? -1n : 1n) * BigInt(p.i + p.f.padEnd(scale, '0'));
  const sum = big(x) + big(y);
  const neg = sum < 0n;
  const digits = (neg ? -sum : sum).toString().padStart(scale + 1, '0');
  const int = digits.slice(0, digits.length - scale), frac = digits.slice(digits.length - scale);
  return `${neg ? '-' : ''}${int}${scale ? `.${frac}` : ''}`;
}

/**
 * Several breakdowns added together per currency (rows of a multi-row summary). Null when none of
 * them carries one (older API); a field missing from any part that has the currency is dropped.
 */
export function combineMoneyByCurrency(list: readonly (MoneyByCurrency | null | undefined)[]): MoneyByCurrency | null {
  const present = list.filter((m): m is MoneyByCurrency => m != null);
  if (!present.length) return null;
  const out: MoneyByCurrency = {};
  const missing: [string, MoneyField][] = [];
  for (const m of present) {
    for (const [c, bag] of Object.entries(m)) {
      const acc = out[c] ?? (out[c] = {});
      for (const f of MONEY_FIELDS) {
        const v = bag[f];
        if (v === undefined) { missing.push([c, f]); continue; }
        acc[f] = acc[f] === undefined ? v : addDecimal(acc[f]!, v);
      }
    }
  }
  for (const [c, f] of missing) delete out[c]![f];
  return out;
}

/** The per-currency amounts of one money field, ordered by currency code — null when empty or any currency lacks it. */
export function breakdownParts(mbc: MoneyByCurrency | null | undefined, field: MoneyField): { currency: string; amount: string }[] | null {
  if (!mbc) return null;
  const codes = Object.keys(mbc).sort();
  if (!codes.length) return null;
  const parts: { currency: string; amount: string }[] = [];
  for (const c of codes) {
    const amount = mbc[c]![field];
    if (amount === undefined) return null;
    parts.push({ currency: c, amount });
  }
  return parts;
}

export const BREAKDOWN_SEP = ' · ';

/** "€30.25 · $13.00" — one amount per currency, stable (code) order; null when there's no usable breakdown. */
export function formatBreakdown(mbc: MoneyByCurrency | null | undefined, field: MoneyField): string | null {
  const parts = breakdownParts(mbc, field);
  return parts ? parts.map((p) => money(Number(p.amount), p.currency)).join(BREAKDOWN_SEP) : null;
}

/** What a money cell / tile shows. `muted`: the text is a placeholder ("Mixed"), not an amount. */
export interface MoneyText { text: string; title?: string; muted: boolean }

/**
 * How to show one money amount for a row/total, given its currency:
 *  - single → that currency; none → the fallback (network) currency
 *  - mixed + a breakdown of `field` → the breakdown when `roomy` (summary tiles, totals), else
 *    "Mixed" with the breakdown in the tooltip; mixed without one (older API, ratios) → "Mixed".
 */
export function moneyText(
  value: number, rc: RowCurrency,
  opts: { breakdown?: MoneyByCurrency | null; field?: MoneyField; roomy?: boolean } = {},
): MoneyText {
  if (rc.kind !== 'mixed') return { text: money(value, rc.currency), muted: false };
  const why = mixedTitle(rc.currencies);
  const parts = opts.field ? formatBreakdown(opts.breakdown, opts.field) : null;
  if (!parts) return { text: MIXED_LABEL, title: why, muted: true };
  return opts.roomy
    ? { text: parts, title: `Per currency — ${why}`, muted: false }
    : { text: MIXED_LABEL, title: `${parts}\n${why}`, muted: true };
}

// ── Money sorting ────────────────────────────────────────────────────────────────────────────────

/** Note shown by a table sorted on a money column when its rows span several currencies. */
export const SORTED_WITHIN_CURRENCY_NOTE = 'Sorted within each currency (no FX conversion)';

/**
 * Comparator for sorting rows by a money value without comparing currencies: single-currency rows
 * first, grouped by currency code (asc) and sorted by value (`dir`) within each currency; then rows
 * without money (by value, so an older API — every row "none" — sorts exactly as before); then mixed
 * rows last, in their existing order. The same order the server uses with `sortedWithinCurrency`.
 */
export function moneyRowComparator<T>(rcOf: (r: T) => RowCurrency, valueOf: (r: T) => number, dir: 'asc' | 'desc'): (a: T, b: T) => number {
  const rank = (rc: RowCurrency) => (rc.kind === 'single' ? 0 : rc.kind === 'none' ? 1 : 2);
  return (a, b) => {
    const ra = rcOf(a), rb = rcOf(b);
    const d = rank(ra) - rank(rb);
    if (d !== 0) return d;
    if (ra.kind === 'mixed') return 0;
    if (ra.kind === 'single' && rb.kind === 'single' && ra.currency !== rb.currency) return ra.currency < rb.currency ? -1 : 1;
    return dir === 'asc' ? valueOf(a) - valueOf(b) : valueOf(b) - valueOf(a);
  };
}

/** `rows` sorted by a money value with moneyRowComparator (a copy; stable). */
export function sortMoneyRows<T>(rows: readonly T[], rcOf: (r: T) => RowCurrency, valueOf: (r: T) => number, dir: 'asc' | 'desc'): T[] {
  return [...rows].sort(moneyRowComparator(rcOf, valueOf, dir));
}

/** Every currency across rows, and whether they span more than one (several single currencies, or any mixed row). */
export function currencySpan(rcs: readonly RowCurrency[]): { currencies: string[]; multi: boolean } {
  const all = new Set<string>();
  const singles = new Set<string>();
  let mixed = false;
  for (const rc of rcs) {
    if (rc.kind === 'single') { all.add(rc.currency); singles.add(rc.currency); }
    else if (rc.kind === 'mixed') { mixed = true; for (const c of rc.currencies) all.add(c); }
  }
  return { currencies: [...all].sort(), multi: mixed || singles.size > 1 };
}

/** Whether to show SORTED_WITHIN_CURRENCY_NOTE: the API sorted within currencies and the rows span several. */
export function showSortedWithinNote(sortedWithinCurrency: unknown, rcs: readonly RowCurrency[]): boolean {
  return sortedWithinCurrency === true && currencySpan(rcs).multi;
}

// ── Money metric filters ─────────────────────────────────────────────────────────────────────────

/**
 * A money metric filter ("Payout > 100") has no currency, so it only means something while every
 * loaded row is in one currency. Returns the currencies the result spans when it spans several —
 * money filters are then NOT applied, and the page says so — or null when they apply normally.
 */
export function moneyFilterBlockedBy(rcs: readonly RowCurrency[]): string[] | null {
  const span = currencySpan(rcs);
  return span.multi ? span.currencies : null;
}

/**
 * Apply a page's metric filters to `rows` under that rule: `passes(row, skipMoney)` is told to skip
 * the money filters when the rows span several currencies (e.g. an export's full row set).
 */
export function filterWithMoneyRule<T>(rows: readonly T[], rcOf: (r: T) => RowCurrency, passes: (r: T, skipMoney: boolean) => boolean): T[] {
  const skip = moneyFilterBlockedBy(rows.map(rcOf)) != null;
  return rows.filter((r) => passes(r, skip));
}

export function moneyFilterNote(currencies: readonly string[]): string {
  return `Money filters need a single currency — results span ${currencies.join(', ')}`;
}

/** Whether any money metric filter (Payout/Revenue) is set to a usable number. */
export function hasMoneyFilter(metricFilters: Readonly<Partial<Record<string, { value: string }>>>): boolean {
  return Object.entries(metricFilters).some(([k, e]) => isMoneyMetricKey(k) && e != null && e.value !== '' && !Number.isNaN(Number(e.value)));
}

// ── Comparing periods ────────────────────────────────────────────────────────────────────────────

/**
 * Whether two periods' money can be compared (a change %, a variance): never when either side mixes
 * currencies ("Mixed") or the two are in different currencies ("—"). A side without money (zero)
 * compares with anything; two sides without money compare in the fallback currency (older API:
 * today's behaviour). `label` is what the change shows instead of a number; `reason` its tooltip.
 */
export function comparePeriods(a: RowCurrency, b: RowCurrency):
  | { ok: true; currency: string }
  | { ok: false; label: string; reason: string } {
  if (a.kind === 'mixed' || b.kind === 'mixed') {
    const cs = [...new Set([...(a.kind === 'mixed' ? a.currencies : []), ...(b.kind === 'mixed' ? b.currencies : [])])].sort();
    return { ok: false, label: MIXED_LABEL, reason: `${mixedTitle(cs)} — no comparison` };
  }
  if (a.kind === 'single' && b.kind === 'single' && a.currency !== b.currency) {
    return { ok: false, label: '—', reason: `Periods are in different currencies (${a.currency} vs ${b.currency}) — not compared; no FX conversion yet` };
  }
  return { ok: true, currency: a.kind === 'single' ? a.currency : b.currency };
}
