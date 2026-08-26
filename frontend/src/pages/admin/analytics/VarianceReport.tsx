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
 */
import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, MoreVertical, Search } from 'lucide-react';
import { useQuery } from '../../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../../components/ui';
import { FilterButton, type FilterCategory, type FilterValues } from '../../../components/CategorizedFilters';
import { ApiRequestModal } from '../../../components/TableActionsKit';
import {
  type AggResult, METRICS_PARAM, DASH, DEVICES, money, pct, toIso, daysAgo, todayStr,
  deriveRow, type DerivedRow,
  type MetricFilters, passesMetricFilters, reportingFiltersCount, ReportingFiltersFlyout,
} from '../../../components/ReportPageKit';
import { useReportOpts, type Opts } from '../Reports';

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

function fmtNum(v: number, isMoney?: boolean) { return isMoney ? money(v) : v.toLocaleString(); }

function VarianceValue({ prev, curr, isMoney }: { prev: number; curr: number; isMoney?: boolean }) {
  return <>{fmtNum(prev, isMoney)} → {fmtNum(curr, isMoney)}</>;
}

function VarianceBadge({ prev, curr, mode, isMoney }: { prev: number; curr: number; mode: 'pct' | 'num'; isMoney?: boolean }) {
  if (prev === 0 && curr === 0) return <span className="text-fg-muted">-</span>;
  if (prev === 0) return <span className="text-success-text">New</span>;
  const diff = curr - prev;
  const pctVal = diff / prev;
  const positive = diff >= 0;
  const cls = positive ? 'text-success-text' : 'text-danger-text';
  const text = mode === 'num' ? `${positive ? '+' : ''}${fmtNum(diff, isMoney)}` : `${positive ? '+' : ''}${(pctVal * 100).toFixed(2)}%`;
  return <span className={cls}>{text}</span>;
}

function resolveName(dim: DimKey, id: string | null, opts: Opts, smartLinkMap: Map<string, string>): string {
  if (id == null) return DASH;
  if (dim === 'offer') { const m = opts.offerMap.get(id); return m ? `${m.ref != null ? `(${m.ref}) ` : ''}${m.name}` : id.slice(0, 8) + '…'; }
  if (dim === 'publisher') { const m = opts.pubMap.get(id); return m ? `${m.ref != null ? `(${m.ref}) ` : ''}${m.name}` : id.slice(0, 8) + '…'; }
  if (dim === 'advertiser') { const m = opts.advMap.get(id); return m ? `${m.ref != null ? `(${m.ref}) ` : ''}${m.name}` : id.slice(0, 8) + '…'; }
  if (dim === 'smartLink') return smartLinkMap.get(id) ?? id.slice(0, 8) + '…';
  return id;
}
function linkFor(dim: DimKey, id: string): string | null {
  if (dim === 'offer') return `/app/offers/${id}`;
  if (dim === 'publisher') return `/app/publishers/${id}`;
  if (dim === 'advertiser') return `/app/advertisers/${id}`;
  if (dim === 'smartLink') return `/app/smart-links/${id}`;
  return null;
}

interface VarianceRow { raw: string; name: string; current: DerivedRow; previous: DerivedRow }

function mergeRows(currentRows: { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }[],
  previousRows: { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }[], dim: DimKey): { raw: string; current: DerivedRow; previous: DerivedRow }[] {
  const empty = deriveRow({});
  const byId = new Map<string, { current: DerivedRow; previous: DerivedRow }>();
  for (const r of currentRows) {
    const id = r.dimensions[dim];
    if (!id) continue;
    byId.set(id, { current: deriveRow(r.metrics), previous: empty });
  }
  for (const r of previousRows) {
    const id = r.dimensions[dim];
    if (!id) continue;
    const existing = byId.get(id);
    if (existing) existing.previous = deriveRow(r.metrics);
    else byId.set(id, { current: empty, previous: deriveRow(r.metrics) });
  }
  return [...byId.entries()].map(([raw, v]) => ({ raw, ...v }));
}

function SingleSelectDropdown({ label, value, onChange, allowNone }: { label: string; value: DimKey | null; onChange: (k: DimKey | null) => void; allowNone?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <label className="label mb-1 block">{label} {!allowNone && <span className="text-danger-text">*</span>}</label>
      <button type="button" onClick={() => setOpen((o) => !o)} className="input flex items-center justify-between !py-2 text-left">
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
  childDim, parentFilterParam, parentRawId, currentFrom, currentTo, previousFrom, previousTo, dimParams, mode, opts, smartLinkMap,
}: {
  childDim: DimKey; parentFilterParam: string; parentRawId: string; currentFrom: string; currentTo: string; previousFrom: string; previousTo: string;
  dimParams: Record<string, string | number | undefined>; mode: 'pct' | 'num'; opts: Opts; smartLinkMap: Map<string, string>;
}) {
  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };
  const base = { groupBy: childDim, metrics: METRICS_PARAM, limit: 200, ...dimParams, [parentFilterParam]: parentRawId };
  const curQs = qs({ ...base, from: toIso(currentFrom), to: toIso(currentTo, true) });
  const prevQs = qs({ ...base, from: toIso(previousFrom), to: toIso(previousTo, true) });
  const { data: curData, loading: curLoading } = useQuery<AggResult>(`/api/reports?${curQs}`);
  const { data: prevData, loading: prevLoading } = useQuery<AggResult>(`/api/reports?${prevQs}`);

  const rows = useMemo(() => mergeRows(curData?.rows ?? [], prevData?.rows ?? [], childDim)
    .map((r) => ({ ...r, name: resolveName(childDim, r.raw, opts, smartLinkMap) }))
    .sort((a, b) => b.current.clicksGross - a.current.clicksGross),
  [curData, prevData, childDim, opts, smartLinkMap]);

  const colCount = 1 + DETAIL_METRICS.length * 3;
  if (curLoading || prevLoading) return <tr><td colSpan={colCount} className="px-4 py-3 text-center"><Spinner /></td></tr>;
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
                <span className="mr-3 text-fg-muted"><VarianceValue prev={prev} curr={curr} isMoney={m.money} /></span>
                <VarianceBadge prev={prev} curr={curr} mode={mode} isMoney={m.money} />
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

  const [parentDim, setParentDim] = useState<DimKey>('publisher');
  const [childDim, setChildDim] = useState<DimKey | null>(null);
  const [currentFrom, setCurrentFrom] = useState(todayStr());
  const [currentTo, setCurrentTo] = useState(todayStr());
  const [previousFrom, setPreviousFrom] = useState(daysAgo(1));
  const [previousTo, setPreviousTo] = useState(daysAgo(1));
  const [appliedParentDim, setAppliedParentDim] = useState<DimKey>('publisher');
  const [appliedChildDim, setAppliedChildDim] = useState<DimKey | null>(null);
  const [appliedCurrentFrom, setAppliedCurrentFrom] = useState(currentFrom);
  const [appliedCurrentTo, setAppliedCurrentTo] = useState(currentTo);
  const [appliedPreviousFrom, setAppliedPreviousFrom] = useState(previousFrom);
  const [appliedPreviousTo, setAppliedPreviousTo] = useState(previousTo);
  const [filters, setFilters] = useState<FilterValues>({});
  const [appliedFilters, setAppliedFilters] = useState<FilterValues>({});
  const [exclusions, setExclusions] = useState<FilterValues>({});
  const [appliedExclusions, setAppliedExclusions] = useState<FilterValues>({});
  const [metricFilters, setMetricFilters] = useState<MetricFilters>({});
  const [appliedMetricFilters, setAppliedMetricFilters] = useState<MetricFilters>({});
  const [ignoreFailTraffic, setIgnoreFailTraffic] = useState(false);
  const [appliedIgnoreFailTraffic, setAppliedIgnoreFailTraffic] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'pct' | 'num'>('pct');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showApiRequest, setShowApiRequest] = useState(false);

  const { data: offers } = useQuery<{ id: string; name: string }[]>('/api/offers');
  const { data: publishers } = useQuery<{ id: string; name: string }[]>('/api/publishers');
  const { data: advertisers } = useQuery<{ id: string; name: string }[]>('/api/advertisers');
  const { data: smartLinksList } = useQuery<SmartLink[]>('/api/smart-links');
  const { data: countryAgg } = useQuery<AggResult>('/api/reports?groupBy=country&metrics=clicks&limit=200');
  const countryOptions = useMemo(() => (countryAgg?.rows ?? [])
    .map((r) => r.dimensions['country']).filter((c): c is string => Boolean(c)).sort()
    .map((c) => ({ value: c, label: c })), [countryAgg]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'advertiser', label: 'Advertiser', options: (advertisers ?? []).map((a) => ({ value: a.id, label: a.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
    { key: 'smartLink', label: 'Smart Link', options: (smartLinksList ?? []).map((s) => ({ value: s.id, label: s.name })) },
    { key: 'country', label: 'Country', options: countryOptions },
    { key: 'device', label: 'Device', options: DEVICES.map((d) => ({ value: d, label: d.charAt(0).toUpperCase() + d.slice(1) })) },
  ], [offers, advertisers, publishers, smartLinksList, countryOptions]);

  const excludeOfferId = appliedExclusions['offer']?.[0];
  const excludeAdvertiserId = appliedExclusions['advertiser']?.[0];
  const excludePublisherId = appliedExclusions['partner']?.[0];
  const excludeSmartLinkId = appliedExclusions['smartLink']?.[0];
  const excludeCountry = appliedExclusions['country']?.[0];
  const excludeDevice = appliedExclusions['device']?.[0];
  const dimParams = {
    offerId: appliedFilters['offer']?.[0], advertiserId: appliedFilters['advertiser']?.[0],
    publisherId: appliedFilters['partner']?.[0], smartLinkId: appliedFilters['smartLink']?.[0],
    country: appliedFilters['country']?.[0], device: appliedFilters['device']?.[0],
    excludeOfferId, excludeAdvertiserId, excludePublisherId, excludeSmartLinkId, excludeCountry, excludeDevice,
    excludeInvalid: appliedIgnoreFailTraffic ? 1 : undefined,
  };

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };

  const curTableQs = qs({ groupBy: appliedParentDim, metrics: METRICS_PARAM, from: toIso(appliedCurrentFrom), to: toIso(appliedCurrentTo, true), ...dimParams, limit: 200 });
  const prevTableQs = qs({ groupBy: appliedParentDim, metrics: METRICS_PARAM, from: toIso(appliedPreviousFrom), to: toIso(appliedPreviousTo, true), ...dimParams, limit: 200 });
  const { data: curData, loading: curLoading, error: curError } = useQuery<AggResult>(`/api/reports?${curTableQs}`);
  const { data: prevData, loading: prevLoading } = useQuery<AggResult>(`/api/reports?${prevTableQs}`);

  const rows = useMemo((): VarianceRow[] => mergeRows(curData?.rows ?? [], prevData?.rows ?? [], appliedParentDim)
    .map((r) => ({ raw: r.raw, name: resolveName(appliedParentDim, r.raw, opts, smartLinkMap), current: r.current, previous: r.previous }))
    .filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()))
    .filter((r) => passesMetricFilters(r.current, appliedMetricFilters))
    .sort((a, b) => b.current.clicksGross - a.current.clicksGross),
  [curData, prevData, appliedParentDim, opts, smartLinkMap, q, appliedMetricFilters]);

  const summary = useMemo(() => {
    if (!curData?.rows.length && !prevData?.rows?.length) return null;
    const sum = (rowsIn: { metrics: Record<string, string | number> }[]) => rowsIn.reduce((acc, r) => {
      acc.clicks += Number(r.metrics['clicks'] ?? 0); acc.unique_clicks += Number(r.metrics['unique_clicks'] ?? 0);
      acc.invalid_clicks += Number(r.metrics['invalid_clicks'] ?? 0);
      acc.conversions += Number(r.metrics['conversions'] ?? 0); acc.total_conversions += Number(r.metrics['total_conversions'] ?? 0);
      acc.payout += Number(r.metrics['payout'] ?? 0); acc.revenue += Number(r.metrics['revenue'] ?? 0); acc.margin += Number(r.metrics['margin'] ?? 0);
      return acc;
    }, { clicks: 0, unique_clicks: 0, invalid_clicks: 0, conversions: 0, total_conversions: 0, payout: 0, revenue: 0, margin: 0 });
    return { current: deriveRow(sum(curData?.rows ?? [])), previous: deriveRow(sum(prevData?.rows ?? [])) };
  }, [curData, prevData]);

  const runReport = () => {
    setAppliedParentDim(parentDim); setAppliedChildDim(childDim);
    setAppliedCurrentFrom(currentFrom); setAppliedCurrentTo(currentTo);
    setAppliedPreviousFrom(previousFrom); setAppliedPreviousTo(previousTo);
    setAppliedFilters(filters); setAppliedExclusions(exclusions); setAppliedMetricFilters(metricFilters); setAppliedIgnoreFailTraffic(ignoreFailTraffic);
    setExpanded(new Set());
  };
  const clearAll = () => {
    setParentDim('publisher'); setChildDim(null);
    setCurrentFrom(todayStr()); setCurrentTo(todayStr()); setPreviousFrom(daysAgo(1)); setPreviousTo(daysAgo(1));
    setFilters({}); setExclusions({}); setMetricFilters({}); setIgnoreFailTraffic(false);
    setAppliedParentDim('publisher'); setAppliedChildDim(null);
    setAppliedCurrentFrom(todayStr()); setAppliedCurrentTo(todayStr()); setAppliedPreviousFrom(daysAgo(1)); setAppliedPreviousTo(daysAgo(1));
    setAppliedFilters({}); setAppliedExclusions({}); setAppliedMetricFilters({}); setAppliedIgnoreFailTraffic(false);
  };
  const toggleExpand = (raw: string) => setExpanded((s) => { const n = new Set(s); if (n.has(raw)) n.delete(raw); else n.add(raw); return n; });

  const SUMMARY_TILES: { key: string; label: string; real: boolean; get?: (d: DerivedRow) => number; format?: (v: number) => string }[] = [
    { key: 'mbc', label: 'Media Buying Cost', real: false },
    { key: 'imp', label: 'Impression', real: false },
    { key: 'grossClicks', label: 'Gross Clicks', real: true, get: (d) => d.clicksGross, format: (v) => v.toLocaleString() },
    { key: 'clicks', label: 'Clicks', real: true, get: (d) => d.clicks, format: (v) => v.toLocaleString() },
    { key: 'totalCv', label: 'Total CV', real: true, get: (d) => d.totalCv, format: (v) => v.toLocaleString() },
    { key: 'vtCv', label: 'VT CV', real: false },
    { key: 'ctr', label: 'CTR', real: false },
    { key: 'event', label: 'Event', real: false },
    { key: 'cvr', label: 'CVR', real: true, get: (d) => d.cvr, format: pct },
    { key: 'cpc', label: 'CPC', real: true, get: (d) => d.cpc, format: money },
    { key: 'cpa', label: 'CPA', real: true, get: (d) => d.cpa, format: money },
    { key: 'rpc', label: 'RPC', real: true, get: (d) => d.rpc, format: money },
    { key: 'cpm', label: 'CPM', real: false },
    { key: 'rpm', label: 'RPM', real: false },
    { key: 'rpa', label: 'RPA', real: true, get: (d) => d.rpa, format: money },
    { key: 'payout', label: 'Payout', real: true, get: (d) => d.payout, format: money },
    { key: 'revenue', label: 'Revenue', real: true, get: (d) => d.revenue, format: money },
    { key: 'profit', label: 'Profit', real: true, get: (d) => d.margin, format: money },
    { key: 'margin', label: 'Margin', real: true, get: (d) => d.marginPct, format: pct },
    { key: 'avgSale', label: 'Avg. Sale Value', real: false },
    { key: 'grossSales', label: 'Gross Sales', real: false },
  ];

  const loading = curLoading || prevLoading;

  return (
    <>
      <PageHeader title="Variance Report" subtitle="Analytics › Variance" action={
        <button type="button" title="Page Actions" onClick={() => setShowApiRequest(true)}
          className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
          <MoreVertical size={15} />
        </button>
      } />

      <div className="card mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label mb-1 block">Current <span className="text-danger-text">*</span></label>
            <div className="flex items-center gap-1.5">
              <input type="date" className="input !w-40" value={currentFrom} max={currentTo} onChange={(e) => setCurrentFrom(e.target.value)} />
              <span className="text-fg-muted">–</span>
              <input type="date" className="input !w-40" value={currentTo} min={currentFrom} max={todayStr()} onChange={(e) => setCurrentTo(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label mb-1 block">Previous <span className="text-danger-text">*</span></label>
            <div className="flex items-center gap-1.5">
              <input type="date" className="input !w-40" value={previousFrom} max={previousTo} onChange={(e) => setPreviousFrom(e.target.value)} />
              <span className="text-fg-muted">–</span>
              <input type="date" className="input !w-40" value={previousTo} min={previousFrom} onChange={(e) => setPreviousTo(e.target.value)} />
            </div>
          </div>
          <SingleSelectDropdown label="Parent" value={parentDim} onChange={(k) => k && setParentDim(k)} />
          <SingleSelectDropdown label="Child" value={childDim} onChange={setChildDim} allowNone />
          <div className="relative">
            <FilterButton
              count={reportingFiltersCount({ filters, exclusions, metricFilters, ignoreFailTraffic })}
              onClick={() => setFilterOpen((o) => !o)}
            />
            {filterOpen && (
              <ReportingFiltersFlyout
                dimCategories={FILTER_CATEGORIES}
                value={{ filters, exclusions, metricFilters, ignoreFailTraffic }}
                onApply={(v) => { setFilters(v.filters); setExclusions(v.exclusions); setMetricFilters(v.metricFilters); setIgnoreFailTraffic(v.ignoreFailTraffic); }}
                onClose={() => setFilterOpen(false)}
              />
            )}
          </div>
          <button type="button" className="text-small font-medium text-accent-text hover:underline" onClick={clearAll}>Clear</button>
          <div className="flex-1" />
        </div>
        <button type="button" className="btn-primary w-full" onClick={runReport}>Run Report</button>
      </div>

      <div className="card mb-4">
        <button type="button" onClick={() => setSummaryOpen((o) => !o)} className="flex w-full items-center gap-2 text-small font-medium text-fg">
          <ChevronDown size={14} className={`transition-transform ${summaryOpen ? '' : '-rotate-90'}`} /> Summary
        </button>
        {summaryOpen && (
          loading ? <div className="pt-4"><Spinner /></div> : !summary ? <p className="pt-3 text-small text-fg-muted">No data for this period.</p> : (
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 md:grid-cols-5">
              {SUMMARY_TILES.map((t) => {
                const curr = t.real && t.get ? t.get(summary.current) : 0;
                const prev = t.real && t.get ? t.get(summary.previous) : 0;
                return (
                  <div key={t.key}>
                    <p className="text-tiny uppercase tracking-wide text-fg-muted">{t.label}</p>
                    {!t.real ? <p className="mt-1 text-h3 font-medium text-fg-muted">{DASH}</p> : (
                      <>
                        <p className="mt-1 text-h3 font-medium text-fg">{t.format!(curr)}</p>
                        <p className="text-tiny"><VarianceBadge prev={prev} curr={curr} mode="pct" /></p>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-h3 font-medium text-fg">Detailed Report</h3>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-[var(--radius)] border border-border">
              <button type="button" onClick={() => setMode('pct')} className={`px-2.5 py-1.5 text-tiny font-medium ${mode === 'pct' ? 'bg-accent text-white' : 'bg-surface text-fg-secondary hover:bg-accent-subtle'}`}>%</button>
              <button type="button" onClick={() => setMode('num')} className={`px-2.5 py-1.5 text-tiny font-medium ${mode === 'num' ? 'bg-accent text-white' : 'bg-surface text-fg-secondary hover:bg-accent-subtle'}`}>#</button>
            </div>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input className="input !w-56 !pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
        </div>

        {loading ? <StateBlock><Spinner /></StateBlock>
          : curError ? <StateBlock>{curError}</StateBlock>
          : !rows.length ? <StateBlock>No Record Found</StateBlock>
          : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full min-w-[2200px] text-left text-body">
                <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr>
                    <th rowSpan={2} className="whitespace-nowrap px-4 py-3 align-bottom font-semibold">{DIM_OPTIONS.find((o) => o.key === appliedParentDim)?.label}</th>
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
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <Fragment key={r.raw}>
                      <tr className="hover:bg-accent-subtle/40">
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className="flex items-center gap-1.5">
                            {appliedChildDim && (
                              <button type="button" onClick={() => toggleExpand(r.raw)} className="text-fg-muted hover:text-fg">
                                {expanded.has(r.raw) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              </button>
                            )}
                            {linkFor(appliedParentDim, r.raw) ? <Link to={linkFor(appliedParentDim, r.raw)!} className="text-accent-text hover:underline">{r.name}</Link> : r.name}
                          </span>
                        </td>
                        {DETAIL_METRICS.map((m) => {
                          if (!m.real) return (
                            <td key={m.key} colSpan={3} className="px-4 py-3 text-center text-fg-muted">{DASH}</td>
                          );
                          const curr = m.get!(r.current); const prev = m.get!(r.previous);
                          return (
                            <Fragment key={m.key}>
                              <td className="px-4 py-3 text-right text-fg-secondary">{fmtNum(prev, m.money)}</td>
                              <td className="px-4 py-3 text-right">{fmtNum(curr, m.money)}</td>
                              <td className="px-4 py-3 text-right"><VarianceBadge prev={prev} curr={curr} mode={mode} isMoney={m.money} /></td>
                            </Fragment>
                          );
                        })}
                      </tr>
                      {appliedChildDim && expanded.has(r.raw) && (
                        <ExpandedChildRows
                          childDim={appliedChildDim}
                          parentFilterParam={DIM_OPTIONS.find((o) => o.key === appliedParentDim)!.filterParam}
                          parentRawId={r.raw}
                          currentFrom={appliedCurrentFrom} currentTo={appliedCurrentTo}
                          previousFrom={appliedPreviousFrom} previousTo={appliedPreviousTo}
                          dimParams={dimParams} mode={mode} opts={opts} smartLinkMap={smartLinkMap}
                        />
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports?${curTableQs}`} appliedFilters={{
        currentFrom: appliedCurrentFrom, currentTo: appliedCurrentTo, previousFrom: appliedPreviousFrom, previousTo: appliedPreviousTo,
        parent: appliedParentDim, child: appliedChildDim ?? undefined,
        offer: dimParams.offerId, advertiser: dimParams.advertiserId, partner: dimParams.publisherId, smartLink: dimParams.smartLinkId, country: dimParams.country, device: dimParams.device,
        excludeOffer: excludeOfferId, excludeAdvertiser: excludeAdvertiserId, excludePartner: excludePublisherId, excludeSmartLink: excludeSmartLinkId, excludeCountry, excludeDevice,
        ignoreFailTraffic: appliedIgnoreFailTraffic ? 'true' : undefined,
      }} />}
    </>
  );
}
