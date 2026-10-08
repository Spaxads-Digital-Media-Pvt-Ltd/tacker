/**
 * Analytics › Cohort — verified against the live reference (URL `/analytics/cohort`, real data): a
 * per-day-of-click "aging" table. Rows are cohort days (the day a click happened); "Day N" columns
 * show how much of a chosen conversion-side metric landed *exactly* N calendar days after the click
 * for that cohort — confirmed NOT cumulative (a later Day column can be 0 while an earlier one isn't)
 * — and a cell renders as "—" rather than 0 when day N hasn't happened yet relative to today (e.g. a
 * cohort from yesterday can only ever have a real Day 1 value so far).
 *
 * No Summary or Performance Graph section here — the reference's Cohort Report is just the date
 * range, Top-level Metric / Metric pickers, Add Filter, and the cohort table itself.
 *
 * "Top-level Metric" (the per-cohort-day denominator) is real for Clicks / Unique Clicks; the
 * reference's Impression and Total CV options are omitted — Impression has no backing anywhere in
 * this app, and Total CV would mean anchoring cohorts by conversion date instead of click date, a
 * different (and here, unsupported) semantic. "Metric" (what Day N counts) is real for
 * CV / Payout / Revenue; the reference's Gross Sales / Media Buying Cost / VT-prefixed options have
 * no backing (no sale-amount or view-through/impression tracking anywhere in this schema).
 *
 * Backed by a new dedicated endpoint (`GET /api/reports/cohort`,
 * api-backend/src/surfaces/dashboard/reports/detail-reports.ts) rather than the generic
 * multi-dimension `/api/reports` engine — day-offset bucketing needs its own SQL.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, MoreVertical, SlidersHorizontal } from 'lucide-react';
import { useQuery } from '../../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { type FilterCategory, type FilterValues } from '../../../shared-components/primitives/CategorizedFilters';
import {
  DASH, DEVICE_OPTIONS, money, toIso, daysAgo, todayStr,
  type MetricFilters, reportingFiltersCount, ReportingFiltersFlyout,
} from '../../../shared-components/primitives/ReportPageKit';
import { readUrlFilters, readUrlDate, reportLink, urlFilterParams } from '../../../lib/reportFilterState';
import { useReportOpts } from '../Reports';
import { countryLabel } from '../../../data/geo';
import { ActiveFilterChips } from '../../../shared-components/primitives/ActiveFilterChips';
import { chipsFromValues, withoutValue } from '../../../lib/filterChips';

interface SmartLink { id: string; name: string }
interface CohortRow { date: string; topLevel: number; days: (number | null)[] }
interface CohortResult { maxDay: number; rows: CohortRow[] }

const TOP_LEVEL_OPTIONS = [
  { key: 'clicks', label: 'Clicks' },
  { key: 'unique_clicks', label: 'Unique Clicks' },
] as const;
type TopLevelKey = (typeof TOP_LEVEL_OPTIONS)[number]['key'];

const METRIC_OPTIONS = [
  { key: 'conversions', label: 'CV' },
  { key: 'payout', label: 'Payout' },
  { key: 'revenue', label: 'Revenue' },
] as const;
type MetricKey = (typeof METRIC_OPTIONS)[number]['key'];

function fmtCell(v: number | null, metric: MetricKey): string {
  if (v == null) return DASH;
  if (metric === 'payout' || metric === 'revenue') return money(v);
  return v.toLocaleString();
}

function SingleSelect<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { key: T; label: string }[]; onChange: (k: T) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <label className="label">{label} <span className="text-danger-text">*</span></label>
      <button type="button" onClick={() => setOpen((o) => !o)} className="input flex items-center justify-between !py-2 text-left">
        {options.find((o) => o.key === value)?.label} <ChevronDown size={13} className="text-fg-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 w-44 overflow-y-auto rounded-card border border-border bg-elevated py-1 shadow-elevated">
            {options.map((o) => (
              <button key={o.key} onClick={() => { onChange(o.key); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-small hover:bg-accent-subtle ${o.key === value ? 'text-accent-text' : 'text-fg'}`}>
                {o.key === value && '✓'} {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Initial report state from the URL — what "Copy Link to Report" writes. */
function readCohortUrl() {
  const sp = new URLSearchParams(window.location.search);
  let from = readUrlDate(sp, 'from', daysAgo(6));
  const to = readUrlDate(sp, 'to', todayStr());
  if (from > to) from = to;
  const tl = TOP_LEVEL_OPTIONS.find((o) => o.key === sp.get('topLevelMetric'))?.key ?? 'clicks';
  const m = METRIC_OPTIONS.find((o) => o.key === sp.get('metric'))?.key ?? 'conversions';
  // The cohort endpoint takes one value per filter (the flyout is single-select here).
  const filters: FilterValues = {};
  for (const [k, vals] of Object.entries(readUrlFilters(sp, 'f'))) if (vals[0]) filters[k] = [vals[0]];
  return { from, to, topLevel: tl as TopLevelKey, metric: m as MetricKey, filters };
}

export default function CohortReport() {
  useReportOpts();
  const [init] = useState(readCohortUrl);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [appliedFrom, setAppliedFrom] = useState(from);
  const [appliedTo, setAppliedTo] = useState(to);
  const [topLevel, setTopLevel] = useState<TopLevelKey>(init.topLevel);
  const [metric, setMetric] = useState<MetricKey>(init.metric);
  const [appliedTopLevel, setAppliedTopLevel] = useState<TopLevelKey>(topLevel);
  const [appliedMetric, setAppliedMetric] = useState<MetricKey>(metric);
  const [filters, setFilters] = useState<FilterValues>(init.filters);
  const [appliedFilters, setAppliedFilters] = useState<FilterValues>(init.filters);
  const [exclusions, setExclusions] = useState<FilterValues>({});
  const [metricFilters, setMetricFilters] = useState<MetricFilters>({});
  const [ignoreFailTraffic, setIgnoreFailTraffic] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [hasRun, setHasRun] = useState(true);
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: offers } = useQuery<{ id: string; name: string }[]>('/api/offers');
  const { data: publishers } = useQuery<{ id: string; name: string }[]>('/api/publishers');
  const { data: advertisers } = useQuery<{ id: string; name: string }[]>('/api/advertisers');
  const { data: smartLinksList } = useQuery<SmartLink[]>('/api/smart-links');
  const { data: countryAgg } = useQuery<{ rows: { dimensions: Record<string, string | null> }[] }>('/api/reports?groupBy=country&metrics=clicks&limit=200');
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

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };
  const tableQs = qs({
    from: toIso(appliedFrom), to: toIso(appliedTo, true),
    topLevelMetric: appliedTopLevel, metric: appliedMetric,
    offerId: appliedFilters['offer']?.[0], advertiserId: appliedFilters['advertiser']?.[0],
    publisherId: appliedFilters['partner']?.[0], smartLinkId: appliedFilters['smartLink']?.[0],
    country: appliedFilters['country']?.[0], device: appliedFilters['device']?.[0],
  });
  const { data, loading, error } = useQuery<CohortResult>(hasRun ? `/api/reports/cohort?${tableQs}` : null);

  const runReport = () => {
    setAppliedFrom(from); setAppliedTo(to); setAppliedTopLevel(topLevel); setAppliedMetric(metric); setAppliedFilters(filters);
    setHasRun(true);
  };
  const clearAll = () => {
    setFrom(daysAgo(6)); setTo(todayStr()); setTopLevel('clicks'); setMetric('conversions'); setFilters({});
    setAppliedFrom(daysAgo(6)); setAppliedTo(todayStr()); setAppliedTopLevel('clicks'); setAppliedMetric('conversions'); setAppliedFilters({});
  };
  const copyLink = async () => {
    await navigator.clipboard?.writeText(reportLink({
      from: appliedFrom, to: appliedTo, topLevelMetric: appliedTopLevel, metric: appliedMetric,
      ...urlFilterParams('f', appliedFilters),
    }));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const topLevelLabel = TOP_LEVEL_OPTIONS.find((o) => o.key === appliedTopLevel)?.label ?? 'Clicks';
  const dayHeaders = useMemo(() => Array.from({ length: data?.maxDay ?? 0 }, (_, i) => i + 1), [data?.maxDay]);
  const rowMax = (r: CohortRow) => Math.max(1, ...r.days.filter((v): v is number => v != null));

  return (
    <>
      <PageHeader title="Cohort Report" subtitle="Analytics › Cohort" action={
        <div className="relative">
          <button type="button" title="Page Actions" onClick={() => setPageMenuOpen((o) => !o)}
            className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <MoreVertical size={15} />
          </button>
          {pageMenuOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 w-48 rounded-card border border-border bg-elevated py-1 shadow-elevated">
              <button onClick={() => { copyLink(); setPageMenuOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">{copied ? 'Copied!' : 'Copy Link to Report'}</button>
            </div>
          )}
        </div>
      } />

      <div className="card mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">From</label>
            <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} />
          </div>
          <SingleSelect label="Top-level Metric" value={topLevel} options={TOP_LEVEL_OPTIONS} onChange={setTopLevel} />
          <SingleSelect label="Metric" value={metric} options={METRIC_OPTIONS} onChange={setMetric} />
          <div className="relative">
            <button type="button" onClick={() => setFilterOpen((o) => !o)}
              className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg relative">
              <SlidersHorizontal size={15} />
              {reportingFiltersCount({ filters, exclusions, metricFilters, ignoreFailTraffic }) > 0 && (
                <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                  {reportingFiltersCount({ filters, exclusions, metricFilters, ignoreFailTraffic })}
                </span>
              )}
            </button>
            {filterOpen && (
              <ReportingFiltersFlyout
                sections={['filters']} singleSelect
                dimCategories={FILTER_CATEGORIES}
                value={{ filters, exclusions, metricFilters, ignoreFailTraffic }}
                onApply={(v) => { setFilters(v.filters); setExclusions(v.exclusions); setMetricFilters(v.metricFilters); setIgnoreFailTraffic(v.ignoreFailTraffic); }}
                onClose={() => setFilterOpen(false)}
              />
            )}
          </div>
          <button type="button" className="text-small font-medium text-accent-text hover:underline" onClick={clearAll}>Clear</button>
          <div className="flex-1" />
          <button type="button" className="btn-primary" onClick={runReport}>Run Report</button>
        </div>
      </div>

      <div className="card">
        <ActiveFilterChips className="mb-3" chips={chipsFromValues(FILTER_CATEGORIES, appliedFilters)}
          onRemove={(c) => { const n = withoutValue(appliedFilters, c.key, c.value); setFilters(n); setAppliedFilters(n); }}
          onClearAll={() => { setFilters({}); setAppliedFilters({}); }} />
        {!hasRun ? <StateBlock>Set parameters and run report</StateBlock>
          : loading ? <StateBlock><Spinner /></StateBlock>
          : error ? <StateBlock>{error}</StateBlock>
          : !data?.rows.length ? <StateBlock>No Record Found</StateBlock>
          : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th >Date</th>
                    <th className="text-right font-semibold">{topLevelLabel}</th>
                    {dayHeaders.map((n) => <th key={n} className="text-right font-semibold">Day {n}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const max = rowMax(r);
                    return (
                      <tr key={r.date}>
                        <td className="font-medium text-fg">{new Date(r.date).toISOString().slice(0, 10)}</td>
                        <td className="px-4 py-3 text-right text-fg-secondary">{r.topLevel.toLocaleString()}</td>
                        {dayHeaders.map((n, i) => {
                          const v = r.days[i] ?? null;
                          const intensity = v != null && v > 0 ? Math.min(1, v / max) : 0;
                          return (
                            <td key={n} className="px-4 py-3 text-right"
                              style={v != null && v > 0 ? { backgroundColor: `rgb(var(--accent) / ${0.08 + intensity * 0.22})` } : undefined}>
                              {fmtCell(v, appliedMetric)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </>
  );
}
