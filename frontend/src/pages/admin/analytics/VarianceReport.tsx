/**
 * Analytics › Variance — verified against the live reference (URL `/analytics/variance`, real data:
 * Current/Previous date pickers, Parent [required] * Child [optional] dimension pickers — same real
 * dimension universe already established for Dimensional/Flex/Dynamic Nested (Offer, Partner,
 * Advertiser, Smart Link, Country, Device, City, Region, ISP, OS, Browser, Sub1-5; the reference's
 * much longer flat list — Account/Sales/Partner Manager, Referred By, Carrier, Adv1-10, DMA, etc. —
 * has no backing anywhere in this schema, same omission already audited for those pages) — plus a
 * 21-tile Summary (Current value + variance vs Previous) and a Detailed Report where every one of the
 * 10 real metric columns (Impressions/Gross Clicks/Clicks/Conversions/Events/Revenue/Payout/Profit/
 * Gross Sales/Avg. Sale Value) gets its own Previous | Current | Variance triplet.
 *
 * This report needs no new backend endpoint: it's the same real `/api/reports` aggregation engine
 * already used by Flex/Dimensional/Dynamic Nested, called twice — once for the Current date range,
 * once for Previous — then diffed client-side. Real fields: Gross Clicks (`clicksGross`), Clicks (net
 * of fraud-flagged, `clicks`), Conversions (`totalCv`, all statuses — matches the reference's own
 * Detail "Conversions" column summing to its Summary "Total CV" tile), Revenue, Payout, Profit
 * (`margin`, revenue − payout). Impressions / Events / Gross Sales / Avg. Sale Value / VT CV / CTR /
 * Throttle / CPM / RPM / Media Buying Cost have no source anywhere in this app (no impression, event,
 * or e-commerce order tracking) — shown as "—" rather than a fabricated 0, matching the "—" convention
 * already established on every other report page (ReportPageKit.tsx).
 *
 * Money is in each period's own currency (`currencies` — lib/reportCurrency): a period whose
 * conversions mix currencies shows "Mixed" (the Summary's Payout/Revenue/Profit show per-currency
 * amounts), and a money variance is given only when both periods are in the same currency — "Mixed"
 * or "—" (different currencies) otherwise, never a cross-currency difference.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, MoreVertical, Search } from 'lucide-react';
import { useQuery } from '../../../lib/useApi';
import { uaDimensionLabel } from '../../../lib/userAgentDisplay';
import { api } from '../../../lib/api';
import { PageHeader, Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { type FilterCategory, type FilterValues } from '../../../shared-components/primitives/CategorizedFilters';
import { ApiRequestModal } from '../../../shared-components/primitives/TableActionsKit';
import {
  type AggResult, type AggRow, METRICS_PARAM, DASH, DEVICE_OPTIONS, money, pct, toIso, daysAgo, todayStr,
  deriveRow, type DerivedRow, Pagination,
  type MetricFilters, passesMetricFilters, reportingFiltersCount, ReportingFiltersFlyout,
  type ReportingFiltersValue, reportingChips, withoutReportingChip, EMPTY_REPORTING_FILTERS,
} from '../../../shared-components/primitives/ReportPageKit';
import { useReportOpts, type Opts } from '../Reports';
import { countryLabel } from '../../../data/geo';
import { ActiveFilterChips } from '../../../shared-components/primitives/ActiveFilterChips';
import { useAutoDateRange } from '../reportView';
import { ReportCard, ReportControls, DateRangeField, FiltersButton, ClearButton, ResultsBar, ReportBody } from '../../../shared-components/primitives/ReportLayout';
import { REPORT_CONTROL as CONTROL } from '../../../shared-components/primitives/reportControl';
import {
  combineCurrencies, combineMoneyByCurrency, comparePeriods, currenciesOf, hasMoneyFilter, MIXED_LABEL, mixedTitle, moneyByCurrencyOf,
  moneyFilterBlockedBy, moneyText, resolveCurrency, withBreakdownMetrics, withCurrenciesMetric,
  type MoneyByCurrency, type MoneyField, type MoneyText, type RowCurrency,
} from '../../../lib/reportCurrency';
import { CurrencyNotes, Money } from '../../../shared-components/primitives/ReportMoney';

interface SmartLink { id: string; name: string }

const DIM_OPTIONS = [
  { key: 'offer', label: 'Offer', filterParam: 'offerId' },
  { key: 'publisher', label: 'Partner', filterParam: 'publisherId' },
  { key: 'advertiser', label: 'Advertiser', filterParam: 'advertiserId' },
  { key: 'smartLink', label: 'Smart Link', filterParam: 'smartLinkId' },
  { key: 'country', label: 'Country', filterParam: 'country' },
  { key: 'device', label: 'Device', filterParam: 'device' },
  { key: 'city', label: 'City', filterParam: 'city' },
  { key: 'region', label: 'Region', filterParam: 'region' },
  { key: 'isp', label: 'ISP', filterParam: 'isp' },
  { key: 'os', label: 'OS', filterParam: 'os' },
  { key: 'browser', label: 'Browser', filterParam: 'browser' },
  { key: 'sub1', label: 'Sub1', filterParam: 'sub1' },
  { key: 'sub2', label: 'Sub2', filterParam: 'sub2' },
  { key: 'sub3', label: 'Sub3', filterParam: 'sub3' },
  { key: 'sub4', label: 'Sub4', filterParam: 'sub4' },
  { key: 'sub5', label: 'Sub5', filterParam: 'sub5' },
] as const;
type DimKey = (typeof DIM_OPTIONS)[number]['key'];

interface DetailMetricDef { key: string; label: string; real: boolean; get?: (d: DerivedRow) => number; money?: boolean }
const DETAIL_METRICS: DetailMetricDef[] = [
  { key: 'impressions', label: 'Impressions', real: false },
  { key: 'grossClicks', label: 'Gross Clicks', real: true, get: (d) => d.clicksGross },
  { key: 'clicks', label: 'Clicks', real: true, get: (d) => d.clicks },
  { key: 'conversions', label: 'Conversions', real: true, get: (d) => d.totalCv },
  { key: 'events', label: 'Events', real: false },
  { key: 'revenue', label: 'Revenue', real: true, get: (d) => d.revenue, money: true },
  { key: 'payout', label: 'Payout', real: true, get: (d) => d.payout, money: true },
  { key: 'profit', label: 'Profit', real: true, get: (d) => d.margin, money: true },
  { key: 'grossSales', label: 'Gross Sales', real: false, money: true },
  { key: 'avgSaleValue', label: 'Avg. Sale Value', real: false, money: true },
];

/** Previous → Current; money in each period's own currency ("Mixed" for a period mixing currencies). */
function VarianceValue({ prev, curr, isMoney, prevRc, curRc }: { prev: number; curr: number; isMoney?: boolean; prevRc: RowCurrency; curRc: RowCurrency }) {
  if (!isMoney) return <>{prev.toLocaleString()} → {curr.toLocaleString()}</>;
  return <><Money value={prev} rc={prevRc} /> → <Money value={curr} rc={curRc} /></>;
}

/**
 * Current vs Previous as % or a difference. A money variance needs both periods in one currency
 * (lib/reportCurrency comparePeriods) — otherwise "Mixed" / "—" with the reason on hover.
 */
function VarianceBadge({ prev, curr, mode, isMoney, prevRc, curRc }: { prev: number; curr: number; mode: 'pct' | 'num'; isMoney?: boolean; prevRc: RowCurrency; curRc: RowCurrency }) {
  let currency = curRc.kind === 'mixed' ? 'USD' : curRc.currency;
  if (isMoney) {
    const cmp = comparePeriods(prevRc, curRc);
    if (!cmp.ok) return <span className="text-fg-muted" title={cmp.reason}>{cmp.label}</span>;
    currency = cmp.currency;
  }
  if (prev === 0 && curr === 0) return <span className="text-fg-muted">-</span>;
  if (prev === 0) return <span className="text-success-text">New</span>;
  const diff = curr - prev;
  const pctVal = diff / prev;
  const positive = diff >= 0;
  const cls = positive ? 'text-success-text' : 'text-danger-text';
  const text = mode === 'num' ? `${positive ? '+' : ''}${isMoney ? money(diff, currency) : diff.toLocaleString()}` : `${positive ? '+' : ''}${(pctVal * 100).toFixed(2)}%`;
  return <span className={cls}>{text}</span>;
}

/** A Summary tile's Current value: money in the period's currency, a breakdown / "Mixed" when it mixes currencies. */
function summaryTileText(
  t: { format?: (v: number) => string; money?: MoneyField | 'ratio' | 'pct' }, v: number, rc: RowCurrency, breakdown: MoneyByCurrency | null,
): MoneyText {
  if (!t.money) return { text: t.format!(v), muted: false };
  if (t.money === 'pct') return rc.kind === 'mixed' ? { text: MIXED_LABEL, title: mixedTitle(rc.currencies), muted: true } : { text: pct(v), muted: false };
  return t.money === 'ratio' ? moneyText(v, rc) : moneyText(v, rc, { breakdown, field: t.money, roomy: true });
}

function resolveName(dim: DimKey, id: string | null, opts: Opts, smartLinkMap: Map<string, string>): string {
  if (id == null) return DASH;
  if (dim === 'offer') { const m = opts.offerMap.get(id); return m ? `${m.ref != null ? `(${m.ref}) ` : ''}${m.name}` : id.slice(0, 8) + '…'; }
  if (dim === 'publisher') { const m = opts.pubMap.get(id); return m ? `${m.ref != null ? `(${m.ref}) ` : ''}${m.name}` : id.slice(0, 8) + '…'; }
  if (dim === 'advertiser') { const m = opts.advMap.get(id); return m ? `${m.ref != null ? `(${m.ref}) ` : ''}${m.name}` : id.slice(0, 8) + '…'; }
  if (dim === 'smartLink') return smartLinkMap.get(id) ?? id.slice(0, 8) + '…';
  return uaDimensionLabel(dim, id);
}
function linkFor(dim: DimKey, id: string): string | null {
  if (dim === 'offer') return `/app/offers/${id}`;
  if (dim === 'publisher') return `/app/publishers/${id}`;
  if (dim === 'advertiser') return `/app/advertisers/${id}`;
  if (dim === 'smartLink') return `/app/smart-links/${id}`;
  return null;
}

/** `curRc` / `prevRc`: each period's money currency (lib/reportCurrency) — none when it had no activity. */
interface VarianceRow { raw: string; name: string; current: DerivedRow; previous: DerivedRow; curRc: RowCurrency; prevRc: RowCurrency }
type PeriodPair = Omit<VarianceRow, 'name'>;

/**
 * Set a report filter param to `values`. Uuid params (`…Id`) are comma lists. Text values may contain
 * commas ("Comcast Cable, LLC") and the API splits a plain comma list, so when any value has a comma
 * every value is sent as a repeated `key[]=value` param, which the API takes literally (the `[]` form
 * also keeps a single comma-bearing value intact — a lone `key=v` would still be split). Comma-free
 * text values go as one comma list, which the API reads identically and which has no repeat-count limit.
 */
function setFilterValues(params: URLSearchParams, key: string, values: string[]) {
  params.delete(key); params.delete(`${key}[]`);
  if (!values.length) return;
  if (/Id$/.test(key) || !values.some((v) => v.includes(','))) params.set(key, values.join(','));
  else for (const v of values) params.append(`${key}[]`, v);
}

function buildQs(extra: Record<string, string | number | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
  return params;
}

/** Current-period rows (the page) joined to their previous-period values; absent there ⇒ genuinely 0. */
function joinPrevious(currentRows: AggRow[], previousRows: AggRow[], dim: DimKey, currency: string): PeriodPair[] {
  const empty = deriveRow({});
  const none: RowCurrency = { kind: 'none', currency };
  const prev = new Map<string, { d: DerivedRow; rc: RowCurrency }>();
  for (const r of previousRows) { const id = r.dimensions[dim]; if (id) prev.set(id, { d: deriveRow(r.metrics), rc: resolveCurrency(currenciesOf(r.metrics), currency) }); }
  return currentRows
    .filter((r) => r.dimensions[dim])
    .map((r) => {
      const raw = r.dimensions[dim]!; const p = prev.get(raw);
      return { raw, current: deriveRow(r.metrics), curRc: resolveCurrency(currenciesOf(r.metrics), currency), previous: p?.d ?? empty, prevRc: p?.rc ?? none };
    });
}

function mergeRows(currentRows: { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }[],
  previousRows: { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }[], dim: DimKey, currency: string): PeriodPair[] {
  const empty = deriveRow({});
  const none: RowCurrency = { kind: 'none', currency };
  const byId = new Map<string, Omit<PeriodPair, 'raw'>>();
  for (const r of currentRows) {
    const id = r.dimensions[dim];
    if (!id) continue;
    byId.set(id, { current: deriveRow(r.metrics), curRc: resolveCurrency(currenciesOf(r.metrics), currency), previous: empty, prevRc: none });
  }
  for (const r of previousRows) {
    const id = r.dimensions[dim];
    if (!id) continue;
    const existing = byId.get(id);
    const rc = resolveCurrency(currenciesOf(r.metrics), currency);
    if (existing) { existing.previous = deriveRow(r.metrics); existing.prevRc = rc; }
    else byId.set(id, { current: empty, curRc: none, previous: deriveRow(r.metrics), prevRc: rc });
  }
  return [...byId.entries()].map(([raw, v]) => ({ raw, ...v }));
}

function SingleSelectDropdown({ label, value, onChange, allowNone }: { label: string; value: DimKey | null; onChange: (k: DimKey | null) => void; allowNone?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative w-full sm:w-44">
      <label className="label">{label} {!allowNone && <span className="text-danger-text">*</span>}</label>
      <button type="button" onClick={() => setOpen((o) => !o)} className={`input flex items-center justify-between text-left ${CONTROL}`}>
        {value ? DIM_OPTIONS.find((d) => d.key === value)?.label : 'None'} <ChevronDown size={13} className="text-fg-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-48 overflow-y-auto rounded-card border border-border bg-elevated py-1 shadow-elevated">
            {allowNone && (
              <button onClick={() => { onChange(null); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-small hover:bg-accent-subtle ${value === null ? 'text-accent-text' : 'text-fg'}`}>
                {value === null && '✓'} None
              </button>
            )}
            {DIM_OPTIONS.map((d) => (
              <button key={d.key} onClick={() => { onChange(d.key); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-small hover:bg-accent-subtle ${d.key === value ? 'text-accent-text' : 'text-fg'}`}>
                {d.key === value && '✓'} {d.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ExpandedChildRows({
  childDim, parentFilterParam, parentRawId, currentFrom, currentTo, previousFrom, previousTo, dimParams, mode, opts, smartLinkMap, currency,
}: {
  childDim: DimKey; parentFilterParam: string; parentRawId: string; currentFrom: string; currentTo: string; previousFrom: string; previousTo: string;
  dimParams: Record<string, string | number | undefined>; mode: 'pct' | 'num'; opts: Opts; smartLinkMap: Map<string, string>; currency: string;
}) {
  // The page's filters narrowed to this parent; the parent value replaces a page filter on the same
  // dimension, and a text parent value goes as a literal `key[]=value` (never comma-split).
  const qs = (from: string, to: string) => {
    const params = buildQs({ ...dimParams, groupBy: childDim, metrics: withCurrenciesMetric(METRICS_PARAM), limit: 200, from: toIso(from), to: toIso(to, true) });
    setFilterValues(params, parentFilterParam, []);
    if (/Id$/.test(parentFilterParam)) params.set(parentFilterParam, parentRawId);
    else params.append(`${parentFilterParam}[]`, parentRawId);
    return params.toString();
  };
  const { data: curData, loading: curLoading, error: curError } = useQuery<AggResult>(`/api/reports?${qs(currentFrom, currentTo)}`);
  const { data: prevData, loading: prevLoading, error: prevError } = useQuery<AggResult>(`/api/reports?${qs(previousFrom, previousTo)}`);

  const rows = useMemo(() => mergeRows(curData?.rows ?? [], prevData?.rows ?? [], childDim, currency)
    .map((r) => ({ ...r, name: resolveName(childDim, r.raw, opts, smartLinkMap) }))
    .sort((a, b) => b.current.clicksGross - a.current.clicksGross),
  [curData, prevData, childDim, opts, smartLinkMap, currency]);

  const colCount = 1 + DETAIL_METRICS.length * 3;
  if (curLoading || prevLoading) return <tr><td colSpan={colCount} className="px-4 py-3 text-center"><Spinner /></td></tr>;
  if (curError || prevError) return <tr><td colSpan={colCount} className="px-4 py-3 text-small text-danger-text">{curError ?? prevError}</td></tr>;
  if (!rows.length) return <tr><td colSpan={colCount} className="px-4 py-3 text-small text-fg-muted">No activity for this period.</td></tr>;
  return (
    <>
      {rows.map((r) => (
        <tr key={r.raw} className="bg-page/60 text-small text-fg-secondary">
          <td className="py-2 pl-10 pr-4">{r.name}</td>
          {DETAIL_METRICS.map((m) => {
            if (!m.real) return (
              <td key={m.key} colSpan={3} className="px-4 py-2 text-center text-fg-muted">{DASH}</td>
            );
            const curr = m.get!(r.current); const prev = m.get!(r.previous);
            return (
              <td key={m.key} colSpan={3} className="px-4 py-2 text-right">
                <span className="mr-3 text-fg-muted"><VarianceValue prev={prev} curr={curr} isMoney={m.money} prevRc={r.prevRc} curRc={r.curRc} /></span>
                <VarianceBadge prev={prev} curr={curr} mode={mode} isMoney={m.money} prevRc={r.prevRc} curRc={r.curRc} />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

export default function VarianceReport() {
  const opts = useReportOpts();
  const smartLinkMap = useMemo(() => new Map(opts.smartLinks?.map((s: { value: string; label: string }) => [s.value, s.label]) ?? []), [opts.smartLinks]);

  // No "Run Report": both ranges apply on their own once valid (debounced, see useAutoDateRange) and
  // every other control applies immediately. The table pages with the Current range's hook, so a new
  // Current range lands on page 1 in the same render (one request).
  const current = useAutoDateRange(todayStr(), todayStr());
  const previous = useAutoDateRange(daysAgo(1), daysAgo(1));
  const { page, setPage, toFirstPage } = current;
  const [parentDim, setParentDim] = useState<DimKey>('publisher');
  const [childDim, setChildDim] = useState<DimKey | null>(null);
  const [filters, setFilters] = useState<FilterValues>({});
  const [exclusions, setExclusions] = useState<FilterValues>({});
  const [metricFilters, setMetricFilters] = useState<MetricFilters>({});
  const [ignoreFailTraffic, setIgnoreFailTraffic] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'pct' | 'num'>('pct');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showApiRequest, setShowApiRequest] = useState(false);
  const pageSize = 20;

  // The Previous range the report uses. The Previous hook has no say over the table's page, so when it
  // commits a new range the page goes back to 1 (and expanded rows collapse) right here, during render
  // — React re-renders before committing, so no request is ever made for the new range on the old page.
  const [previousRange, setPreviousRange] = useState({ from: previous.appliedFrom, to: previous.appliedTo });
  if (previousRange.from !== previous.appliedFrom || previousRange.to !== previous.appliedTo) {
    setPreviousRange({ from: previous.appliedFrom, to: previous.appliedTo });
    toFirstPage(); setExpanded(new Set());
  }
  // A new Current range is already on page 1 (its hook); collapse expanded rows the same way.
  const currentKey = `${current.appliedFrom}|${current.appliedTo}`;
  const [seenCurrentKey, setSeenCurrentKey] = useState(currentKey);
  if (seenCurrentKey !== currentKey) { setSeenCurrentKey(currentKey); setExpanded(new Set()); }
  const currentFrom = current.appliedFrom; const currentTo = current.appliedTo;
  const previousFrom = previousRange.from; const previousTo = previousRange.to;

  // Periods without money-bearing conversions (and older APIs) format in the network's default currency.
  const { data: settings } = useQuery<{ general?: { defaultCurrency?: string } }>('/api/settings');
  const currency = settings?.general?.defaultCurrency ?? 'USD';
  const { data: offers } = useQuery<{ id: string; name: string }[]>('/api/offers');
  const { data: publishers } = useQuery<{ id: string; name: string }[]>('/api/publishers');
  const { data: advertisers } = useQuery<{ id: string; name: string }[]>('/api/advertisers');
  const { data: smartLinksList } = useQuery<SmartLink[]>('/api/smart-links');
  const { data: countryAgg } = useQuery<AggResult>('/api/reports?groupBy=country&metrics=clicks&limit=200');
  const countryOptions = useMemo(() => (countryAgg?.rows ?? [])
    .map((r) => r.dimensions['country']).filter((c): c is string => Boolean(c)).sort()
    .map((c) => ({ value: c, label: countryLabel(c) })).sort((a, b) => a.label.localeCompare(b.label)), [countryAgg]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'advertiser', label: 'Advertiser', options: (advertisers ?? []).map((a) => ({ value: a.id, label: a.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
    { key: 'smartLink', label: 'Smart Link', options: (smartLinksList ?? []).map((s) => ({ value: s.id, label: s.name })) },
    { key: 'country', label: 'Country', options: countryOptions },
    { key: 'device', label: 'Device', options: DEVICE_OPTIONS },
  ], [offers, advertisers, publishers, smartLinksList, countryOptions]);

  const excludeOfferId = exclusions['offer']?.join(',');
  const excludeAdvertiserId = exclusions['advertiser']?.join(',');
  const excludePublisherId = exclusions['partner']?.join(',');
  const excludeSmartLinkId = exclusions['smartLink']?.join(',');
  const excludeCountry = exclusions['country']?.join(',');
  const excludeDevice = exclusions['device']?.join(',');
  const dimParams = {
    offerId: filters['offer']?.join(','), advertiserId: filters['advertiser']?.join(','),
    publisherId: filters['partner']?.join(','), smartLinkId: filters['smartLink']?.join(','),
    country: filters['country']?.join(','), device: filters['device']?.join(','),
    excludeOfferId, excludeAdvertiserId, excludePublisherId, excludeSmartLinkId, excludeCountry, excludeDevice,
    excludeInvalid: ignoreFailTraffic ? 1 : undefined,
  };

  const qs = (extra: Record<string, string | number | undefined>) => buildQs(extra).toString();

  // Summary: one exact grand-total row per period (groupBy=none), not a sum of a truncated grouping.
  const curSummaryQs = qs({ groupBy: 'none', metrics: withBreakdownMetrics(METRICS_PARAM), from: toIso(currentFrom), to: toIso(currentTo, true), ...dimParams });
  const prevSummaryQs = qs({ groupBy: 'none', metrics: withBreakdownMetrics(METRICS_PARAM), from: toIso(previousFrom), to: toIso(previousTo, true), ...dimParams });
  const { data: curSummaryData, loading: curSummaryLoading, error: curSummaryError } = useQuery<AggResult>(`/api/reports?${curSummaryQs}`);
  const { data: prevSummaryData, loading: prevSummaryLoading, error: prevSummaryError } = useQuery<AggResult>(`/api/reports?${prevSummaryQs}`);
  const summaryLoading = curSummaryLoading || prevSummaryLoading;
  const summaryError = curSummaryError ?? prevSummaryError;

  // Table: the Current period is paged server-side; the Previous period is then fetched filtered to
  // exactly this page's groups, so every row gets its true previous value (a group missing from the
  // Previous result had no activity there — a real 0, not a top-N truncation artefact). Page size
  // stays ≤ 20: comma-bearing text keys go as repeated `key[]` params, which the API caps at 20.
  const curTableQs = qs({
    groupBy: parentDim, metrics: withCurrenciesMetric(METRICS_PARAM), from: toIso(currentFrom), to: toIso(currentTo, true), ...dimParams,
    orderBy: 'clicks', orderDir: 'desc', limit: pageSize, offset: (page - 1) * pageSize,
  });
  const { data: curData, loading: curLoading, error: curError } = useQuery<AggResult>(`/api/reports?${curTableQs}`);
  // useQuery keeps the last response while the next one loads (its `loading` flips one render late)
  // and after a failed request, so tag `curData` with the query it answers and build on it only while
  // that is the current query — e.g. a new Previous range on page 1 must not first fetch Previous
  // values for the old page's groups.
  const [curDataTag, setCurDataTag] = useState<{ data: AggResult | null; qs: string }>({ data: null, qs: '' });
  if (curDataTag.data !== curData) setCurDataTag({ data: curData, qs: curTableQs });
  const curFresh = curDataTag.data === curData && curDataTag.qs === curTableQs && !curLoading && !curError;
  const pageKeys = useMemo(() => (curFresh ? Array.from(new Set((curData?.rows ?? []).map((r) => r.dimensions[parentDim]).filter((v): v is string => Boolean(v)))) : []),
    [curFresh, curData, parentDim]);
  const prevTableQs = useMemo(() => {
    if (!pageKeys.length) return null;
    const params = buildQs({ groupBy: parentDim, metrics: withCurrenciesMetric(METRICS_PARAM), from: toIso(previousFrom), to: toIso(previousTo, true), ...dimParams, limit: pageKeys.length });
    setFilterValues(params, DIM_OPTIONS.find((o) => o.key === parentDim)!.filterParam, pageKeys);
    return params.toString();
  // dimParams is rebuilt each render; its content is fully determined by the filter state below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKeys, parentDim, previousFrom, previousTo, filters, exclusions, ignoreFailTraffic]);
  // Fetched by hand (not useQuery) so the result is tagged with the query it answers — a previous
  // page's Previous-period data must never be joined to the new page's rows, even for one render.
  const [prevState, setPrevState] = useState<{ qs: string; data: AggResult | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!prevTableQs) return;
    let alive = true;
    api.get<AggResult>(`/api/reports?${prevTableQs}`)
      .then((d) => { if (alive) setPrevState({ qs: prevTableQs, data: d, error: null }); })
      .catch((e: unknown) => { if (alive) setPrevState({ qs: prevTableQs, data: null, error: e instanceof Error ? e.message : 'Request failed' }); });
    return () => { alive = false; };
  }, [prevTableQs]);
  const prevReady = !prevTableQs || prevState?.qs === prevTableQs;
  const prevLoading = !prevReady;
  const prevData = prevTableQs && prevReady ? prevState?.data ?? null : null;
  const prevError = prevTableQs && prevReady ? prevState?.error ?? null : null;

  const loadedRows = useMemo((): VarianceRow[] => (!curFresh || !prevReady ? [] : joinPrevious(curData?.rows ?? [], prevData?.rows ?? [], parentDim, currency))
    .map((r) => ({ ...r, name: resolveName(parentDim, r.raw, opts, smartLinkMap) })),
  [curFresh, curData, prevReady, prevData, parentDim, opts, smartLinkMap, currency]);
  // Metric filters test the Current values; a Payout/Revenue threshold has no currency, so it is not
  // applied while the loaded rows' Current money spans several currencies (and the page says so).
  const moneyBlocked = useMemo(() => moneyFilterBlockedBy(loadedRows.map((r) => r.curRc)), [loadedRows]);
  const rows = useMemo(() => loadedRows
    .filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()))
    .filter((r) => passesMetricFilters(r.current, metricFilters, !!moneyBlocked)),
  [loadedRows, q, metricFilters, moneyBlocked]);

  const summary = useMemo(() => {
    const cur = curSummaryData?.rows?.[0]?.metrics ?? {};
    const prev = prevSummaryData?.rows?.[0]?.metrics ?? {};
    const current = deriveRow(cur); const previous = deriveRow(prev);
    if (current.clicksGross === 0 && current.totalCv === 0 && previous.clicksGross === 0 && previous.totalCv === 0) return null;
    // Each period's money currency, and the Current period's per-currency amounts (newer API).
    const curRc = combineCurrencies((curSummaryData?.rows ?? []).map((r) => currenciesOf(r.metrics)), currency);
    const prevRc = combineCurrencies((prevSummaryData?.rows ?? []).map((r) => currenciesOf(r.metrics)), currency);
    const breakdown = combineMoneyByCurrency((curSummaryData?.rows ?? []).map((r) => moneyByCurrencyOf(r.metrics)));
    return { current, previous, curRc, prevRc, breakdown };
  }, [curSummaryData, prevSummaryData, currency]);

  // Every applied change below returns to page 1 and collapses expanded rows (as Run Report did).
  const changePage = (p: number) => { setPage(p); setExpanded(new Set()); };
  const changeParent = (k: DimKey) => { setParentDim(k); toFirstPage(); setExpanded(new Set()); };
  const changeChild = (k: DimKey | null) => { setChildDim(k); toFirstPage(); setExpanded(new Set()); };
  // Both ranges, dimensions and every Reporting Filter reset in one render → one request per query.
  // The debounced ranges catch up to the same values later and are then a no-op.
  const clearAll = () => {
    current.reset({ from: todayStr(), to: todayStr() });
    previous.reset({ from: daysAgo(1), to: daysAgo(1) });
    setParentDim('publisher'); setChildDim(null);
    setFilters({}); setExclusions({}); setMetricFilters({}); setIgnoreFailTraffic(false);
    setExpanded(new Set());
  };
  // Flyout Apply, chip removal and the chips' "Clear all" change exactly what the requests and the
  // table use, at once.
  const reporting: ReportingFiltersValue = { filters, exclusions, metricFilters, ignoreFailTraffic };
  const setReporting = (v: ReportingFiltersValue) => {
    setFilters(v.filters); setExclusions(v.exclusions); setMetricFilters(v.metricFilters); setIgnoreFailTraffic(v.ignoreFailTraffic);
    toFirstPage(); setExpanded(new Set());
  };
  const toggleExpand = (raw: string) => setExpanded((s) => { const n = new Set(s); if (n.has(raw)) n.delete(raw); else n.add(raw); return n; });
  const problem = [current.problem && `Current: ${current.problem}`, previous.problem && `Previous: ${previous.problem}`].filter(Boolean).join(' ') || null;

  // `money`: the tile is money (a field — Payout/Revenue/Profit get a per-currency breakdown when
  // mixed), a money ratio (CPC/CPA/RPC/RPA — "Mixed"), or Margin % ('pct' — "Mixed" too).
  const SUMMARY_TILES: { key: string; label: string; real: boolean; get?: (d: DerivedRow) => number; format?: (v: number) => string; money?: MoneyField | 'ratio' | 'pct' }[] = [
    { key: 'mbc', label: 'Media Buying Cost', real: false },
    { key: 'imp', label: 'Impression', real: false },
    { key: 'grossClicks', label: 'Gross Clicks', real: true, get: (d) => d.clicksGross, format: (v) => v.toLocaleString() },
    { key: 'clicks', label: 'Clicks', real: true, get: (d) => d.clicks, format: (v) => v.toLocaleString() },
    { key: 'totalCv', label: 'Total CV', real: true, get: (d) => d.totalCv, format: (v) => v.toLocaleString() },
    { key: 'vtCv', label: 'VT CV', real: false },
    { key: 'ctr', label: 'CTR', real: false },
    { key: 'event', label: 'Event', real: false },
    { key: 'cvr', label: 'CVR', real: true, get: (d) => d.cvr, format: pct },
    { key: 'cpc', label: 'CPC', real: true, get: (d) => d.cpc, money: 'ratio' },
    { key: 'cpa', label: 'CPA', real: true, get: (d) => d.cpa, money: 'ratio' },
    { key: 'rpc', label: 'RPC', real: true, get: (d) => d.rpc, money: 'ratio' },
    { key: 'cpm', label: 'CPM', real: false },
    { key: 'rpm', label: 'RPM', real: false },
    { key: 'rpa', label: 'RPA', real: true, get: (d) => d.rpa, money: 'ratio' },
    { key: 'payout', label: 'Payout', real: true, get: (d) => d.payout, money: 'payout' },
    { key: 'revenue', label: 'Revenue', real: true, get: (d) => d.revenue, money: 'revenue' },
    { key: 'profit', label: 'Profit', real: true, get: (d) => d.margin, money: 'margin' },
    { key: 'margin', label: 'Margin', real: true, get: (d) => d.marginPct, money: 'pct' },
    { key: 'avgSale', label: 'Avg. Sale Value', real: false },
    { key: 'grossSales', label: 'Gross Sales', real: false },
  ];

  // `!curFresh` (not just `curLoading`): also covers the render before useQuery flags the new request.
  const loading = (!curFresh && !curError) || prevLoading;

  return (
    <>
      <PageHeader title="Variance Report" subtitle="Analytics › Variance" />

      <ReportCard className="mb-4">
        <ReportControls problem={problem} actions={<>
          <ClearButton onClick={clearAll} title="Reset dates, dimensions and filters" />
          <FiltersButton count={reportingFiltersCount(reporting)} onClick={() => setFilterOpen((o) => !o)}>
            {filterOpen && (
              <ReportingFiltersFlyout
                moneyFilterBlockedBy={moneyBlocked}
                dimCategories={FILTER_CATEGORIES}
                value={reporting}
                onApply={setReporting}
                onClose={() => setFilterOpen(false)}
              />
            )}
          </FiltersButton>
          <button type="button" title="Page Actions" aria-label="Show API Request" onClick={() => setShowApiRequest(true)}
            className="grid h-10 w-10 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <MoreVertical size={15} />
          </button>
        </>}>
          <DateRangeField idPrefix="variance-current" label="Current (UTC)" from={current.from} to={current.to} max={todayStr()}
            invalid={current.problem !== null} onFrom={current.setFrom} onTo={current.setTo} />
          <DateRangeField idPrefix="variance-previous" label="Previous (UTC)" from={previous.from} to={previous.to} max={todayStr()}
            invalid={previous.problem !== null} onFrom={previous.setFrom} onTo={previous.setTo} />
          <SingleSelectDropdown label="Parent" value={parentDim} onChange={(k) => { if (k) changeParent(k); }} />
          <SingleSelectDropdown label="Child" value={childDim} onChange={changeChild} allowNone />
        </ReportControls>

        <div className="border-t border-border px-5 py-4 sm:px-6">
          <button type="button" onClick={() => setSummaryOpen((o) => !o)} className="flex w-full items-center gap-2 text-small font-medium text-fg">
            <ChevronDown size={14} className={`transition-transform ${summaryOpen ? '' : '-rotate-90'}`} /> Summary
          </button>
          {summaryOpen && (
            summaryLoading ? <div className="pt-4"><Spinner /></div> : summaryError ? <p className="pt-3 text-small text-danger-text">{summaryError}</p> : !summary ? <p className="pt-3 text-small text-fg-muted">No data for this period.</p> : (
              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 md:grid-cols-5">
                {SUMMARY_TILES.map((t) => {
                  const curr = t.real && t.get ? t.get(summary.current) : 0;
                  const prev = t.real && t.get ? t.get(summary.previous) : 0;
                  const shown = t.real ? summaryTileText(t, curr, summary.curRc, summary.breakdown) : null;
                  const compact = !!shown && !shown.muted && summary.curRc.kind === 'mixed';
                  return (
                    <div key={t.key}>
                      <p className="text-tiny uppercase tracking-wide text-fg-muted">{t.label}</p>
                      {!shown ? <p className="mt-1 text-h3 font-medium text-fg-muted">{DASH}</p> : (
                        <>
                          <p className={`mt-1 ${compact ? 'break-words text-body' : 'text-h3'} font-medium ${shown.muted ? 'text-fg-muted' : 'text-fg'}`} title={shown.title}>{shown.text}</p>
                          <p className="text-tiny"><VarianceBadge prev={prev} curr={curr} mode="pct" isMoney={!!t.money} prevRc={summary.prevRc} curRc={summary.curRc} /></p>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      </ReportCard>

      <ReportCard>
        <ResultsBar position="top" title="Detailed Report" loading={loading} actions={<>
          <div className="flex h-10 overflow-hidden rounded-[var(--radius)] border border-border" role="group" aria-label="Variance as">
            <button type="button" onClick={() => setMode('pct')} title="Variance as %" className={`px-3 text-tiny font-medium ${mode === 'pct' ? 'bg-accent text-white' : 'bg-surface text-fg-secondary hover:bg-accent-subtle'}`}>%</button>
            <button type="button" onClick={() => setMode('num')} title="Variance as a number" className={`px-3 text-tiny font-medium ${mode === 'num' ? 'bg-accent text-white' : 'bg-surface text-fg-secondary hover:bg-accent-subtle'}`}>#</button>
          </div>
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className={`input ${CONTROL} !pl-8 sm:!w-56`} placeholder="Search this page…" title="Filters only the rows on the current page"
              aria-label="Search this page" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </>}>
          <CurrencyNotes moneyFilterBlockedBy={moneyBlocked} moneyFilterActive={hasMoneyFilter(metricFilters)} />
          <ActiveFilterChips
            chips={reportingChips(FILTER_CATEGORIES, reporting)}
            onRemove={(c) => setReporting(withoutReportingChip(reporting, c))}
            onClearAll={() => setReporting(EMPTY_REPORTING_FILTERS)} />
        </ResultsBar>

        <ReportBody>
        <p className="mb-3 text-tiny text-fg-muted">Groups with activity in the Current period, compared with their Previous-period values.</p>
        {loading ? <StateBlock><Spinner /></StateBlock>
          : curError ? <StateBlock>{curError}</StateBlock>
          : prevError ? <StateBlock>{prevError}</StateBlock>
          : !rows.length ? <StateBlock>No Record Found</StateBlock>
          : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th rowSpan={2} className="align-bottom font-semibold">{DIM_OPTIONS.find((o) => o.key === parentDim)?.label}</th>
                    {DETAIL_METRICS.map((m) => <th key={m.key} colSpan={3} className="whitespace-nowrap px-4 py-2 text-center font-semibold">{m.label}</th>)}
                  </tr>
                  <tr>
                    {DETAIL_METRICS.map((m) => (
                      <Fragment key={m.key}>
                        <th className="whitespace-nowrap px-4 py-2 text-right font-medium">Previous</th>
                        <th className="whitespace-nowrap px-4 py-2 text-right font-medium">Current</th>
                        <th className="whitespace-nowrap px-4 py-2 text-right font-medium">Variance</th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Fragment key={r.raw}>
                      <tr>
                        <td >
                          <span className="flex items-center gap-1.5">
                            {childDim && (
                              <button type="button" onClick={() => toggleExpand(r.raw)} className="text-fg-muted hover:text-fg">
                                {expanded.has(r.raw) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              </button>
                            )}
                            {linkFor(parentDim, r.raw) ? <Link to={linkFor(parentDim, r.raw)!} className="text-accent-text hover:underline">{r.name}</Link> : r.name}
                          </span>
                        </td>
                        {DETAIL_METRICS.map((m) => {
                          if (!m.real) return (
                            <td key={m.key} colSpan={3} className="px-4 py-3 text-center text-fg-muted">{DASH}</td>
                          );
                          const curr = m.get!(r.current); const prev = m.get!(r.previous);
                          return (
                            <Fragment key={m.key}>
                              <td className="px-4 py-3 text-right text-fg-secondary">{m.money ? <Money value={prev} rc={r.prevRc} /> : prev.toLocaleString()}</td>
                              <td className="px-4 py-3 text-right">{m.money ? <Money value={curr} rc={r.curRc} /> : curr.toLocaleString()}</td>
                              <td className="px-4 py-3 text-right"><VarianceBadge prev={prev} curr={curr} mode={mode} isMoney={m.money} prevRc={r.prevRc} curRc={r.curRc} /></td>
                            </Fragment>
                          );
                        })}
                      </tr>
                      {childDim && expanded.has(r.raw) && (
                        <ExpandedChildRows
                          childDim={childDim}
                          parentFilterParam={DIM_OPTIONS.find((o) => o.key === parentDim)!.filterParam}
                          parentRawId={r.raw}
                          currentFrom={currentFrom} currentTo={currentTo}
                          previousFrom={previousFrom} previousTo={previousTo}
                          dimParams={dimParams} mode={mode} opts={opts} smartLinkMap={smartLinkMap} currency={currency}
                        />
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        <div className="mt-3 flex justify-end">
          {/* A failed request keeps the previous `data` in useQuery — never show its total as current. */}
          <Pagination total={curError ? 0 : (curData?.total ?? 0)} page={page} pageSize={pageSize} onPageChange={changePage} />
        </div>
        </ReportBody>
      </ReportCard>

      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports?${curTableQs}`} appliedFilters={{
        currentFrom, currentTo, previousFrom, previousTo,
        parent: parentDim, child: childDim ?? undefined,
        offer: dimParams.offerId, advertiser: dimParams.advertiserId, partner: dimParams.publisherId, smartLink: dimParams.smartLinkId, country: dimParams.country, device: dimParams.device,
        excludeOffer: excludeOfferId, excludeAdvertiser: excludeAdvertiserId, excludePartner: excludePublisherId, excludeSmartLink: excludeSmartLinkId, excludeCountry, excludeDevice,
        ignoreFailTraffic: ignoreFailTraffic ? 'true' : undefined,
      }} />}
    </>
  );
}
