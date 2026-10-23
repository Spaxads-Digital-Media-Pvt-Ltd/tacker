/**
 * Dashboard figures — pure. Change rules, conversion rate from RAW counts (never the API's `cr`
 * field), bucket alignment, and the five KPI definitions. Money never crosses currencies: a change is
 * computed only between comparable periods (lib/reportCurrency `comparePeriods`), and a money series
 * whose window mixes currencies isn't plotted.
 */
import { combineCurrencies, currenciesOf, type MoneyField, type RowCurrency } from '../../lib/reportCurrency';
import type { AggRow } from '../../shared-components/primitives/ReportPageKit';
import type { MetricTone } from '../../shared-components/primitives/ui';
import { bucketKeyOf, type DashboardRange } from './range';

// ── Change ───────────────────────────────────────────────────────────────────────────────────────

/**
 * A change between the current and the comparison value:
 *  - `none` ("No change") when equal — including 0 → 0;
 *  - `new` ("New") when the comparison is 0 and the current isn't (never "+100%" / "+∞%");
 *  - otherwise the relative change in % (`pct`), or — for rates — the difference in points (`pp`).
 */
export type Change =
  | { kind: 'none' }
  | { kind: 'new' }
  | { kind: 'pct'; value: number; up: boolean }
  | { kind: 'pp'; value: number; up: boolean };

export function changeOf(current: number, previous: number): Change {
  if (current === previous) return { kind: 'none' };
  if (previous === 0) return { kind: 'new' };
  const value = ((current - previous) / Math.abs(previous)) * 100;
  return { kind: 'pct', value, up: value > 0 };
}

/** A rate's change in percentage points; `null` rate = no clicks (undefined), so "New" once it exists. */
export function pointsChange(current: number | null, previous: number | null): Change | null {
  if (current === null && previous === null) return null;
  if (current === null) return null;
  if (previous === null) return { kind: 'new' };
  const value = current - previous;
  if (Math.abs(value) < 0.005) return { kind: 'none' };
  return { kind: 'pp', value, up: value > 0 };
}

const PCT = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' });
/** "+12.34%" / "−3.10 pp" / "New" / "No change". */
export function changeText(c: Change): string {
  if (c.kind === 'none') return 'No change';
  if (c.kind === 'new') return 'New';
  return c.kind === 'pct' ? `${PCT.format(c.value)}%` : `${PCT.format(c.value)} pp`;
}

// ── Rates + counts ───────────────────────────────────────────────────────────────────────────────

/**
 * Conversion rate in % from raw counts — `null` with no clicks (undefined, not 0%). The dashboard
 * passes approved `conversions` and ALL `clicks` (the dashboard periods endpoint has no invalid_clicks).
 */
export function crPct(conversions: number, clicks: number): number | null {
  return clicks > 0 ? (conversions / clicks) * 100 : null;
}

const RATE = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const formatRate = (v: number | null): string => (v === null ? '—' : `${RATE.format(v)}%`);

const INT = new Intl.NumberFormat('en-US');
export const formatCount = (v: number): string => INT.format(v);
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
export const formatCompact = (v: number): string => (Math.abs(v) >= 10_000 ? COMPACT.format(v) : INT.format(v));

export const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// ── Buckets ──────────────────────────────────────────────────────────────────────────────────────

/**
 * One value per bucket of `range` from sparse API rows: a missing bucket is 0. Rows landing on the
 * same bucket (a repeated wall hour at a DST fall-back) are added — counts only, or money already
 * known to be in one currency.
 */
export function alignSeries(rows: readonly AggRow[], range: Pick<DashboardRange, 'bucket' | 'buckets'>, metric: string): number[] {
  const at = new Map(range.buckets.map((k, i) => [k, i]));
  const out = range.buckets.map(() => 0);
  for (const r of rows) {
    const raw = r.dimensions[range.bucket];
    if (!raw) continue;
    const i = at.get(bucketKeyOf(raw, range.bucket));
    if (i !== undefined) out[i] = out[i]! + num(r.metrics[metric]);
  }
  return out;
}

/** CR per bucket in %, with a bucket that had no clicks as a gap (null). */
export function alignCrSeries(rows: readonly AggRow[], range: Pick<DashboardRange, 'bucket' | 'buckets'>): (number | null)[] {
  const clicks = alignSeries(rows, range, 'clicks');
  const conv = alignSeries(rows, range, 'conversions');
  return clicks.map((c, i) => crPct(conv[i]!, c));
}

/** The money currency of a set of graph rows: one currency, none (fallback), or mixed. */
export function rowsCurrency(rows: readonly AggRow[], fallback: string): RowCurrency {
  return combineCurrencies(rows.map((r) => currenciesOf(r.metrics)), fallback);
}

/** --dur-slow in ms (the KPI count-up length); 320 when the token can't be read. */
export function durSlowMs(): number {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--dur-slow').trim();
    const n = parseFloat(v);
    return Number.isFinite(n) ? (v.endsWith('ms') ? n : n * 1000) : 320;
  } catch {
    return 320;
  }
}

// ── KPI definitions ──────────────────────────────────────────────────────────────────────────────

export type KpiKey = 'revenue' | 'payout' | 'margin' | 'clicks' | 'conversions';

export interface KpiDef {
  key: KpiKey;
  label: string;
  tone: MetricTone;
  money: MoneyField | null;
  /** Report page the card opens, with the window's dates. */
  report: string;
}

export const KPIS: readonly KpiDef[] = [
  { key: 'revenue', label: 'Revenue', tone: 'revenue', money: 'revenue', report: '/app/reports/daily' },
  { key: 'payout', label: 'Payout', tone: 'payout', money: 'payout', report: '/app/reports/daily' },
  { key: 'margin', label: 'Margin', tone: 'margin', money: 'margin', report: '/app/reports/daily' },
  { key: 'clicks', label: 'Clicks', tone: 'clicks', money: null, report: '/app/reports/click' },
  { key: 'conversions', label: 'Conversions', tone: 'conversions', money: null, report: '/app/reports/conversion' },
];

/** A report link for the window's zone days. */
export function reportHref(path: string, range: Pick<DashboardRange, 'firstDay' | 'lastDay'>, extra: Record<string, string> = {}): string {
  return `${path}?${new URLSearchParams({ from: range.firstDay, to: range.lastDay, ...extra }).toString()}`;
}
