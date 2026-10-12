/**
 * Shared building blocks for the "Reporting › X" dedicated report pages (Offer, Partner, …) — all
 * verified item-by-item against the live Everflow reference, which uses the identical Summary tile
 * set, "Reporting Filters" flyout structure, and page-level kebab across every report type. Kept
 * here once instead of duplicated per report page.
 *
 * Metric/column scope: Gross Clicks / Clicks (net of fraud-flagged) / Dup. Clicks / Invalid Clicks /
 * Total CV (all statuses) / CV (approved only) / Fraud (avg 0-100 fraud score) all derive from real
 * columns (`clicks.is_unique`, `clicks.fraud_flags`, `clicks.fraud_score`, `conversions.status` —
 * see api-backend/src/lib/reporting/postgres.ts). Impressions/CTR/CPM/RPM/VT CV/Media Buying
 * Cost/Avg Sale Value/Gross Sales/Throttle/Events have no real source anywhere in this app — shown
 * as "—" rather than a fabricated 0, so the tile/column is structurally present but honestly marked
 * untracked.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MoreVertical, Search } from 'lucide-react';
import type { FilterCategory, FilterValues } from './CategorizedFilters';
import { chipsFromValues, withoutValue, type ChipCategory, type FilterChip } from '../../lib/filterChips';
import { cleanFilterValues } from '../../lib/reportFilterState';
import { api } from '../../lib/api';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import { isMoneyMetricKey, MIXED_LABEL, mixedTitle, moneyFilterNote, moneyText, type MoneyByCurrency, type RowCurrency } from '../../lib/reportCurrency';

export interface AggRow { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }
/**
 * `sortedWithinCurrency` (newer API): ordered by a money metric, the rows come back partitioned —
 * single-currency rows grouped by currency, sorted within each; then rows without money; mixed last.
 */
export interface AggResult { rows: AggRow[]; total?: number; sortedWithinCurrency?: boolean }

export const METRICS_PARAM = 'clicks,unique_clicks,invalid_clicks,conversions,total_conversions,payout,revenue,margin,avg_fraud_score,epc';
export const DASH = '—';
// Every device class the tracker records (ua-parser-js `device.type`, 'desktop' when absent — see
// api-backend/src/lib/ua.ts).
export const DEVICES = ['desktop', 'mobile', 'tablet', 'console', 'smarttv', 'wearable', 'embedded'] as const;
const DEVICE_LABEL: Record<string, string> = { smarttv: 'Smart TV' };
export const deviceLabel = (d: string): string => DEVICE_LABEL[d] ?? d.charAt(0).toUpperCase() + d.slice(1);
export const DEVICE_OPTIONS: { value: string; label: string }[] = DEVICES.map((d) => ({ value: d, label: deviceLabel(d) }));

// Report math + formatting live in lib/reportMath.ts (pure, unit-tested); re-exported here so pages
// keep importing them from the kit.
import { money, pct, num, toIso, daysAgo, todayStr, deriveRow, type DerivedRow } from '../../lib/reportMath';
export { money, pct, num, toIso, daysAgo, todayStr, deriveRow, type DerivedRow };

/** `revenue: null` = not plotted (e.g. the days mix currencies, so their totals aren't comparable). */
export function MiniChart({ labels, revenue: revenueIn, clicks }: { labels: string[]; revenue: number[] | null; clicks: number[] }) {
  const revenue = revenueIn ?? [];
  const w = 900, h = 220, padL = 40, padR = 40, padT = 12, padB = 24;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const n = Math.max(1, labels.length);
  const revMax = Math.max(1, ...revenue), clickMax = Math.max(1, ...clicks);
  const x = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yRev = (v: number) => padT + plotH - (v / revMax) * plotH;
  const yClick = (v: number) => padT + plotH - (v / clickMax) * plotH;
  const revArea = revenue.length
    ? `${revenue.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yRev(v).toFixed(1)}`).join(' ')} L${x(n - 1).toFixed(1)},${padT + plotH} L${x(0).toFixed(1)},${padT + plotH} Z`
    : '';
  const clickLine = clicks.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yClick(v).toFixed(1)}`).join(' ');
  const step = Math.max(1, Math.ceil(n / 10));

  // Colors use the real Section-0 tokens so the chart is theme-aware. (This previously referenced a
  // `--color-*` var namespace that doesn't exist in this project, so it silently rendered the indigo
  // hex fallback in both themes — an accent mismatch, not a deliberate color.)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height: 240 }}>
      {revenue.length > 0 && <path d={revArea} fill="rgb(var(--accent-text))" opacity={0.15} />}
      {revenue.length > 0 && <path d={revenue.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yRev(v).toFixed(1)}`).join(' ')} fill="none" stroke="rgb(var(--accent-text))" strokeWidth={2} />}
      <path d={clickLine} fill="none" stroke="rgb(var(--text-muted))" strokeWidth={1.5} strokeDasharray="4 3" />
      {labels.map((l, i) => (i % step === 0 ? (
        <text key={i} x={x(i)} y={h - 4} fontSize={9} textAnchor="middle" fill="rgb(var(--text-secondary))">{l.slice(5)}</text>
      ) : null))}
    </svg>
  );
}

/** `compact`: a longer value (a per-currency breakdown) in a smaller face so the grid keeps its shape. */
export function SummaryTile({ label, value, title, compact = false }: { label: string; value: string; title?: string; compact?: boolean }) {
  return (
    <div>
      <p className="text-tiny uppercase text-fg-secondary">{label}</p>
      <p className={`${compact ? 'break-words text-body' : 'text-h3'} font-semibold ${value === DASH || value === MIXED_LABEL ? 'text-fg-muted' : 'text-fg'}`} title={title}>{value}</p>
    </div>
  );
}

/**
 * The fixed 21-tile Summary grid, identical across every report type on the live reference. Money
 * tiles are in the summary's own currency (`rc`, from the API's `currencies` — lib/reportCurrency)
 * or, without one, `currency` (the network's default, ISO 4217). Mixed currencies — never a
 * cross-currency sum: Payout / Revenue / Profit show their per-currency amounts ("€30.25 · $13.00")
 * when the API sent a breakdown (`breakdown`, the `money_by_currency` metric), else "Mixed"; the
 * ratios (CPC/CPA/RPC/RPA/Margin) stay "Mixed".
 */
export function SummaryGrid({ summary, currency = 'USD', rc, breakdown }: { summary: DerivedRow; currency?: string; rc?: RowCurrency; breakdown?: MoneyByCurrency | null }) {
  const cur: RowCurrency = rc ?? { kind: 'none', currency };
  const mixed = cur.kind === 'mixed' ? mixedTitle(cur.currencies) : undefined;
  const m = (v: number) => (cur.kind === 'mixed' ? MIXED_LABEL : money(v, cur.currency));
  const total = (label: string, v: number, field: 'payout' | 'revenue' | 'margin') => {
    const t = moneyText(v, cur, { breakdown, field, roomy: true });
    return <SummaryTile label={label} value={t.text} title={t.title} compact={cur.kind === 'mixed' && !t.muted} />;
  };
  return (
    <div className="grid grid-cols-2 gap-4 pt-4 sm:grid-cols-4 lg:grid-cols-7">
      <SummaryTile label="Media Buying Cost" value={DASH} />
      <SummaryTile label="Impression" value={DASH} />
      <SummaryTile label="Gross Clicks" value={summary.clicksGross.toLocaleString()} />
      <SummaryTile label="Clicks" value={summary.clicks.toLocaleString()} />
      <SummaryTile label="Total CV" value={summary.totalCv.toLocaleString()} />
      <SummaryTile label="VT CV" value={DASH} />
      <SummaryTile label="CTR" value={DASH} />
      <SummaryTile label="Event" value={DASH} />
      <SummaryTile label="CVR" value={pct(summary.cvr)} />
      <SummaryTile label="CPC" value={m(summary.cpc)} title={mixed} />
      <SummaryTile label="CPA" value={m(summary.cpa)} title={mixed} />
      <SummaryTile label="RPC" value={m(summary.rpc)} title={mixed} />
      <SummaryTile label="CPM" value={DASH} />
      <SummaryTile label="RPM" value={DASH} />
      <SummaryTile label="RPA" value={m(summary.rpa)} title={mixed} />
      {total('Payout', summary.payout, 'payout')}
      {total('Revenue', summary.revenue, 'revenue')}
      {total('Profit', summary.margin, 'margin')}
      <SummaryTile label="Margin" value={mixed ? MIXED_LABEL : pct(summary.marginPct)} title={mixed} />
      <SummaryTile label="Avg. Sale Value" value={DASH} />
      <SummaryTile label="Gross Sales" value={DASH} />
    </div>
  );
}

export type MetricFilterKey =
  | 'clicks' | 'uniqueClicks' | 'dupClicks' | 'invalidClicks' | 'totalCv' | 'cv' | 'payout' | 'revenue' | 'fraudScore';
export type MetricOp = '>' | '>=' | '<' | '<=';
export interface MetricFilterEntry { op: MetricOp; value: string }
export type MetricFilters = Partial<Record<MetricFilterKey, MetricFilterEntry>>;
export const METRIC_FILTER_FIELDS: { key: MetricFilterKey; label: string }[] = [
  { key: 'clicks', label: 'Clicks' },
  { key: 'uniqueClicks', label: 'Unique Clicks' },
  { key: 'dupClicks', label: 'Dup. Click' },
  { key: 'invalidClicks', label: 'Invalid Clicks' },
  { key: 'totalCv', label: 'Total CV' },
  { key: 'cv', label: 'CV' },
  { key: 'payout', label: 'Payout' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'fraudScore', label: 'Fraud' },
];
const OP_LABEL: Record<MetricOp, string> = { '>': '>', '>=': '≥', '<': '<', '<=': '≤' };
const OP_TEST: Record<MetricOp, (a: number, b: number) => boolean> = {
  '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b,
};
/**
 * `skipMoney`: the loaded rows span more than one currency (lib/reportCurrency moneyFilterBlockedBy),
 * so a Payout/Revenue threshold — which has no currency — is NOT applied (the page shows that it
 * isn't); the other metric filters still are. With one currency, money filters apply normally.
 */
export function passesMetricFilters(d: DerivedRow, metricFilters: MetricFilters, skipMoney = false): boolean {
  for (const f of METRIC_FILTER_FIELDS) {
    const entry = metricFilters[f.key];
    if (!entry || entry.value === '') continue;
    const threshold = Number(entry.value);
    if (Number.isNaN(threshold)) continue;
    if (skipMoney && isMoneyMetricKey(f.key)) continue;
    if (!OP_TEST[entry.op](d[f.key], threshold)) return false;
  }
  return true;
}

export interface ReportingFiltersValue { filters: FilterValues; exclusions: FilterValues; metricFilters: MetricFilters; ignoreFailTraffic: boolean }
export function dimCount(v: FilterValues): number { return Object.values(v).reduce((n, a) => n + (a?.length ?? 0), 0); }
export function reportingFiltersCount(v: ReportingFiltersValue): number {
  return dimCount(v.filters) + dimCount(v.exclusions) + Object.values(v.metricFilters).filter((m) => m?.value).length + (v.ignoreFailTraffic ? 1 : 0);
}

/** Chip keys for the non-dimension parts of the applied report filters. */
const METRIC_CHIP_PREFIX = 'metric:';
const IGNORE_FAIL_CHIP = 'others:ignoreFail';

/**
 * Every applied Reporting Filter as a chip — dimension filters, exclusions, metric filters and
 * "Ignore Fail Traffic" — so the chip row (and its "Clear all") covers everything the flyout set.
 */
export function reportingChips(categories: ChipCategory[], v: ReportingFiltersValue): FilterChip[] {
  const out = [...chipsFromValues(categories, v.filters), ...chipsFromValues(categories, v.exclusions, { exclude: true })];
  for (const f of METRIC_FILTER_FIELDS) {
    const e = v.metricFilters[f.key];
    if (!e || e.value === '' || Number.isNaN(Number(e.value))) continue;
    out.push({ key: `${METRIC_CHIP_PREFIX}${f.key}`, value: e.value, label: f.label, valueLabel: `${OP_LABEL[e.op]} ${e.value}` });
  }
  if (v.ignoreFailTraffic) out.push({ key: IGNORE_FAIL_CHIP, value: '1', label: 'Others', valueLabel: 'Ignore Fail Traffic' });
  return out;
}

/** The applied filters with one chip (from `reportingChips`) removed. */
export function withoutReportingChip(v: ReportingFiltersValue, chip: FilterChip): ReportingFiltersValue {
  if (chip.key === IGNORE_FAIL_CHIP) return { ...v, ignoreFailTraffic: false };
  if (chip.key.startsWith(METRIC_CHIP_PREFIX)) {
    const metricFilters = { ...v.metricFilters };
    delete metricFilters[chip.key.slice(METRIC_CHIP_PREFIX.length) as MetricFilterKey];
    return { ...v, metricFilters };
  }
  return chip.exclude
    ? { ...v, exclusions: withoutValue(v.exclusions, chip.key, chip.value) }
    : { ...v, filters: withoutValue(v.filters, chip.key, chip.value) };
}

export const EMPTY_REPORTING_FILTERS: ReportingFiltersValue = { filters: {}, exclusions: {}, metricFilters: {}, ignoreFailTraffic: false };

// ── Export ALL rows matching the applied filters (not just the visible page) ──

/** Hard ceiling on one export — past this the file is truncated and the page says so. */
export const EXPORT_ROW_CAP = 10_000;

/**
 * Page through a list endpoint until it is exhausted (or `cap` rows are collected). `path(limit,
 * offset)` builds each page's URL; the response is either a plain array (detail endpoints) or
 * `{ rows, total }` (/api/reports). Pages are fetched sequentially so a big export never floods the API.
 */
export async function fetchAllPages<T>(
  path: (limit: number, offset: number) => string,
  pageSize: number,
  cap: number = EXPORT_ROW_CAP,
): Promise<{ rows: T[]; capped: boolean; total: number | null }> {
  const rows: T[] = [];
  let total: number | null = null;
  for (let offset = 0; offset < cap; offset += pageSize) {
    const limit = Math.min(pageSize, cap - offset);
    const res = await api.get<T[] | { rows: T[]; total?: number }>(path(limit, offset));
    const page = Array.isArray(res) ? res : (res?.rows ?? []);
    if (!Array.isArray(res) && typeof res?.total === 'number') total = res.total;
    rows.push(...page);
    if (page.length < limit) return { rows, capped: false, total };
    if (total != null && rows.length >= total) return { rows, capped: false, total };
  }
  // Collected exactly `cap` rows — capped unless the source is known to hold no more.
  return { rows, capped: total == null || total > rows.length, total };
}

export interface ExportState { busy: boolean; note: string | null; error: string | null }

/**
 * Export runner shared by the report pages: loads every matching row (via `fetchAllPages` or any
 * loader), writes CSV/Excel, and reports a visible note when the export hit EXPORT_ROW_CAP.
 */
export function useReportExport() {
  const [state, setState] = useState<ExportState>({ busy: false, note: null, error: null });
  const run = useCallback(async (
    format: 'csv' | 'xlsx',
    filename: string,
    load: () => Promise<{ rows: Record<string, unknown>[]; capped?: boolean; total?: number | null }>,
  ) => {
    setState({ busy: true, note: null, error: null });
    try {
      const { rows, capped, total } = await load();
      if (!rows.length) { setState({ busy: false, note: 'Nothing to export for the applied filters.', error: null }); return; }
      if (format === 'csv') downloadCsv(`${filename}.csv`, rows); else await downloadXlsx(`${filename}.xlsx`, rows);
      setState({
        busy: false, error: null,
        note: capped
          ? `Export capped at the first ${rows.length.toLocaleString()} rows${total ? ` of ${total.toLocaleString()}` : ''} — narrow the date range or filters to export the rest.`
          : null,
      });
    } catch (e) {
      setState({ busy: false, note: null, error: e instanceof Error ? e.message : 'Export failed' });
    }
  }, []);
  const dismiss = useCallback(() => setState((s) => ({ ...s, note: null, error: null })), []);
  return { ...state, run, dismiss };
}

/** Inline status line for `useReportExport` — "Exporting…", the cap note, or the error. */
export function ExportStatus({ busy, note, error, onDismiss }: ExportState & { onDismiss: () => void }) {
  if (!busy && !note && !error) return null;
  return (
    <div role="status" className={`mb-3 flex items-center justify-between gap-2 rounded-[var(--radius)] border px-3 py-2 text-tiny ${error ? 'border-danger bg-danger-bg text-danger-text' : 'border-border bg-surface text-fg-secondary'}`}>
      <span>{busy ? 'Exporting all matching rows…' : error ? `Export failed: ${error}` : note}</span>
      {!busy && <button type="button" onClick={onDismiss} className="text-fg-muted hover:text-fg" aria-label="Dismiss">×</button>}
    </div>
  );
}

/**
 * "Reporting Filters" — verified against the live reference: a root menu of Filters / Metric
 * Filters / Exclusions / Others, each drilling into its own submenu. Filters/Exclusions share the
 * same dimension categories (Offer/Advertiser/Partner/Country/Device — all real, backend-filterable
 * dimensions; the reference's Offer Group/Coupon Code/Smart Link/Partner Tier/Tracking
 * Domain/Offer URL/Partner Manager/Account Manager/Sales Manager have no equivalent in this app's
 * report API and are omitted). Metric Filters covers the real per-row metrics this report already
 * computes (Clicks/Unique/Dup./Invalid Clicks, Total CV/CV, Payout, Revenue, Fraud) applied
 * client-side against the currently-loaded table rows — the backend has no HAVING-style aggregate
 * filter. Others › "Ignore Fail Traffic" is real: it excludes fraud-flagged clicks from the
 * aggregation entirely (api-backend/src/lib/reporting/postgres.ts `excludeInvalid`).
 */
type FlyoutSection = 'filters' | 'metric' | 'exclusions' | 'others';
const ALL_SECTIONS: FlyoutSection[] = ['filters', 'metric', 'exclusions', 'others'];

export function ReportingFiltersFlyout({
  dimCategories, value, onApply, onClose, sections = ALL_SECTIONS, singleSelect = false, moneyFilterBlockedBy = null,
}: {
  dimCategories: FilterCategory[]; value: ReportingFiltersValue; onApply: (v: ReportingFiltersValue) => void; onClose: () => void;
  /**
   * The currencies the loaded rows span when there are several (lib/reportCurrency
   * moneyFilterBlockedBy): the Payout/Revenue inputs are disabled then — a threshold has no currency.
   */
  moneyFilterBlockedBy?: readonly string[] | null;
  /** Only the sections this page's API actually honours — never show controls that do nothing. */
  sections?: FlyoutSection[];
  /** One value per category, for endpoints that accept a single id per filter. */
  singleSelect?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // With a single section (and, for Filters/Exclusions, a single category) the root menu would offer
  // one choice — open straight on it instead, and never step back above it.
  const [startPath] = useState<string[]>(() => {
    if (sections.length !== 1) return [];
    const only = sections[0]!;
    return (only === 'filters' || only === 'exclusions') && dimCategories.length === 1 ? [only, dimCategories[0]!.key] : [only];
  });
  const [path, setPath] = useState<string[]>(startPath);
  const atStart = path.length <= startPath.length;
  const [draftFilters, setDraftFilters] = useState<FilterValues>(value.filters);
  const [draftExclusions, setDraftExclusions] = useState<FilterValues>(value.exclusions);
  const [draftMetric, setDraftMetric] = useState<MetricFilters>(value.metricFilters);
  const [draftIgnoreFail, setDraftIgnoreFail] = useState(value.ignoreFailTraffic);
  const [catSearch, setCatSearch] = useState('');
  const [leafSearch, setLeafSearch] = useState('');

  useEffect(() => { setCatSearch(''); setLeafSearch(''); }, [path]);
  useEffect(() => {
    // The flyout is rendered next to its trigger (FiltersButton wraps both). A press on the trigger
    // is left to the button's own toggle — closing here on mousedown would let its click reopen it.
    const onDown = (e: MouseEvent) => {
      const host = ref.current?.parentElement ?? ref.current;
      if (!host?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const push = (seg: string) => setPath((p) => [...p, seg]);
  const pop = () => setPath((p) => (p.length > startPath.length ? p.slice(0, -1) : p));
  /** Submenu header: a back link, or — when this is where the flyout opened — the panel title. */
  const backHeader = (label: string, detail?: string) => (atStart
    ? <h3 className="text-small font-semibold text-fg">Reporting Filters{detail && <span className="font-normal text-fg-muted"> · {detail}</span>}</h3>
    : (
      <button type="button" onClick={pop} className="flex items-center gap-1 text-small font-semibold text-fg hover:text-accent-text">
        <ChevronLeft size={15} /> {label}
      </button>
    ));
  const metricCount = Object.values(draftMetric).filter((m) => m?.value).length;
  const total = dimCount(draftFilters) + dimCount(draftExclusions) + metricCount + (draftIgnoreFail ? 1 : 0);
  const clearAll = () => { setDraftFilters({}); setDraftExclusions({}); setDraftMetric({}); setDraftIgnoreFail(false); };
  const apply = () => { onApply({ filters: draftFilters, exclusions: draftExclusions, metricFilters: draftMetric, ignoreFailTraffic: draftIgnoreFail }); onClose(); };

  const Footer = () => (
    <div className="flex justify-end gap-2 border-t border-border px-3 py-2.5">
      <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
      <button type="button" className="btn-primary" onClick={apply}>Apply{total > 0 ? ` (${total})` : ''}</button>
    </div>
  );

  let body: JSX.Element;

  if (path.length === 0) {
    body = (
      <div className="w-72">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <h3 className="text-small font-semibold text-fg">Reporting Filters</h3>
          <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={clearAll}>Clear</button>
        </div>
        <div className="py-1">
          {([
            ['filters', 'Filters', dimCount(draftFilters)],
            ['metric', 'Metric Filters', metricCount],
            ['exclusions', 'Exclusions', dimCount(draftExclusions)],
            ['others', 'Others', draftIgnoreFail ? 1 : 0],
          ] as const).filter(([seg]) => sections.includes(seg)).map(([seg, label, n]) => (
            <button key={seg} type="button" onClick={() => push(seg)}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
              <span className="flex items-center gap-2">{label}{n > 0 && <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{n}</span>}</span>
              <ChevronRight size={13} className="text-fg-muted" />
            </button>
          ))}
        </div>
        <Footer />
      </div>
    );
  } else if (path[0] === 'filters' || path[0] === 'exclusions') {
    const isExclude = path[0] === 'exclusions';
    const draft = isExclude ? draftExclusions : draftFilters;
    const setDraft = isExclude ? setDraftExclusions : setDraftFilters;

    if (path.length === 1) {
      const visible = dimCategories.filter((c) => c.label.toLowerCase().includes(catSearch.toLowerCase()));
      body = (
        <div className="w-72">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            {backHeader(isExclude ? 'Exclusions' : 'Filters')}
            <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setDraft({})}>Clear</button>
          </div>
          <div className="relative border-b border-border px-3 py-2">
            <Search size={13} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !pl-7" placeholder="Search…" value={catSearch} onChange={(e) => setCatSearch(e.target.value)} autoFocus />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {visible.map((c) => {
              const n = (draft[c.key] ?? []).length;
              return (
                <button key={c.key} type="button" onClick={() => push(c.key)}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                  <span className="flex items-center gap-2">{c.label}{n > 0 && <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{n}</span>}</span>
                  <ChevronRight size={13} className="text-fg-muted" />
                </button>
              );
            })}
          </div>
          <Footer />
        </div>
      );
    } else {
      const cat = dimCategories.find((c) => c.key === path[1])!;
      const selected = draft[cat.key] ?? [];
      const filteredOptions = cat.options.filter((o) => o.label.toLowerCase().includes(leafSearch.toLowerCase()));
      const toggle = (v: string) => setDraft((d) => ({
        ...d,
        [cat.key]: selected.includes(v) ? selected.filter((x) => x !== v) : singleSelect ? [v] : [...selected, v],
      }));
      // "Select All" selects what the search currently shows, not hidden options too.
      const selectVisible = () => setDraft((d) => ({ ...d, [cat.key]: Array.from(new Set([...selected, ...filteredOptions.map((o) => o.value)])) }));
      body = (
        <div className="w-80">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            {backHeader(cat.label, cat.label)}
            <div className="flex items-center gap-2 text-tiny">
              {!singleSelect && <>
                <button type="button" className="font-medium text-accent-text hover:underline disabled:opacity-40" disabled={filteredOptions.length === 0} onClick={selectVisible}>
                  {leafSearch ? 'Select Shown' : 'Select All'}
                </button>
                <span className="text-border">|</span>
              </>}
              <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => setDraft((d) => ({ ...d, [cat.key]: [] }))}>Clear</button>
            </div>
          </div>
          <div className="relative border-b border-border px-3 py-2">
            <Search size={13} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !pl-7" placeholder="Search…" value={leafSearch} onChange={(e) => setLeafSearch(e.target.value)} autoFocus />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filteredOptions.length === 0 && <p className="px-3 py-3 text-small text-fg-muted">No options.</p>}
            {filteredOptions.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-small text-fg hover:bg-accent-subtle">
                {singleSelect ? (
                  // A radio fires no change event when it's already checked — use click, so pressing the
                  // selected option again clears it (as the old single-select drawer allowed).
                  <input type="radio" name={`rf-${cat.key}`} className="chk" checked={selected.includes(o.value)}
                    onChange={() => {}} onClick={() => toggle(o.value)} />
                ) : (
                  <input type="checkbox" className="chk" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                )}
                {o.label}
              </label>
            ))}
          </div>
          {singleSelect && selected.length > 0 && (
            <p className="border-t border-border px-3 py-1.5 text-tiny text-fg-muted">One value per filter — click the selected one again to clear it.</p>
          )}
          {!singleSelect && selected.length > 1 && (
            <p className="border-t border-border px-3 py-1.5 text-tiny text-fg-muted">Matches any of the {selected.length} selected (other categories are combined with AND).</p>
          )}
          <Footer />
        </div>
      );
    }
  } else if (path[0] === 'metric') {
    body = (
      <div className="w-96">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          {backHeader('Metric Filters')}
          <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setDraftMetric({})}>Clear</button>
        </div>
        <p className="border-b border-border px-3 py-2 text-tiny text-fg-muted">Applied to the rows already loaded on this page (after the server-side filters). Payout and Revenue filters apply only while every row is in one currency — a threshold has no currency.</p>
        {moneyFilterBlockedBy && <p className="border-b border-border bg-warning-bg px-3 py-2 text-tiny text-warning-text" role="status">{moneyFilterNote(moneyFilterBlockedBy)}</p>}
        <div className="max-h-80 space-y-2.5 overflow-y-auto p-3">
          {METRIC_FILTER_FIELDS.map((f) => {
            const entry = draftMetric[f.key];
            const off = !!moneyFilterBlockedBy && isMoneyMetricKey(f.key);
            return (
              <div key={f.key} className={`flex items-center gap-2 ${off ? 'opacity-60' : ''}`} title={off ? moneyFilterNote(moneyFilterBlockedBy!) : undefined}>
                <span className="w-28 shrink-0 text-small text-fg">{f.label}</span>
                <div className="flex overflow-hidden rounded-[var(--radius)] border border-border">
                  {(['>', '>=', '<', '<='] as MetricOp[]).map((op) => (
                    <button key={op} type="button" disabled={off}
                      onClick={() => setDraftMetric((m) => ({ ...m, [f.key]: { op, value: m[f.key]?.value ?? '' } }))}
                      className={`px-2 py-1 text-tiny disabled:cursor-not-allowed ${entry?.op === op ? 'bg-accent text-white' : 'bg-surface text-fg-secondary hover:bg-accent-subtle'}`}>
                      {OP_LABEL[op]}
                    </button>
                  ))}
                </div>
                <input type="number" className="input !w-24 disabled:cursor-not-allowed" placeholder="Value" value={entry?.value ?? ''} disabled={off}
                  onChange={(e) => setDraftMetric((m) => ({ ...m, [f.key]: { op: m[f.key]?.op ?? '>', value: e.target.value } }))} />
              </div>
            );
          })}
        </div>
        <Footer />
      </div>
    );
  } else {
    body = (
      <div className="w-72">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          {backHeader('Others')}
          <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setDraftIgnoreFail(false)}>Clear</button>
        </div>
        <label className="flex cursor-pointer items-center gap-2 px-3 py-3 text-small text-fg hover:bg-accent-subtle">
          <input type="checkbox" className="chk" checked={draftIgnoreFail} onChange={(e) => setDraftIgnoreFail(e.target.checked)} />
          Ignore Fail Traffic
        </label>
        <p className="border-t border-border px-3 py-2 text-tiny text-fg-muted">
          Leaves out fraud-flagged clicks and the conversions those clicks produced.
        </p>
        <Footer />
      </div>
    );
  }

  return (
    <div ref={ref} className="absolute right-0 top-full z-30 mt-1 rounded-card border border-border bg-elevated shadow-elevated">
      {body}
    </div>
  );
}

/**
 * Per-row kebab used in every report table. Rendered via a portal with fixed positioning (same
 * pattern already established in Offers.tsx) — a plain `absolute` dropdown gets clipped, because the
 * table's `overflow-x-auto` wrapper forces `overflow-y` to `auto` too (CSS spec: setting one overflow
 * axis to non-visible computes the other to `auto` if it was `visible`), so any menu that would
 * render below the last visible row in a scrollable table is invisible without a portal.
 */
export function RowKebabMenu({ items }: { items: { label: string; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    // Opening the menu often follows scrolling the row's kebab into view (e.g. a wide table's
    // horizontal scroll, or the click itself nudging layout) — attaching the scroll-close listener
    // on the same tick can catch that still-in-flight scroll and close the menu immediately after
    // it opens. Deferring registration by a frame lets any such trailing scroll settle first.
    let scrollListenerAttached = false;
    const raf = requestAnimationFrame(() => {
      window.addEventListener('scroll', onScroll, true);
      scrollListenerAttached = true;
    });
    return () => {
      document.removeEventListener('mousedown', onDown);
      cancelAnimationFrame(raf);
      if (scrollListenerAttached) window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button ref={btnRef} type="button" title="Actions" aria-haspopup="menu" aria-expanded={open} onClick={toggle}
        className="inline-grid h-7 w-7 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg">
        <MoreVertical size={15} />
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-50 w-52 origin-top-right animate-fade-in rounded-card border border-border bg-elevated py-1 shadow-elevated">
          {items.map((it) => (
            <button key={it.label} role="menuitem" onClick={() => { setOpen(false); it.onClick(); }}
              className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

/** "{N} Total | first | prev | page | next | last" — matches the live reference's own pagination
 * footer exactly, backed by a real COUNT from the reporting query (see `total` on ReportResult). */
export function Pagination({ total, page, pageSize, onPageChange }: { total: number; page: number; pageSize: number; onPageChange: (p: number) => void }) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const btn = 'grid h-7 w-7 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';
  return (
    <div className="flex items-center gap-3 text-tiny text-fg-secondary">
      <span>{total.toLocaleString()} Total</span>
      <div className="flex items-center gap-1">
        <button type="button" title="First page" disabled={page <= 1} onClick={() => onPageChange(1)} className={btn}><ChevronsLeft size={14} /></button>
        <button type="button" title="Previous page" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))} className={btn}><ChevronLeft size={14} /></button>
        <span className="px-1 text-fg">{page}</span>
        <button type="button" title="Next page" disabled={page >= lastPage} onClick={() => onPageChange(Math.min(lastPage, page + 1))} className={btn}><ChevronRight size={14} /></button>
        <button type="button" title="Last page" disabled={page >= lastPage} onClick={() => onPageChange(lastPage)} className={btn}><ChevronsRight size={14} /></button>
      </div>
    </div>
  );
}

export interface SavedReportConfig<OrderMetric extends string> {
  from: string; to: string; filters: FilterValues; exclusions: FilterValues; metricFilters: MetricFilters; ignoreFailTraffic: boolean;
  orderBy: OrderMetric; orderDir: 'asc' | 'desc'; hiddenColumns: string[];
}
/**
 * Saved presets live in localStorage and outlive code changes, so every field is shape-checked and
 * defaulted here — an old or hand-edited entry must never crash a report page on load.
 */
export function loadSavedReports<OrderMetric extends string>(key: string): { name: string; config: SavedReportConfig<OrderMetric> }[] {
  let raw: unknown;
  try { raw = JSON.parse(localStorage.getItem(`tracker.savedReports.${key}`) ?? '[]'); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out: { name: string; config: SavedReportConfig<OrderMetric> }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { name, config } = item as { name?: unknown; config?: Record<string, unknown> };
    if (typeof name !== 'string' || !config || typeof config !== 'object') continue;
    const str = (v: unknown, d: string) => (typeof v === 'string' && v ? v : d);
    out.push({
      name,
      config: {
        ...(config as object),
        from: str(config['from'], daysAgo(30)),
        to: str(config['to'], todayStr()),
        filters: cleanFilterValues(config['filters']),
        exclusions: cleanFilterValues(config['exclusions']),
        metricFilters: (config['metricFilters'] && typeof config['metricFilters'] === 'object' ? config['metricFilters'] : {}) as MetricFilters,
        ignoreFailTraffic: config['ignoreFailTraffic'] === true,
        // '' is kept: it's the Daily/Hourly default order (chronological), not a missing value.
        orderBy: (typeof config['orderBy'] === 'string' ? config['orderBy'] : 'clicks') as OrderMetric,
        orderDir: config['orderDir'] === 'asc' ? 'asc' : 'desc',
        hiddenColumns: Array.isArray(config['hiddenColumns']) ? (config['hiddenColumns'] as unknown[]).filter((c): c is string => typeof c === 'string') : [],
      },
    });
  }
  return out;
}
export function persistSavedReports<OrderMetric extends string>(key: string, list: { name: string; config: SavedReportConfig<OrderMetric> }[]): void {
  try { localStorage.setItem(`tracker.savedReports.${key}`, JSON.stringify(list)); } catch { /* best-effort */ }
}
