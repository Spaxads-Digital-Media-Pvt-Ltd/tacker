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
 *
 * No "Run Report": every control applies on its own — dates once they form a valid range (debounced,
 * since the native date input reports each typed segment), Top-level Metric / Metric / filters / chips
 * immediately. The applied report is mirrored to the address bar (keeping `tab`), so the URL itself
 * is the shareable link.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '../../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { type FilterCategory, type FilterValues } from '../../../shared-components/primitives/CategorizedFilters';
import {
  DASH, DEVICE_OPTIONS, toIso, daysAgo, todayStr,
  dimCount, ReportingFiltersFlyout, EMPTY_REPORTING_FILTERS,
} from '../../../shared-components/primitives/ReportPageKit';
import { readUrlFilters, readUrlDate, writeUrlFilters } from '../../../lib/reportFilterState';
import { useReportOpts } from '../Reports';
import { countryLabel } from '../../../data/geo';
import { ActiveFilterChips } from '../../../shared-components/primitives/ActiveFilterChips';
import { chipsFromValues, withoutValue } from '../../../lib/filterChips';
import { useAutoDateRange } from '../reportView';
import { ReportCard, ReportControls, ControlField, DateRangeField, FiltersButton, ClearButton, ResultsBar, ReportBody } from '../../../shared-components/primitives/ReportLayout';
import { REPORT_CONTROL as CONTROL } from '../../../shared-components/primitives/reportControl';
import { resolveCurrency, type RowCurrency } from '../../../lib/reportCurrency';
import { Money } from '../../../shared-components/primitives/ReportMoney';

interface SmartLink { id: string; name: string }
/**
 * `currencies` (newer API): the currencies of the approved conversions behind the row's Payout /
 * Revenue cells — one → its cells are in it; several → "Mixed" (no cross-currency sums); absent or
 * empty → the network currency.
 */
interface CohortRow { date: string; topLevel: number; days: (number | null)[]; currencies?: string[] }
interface CohortResult { maxDay: number; rows: CohortRow[]; currencies?: string[] }

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

const isMoneyMetric = (metric: MetricKey) => metric === 'payout' || metric === 'revenue';

/** A day cell: money in the row's currency ("Mixed" when the row's conversions mix currencies). */
function CohortCell({ v, metric, rc }: { v: number | null; metric: MetricKey; rc: RowCurrency }) {
  if (v == null) return <>{DASH}</>;
  if (isMoneyMetric(metric)) return <Money value={v} rc={rc} />;
  return <>{v.toLocaleString()}</>;
}

/** Initial report state from the URL (reload / shared link) — what the address-bar sync writes. */
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
  const [searchParams, setSearchParams] = useSearchParams();
  // Dates apply on their own once they form a valid range (see useAutoDateRange); everything else
  // applies immediately.
  const range = useAutoDateRange(init.from, init.to);
  const { appliedFrom, appliedTo } = range;
  const [topLevel, setTopLevel] = useState<TopLevelKey>(init.topLevel);
  const [metric, setMetric] = useState<MetricKey>(init.metric);
  // The cohort endpoint honours dimension filters only (the flyout shows just that section).
  const [filters, setFilters] = useState<FilterValues>(init.filters);
  const [filterOpen, setFilterOpen] = useState(false);

  const { data: settings } = useQuery<{ general?: { defaultCurrency?: string } }>('/api/settings');
  const currency = settings?.general?.defaultCurrency ?? 'USD';
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
    topLevelMetric: topLevel, metric,
    offerId: filters['offer']?.[0], advertiserId: filters['advertiser']?.[0],
    publisherId: filters['partner']?.[0], smartLinkId: filters['smartLink']?.[0],
    country: filters['country']?.[0], device: filters['device']?.[0],
  });
  const { data, loading, error } = useQuery<CohortResult>(`/api/reports/cohort?${tableQs}`);

  // The applied report lives in the URL (replace, not push) so reload / back / a shared link keep it.
  // `tab` is carried over — it is what selects this report on /app/analytics.
  const tab = searchParams.get('tab');
  const urlState = useMemo(() => {
    const next = new URLSearchParams();
    if (tab) next.set('tab', tab);
    next.set('from', appliedFrom); next.set('to', appliedTo);
    next.set('topLevelMetric', topLevel); next.set('metric', metric);
    writeUrlFilters(next, 'f', filters);
    return next.toString();
  }, [tab, appliedFrom, appliedTo, topLevel, metric, filters]);
  useEffect(() => {
    if (window.location.search.replace(/^\?/, '') !== urlState) setSearchParams(new URLSearchParams(urlState), { replace: true });
  }, [urlState, setSearchParams]);

  // Reset dates, metrics and filters in one render → one request. The debounced range catches up to
  // the same values later and is then a no-op.
  const clearAll = () => {
    range.reset({ from: daysAgo(6), to: todayStr() });
    setTopLevel('clicks'); setMetric('conversions'); setFilters({});
  };

  const topLevelLabel = TOP_LEVEL_OPTIONS.find((o) => o.key === topLevel)?.label ?? 'Clicks';
  const dayHeaders = useMemo(() => Array.from({ length: data?.maxDay ?? 0 }, (_, i) => i + 1), [data?.maxDay]);
  const rowMax = (r: CohortRow) => Math.max(1, ...r.days.filter((v): v is number => v != null));

  return (
    <>
      <PageHeader title="Cohort Report" subtitle="Analytics › Cohort" />

      <ReportCard>
        <ReportControls problem={range.problem} actions={<>
          <ClearButton onClick={clearAll} title="Reset dates, metrics and filters" />
          <FiltersButton count={dimCount(filters)} onClick={() => setFilterOpen((o) => !o)}>
            {filterOpen && (
              <ReportingFiltersFlyout
                sections={['filters']} singleSelect
                dimCategories={FILTER_CATEGORIES}
                value={{ ...EMPTY_REPORTING_FILTERS, filters }}
                onApply={(v) => setFilters(v.filters)}
                onClose={() => setFilterOpen(false)}
              />
            )}
          </FiltersButton>
        </>}>
          <DateRangeField idPrefix="cohort-report" from={range.from} to={range.to} max={todayStr()} invalid={range.problem !== null}
            onFrom={range.setFrom} onTo={range.setTo} />
          <ControlField label="Top-level Metric" htmlFor="cohort-report-top-level" className="w-full sm:w-48">
            <select id="cohort-report-top-level" className={`input ${CONTROL}`} value={topLevel} onChange={(e) => setTopLevel(e.target.value as TopLevelKey)}>
              {TOP_LEVEL_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </ControlField>
          <ControlField label="Metric" htmlFor="cohort-report-metric" className="w-full sm:w-48">
            <select id="cohort-report-metric" className={`input ${CONTROL}`} value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}>
              {METRIC_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </ControlField>
        </ReportControls>

        <ResultsBar title="Detailed Report" loading={loading}>
          <ActiveFilterChips chips={chipsFromValues(FILTER_CATEGORIES, filters)}
            onRemove={(c) => setFilters(withoutValue(filters, c.key, c.value))}
            onClearAll={() => setFilters({})} />
        </ResultsBar>

        <ReportBody>
        {/* A failed request keeps the previous `data` in useQuery — the error wins, never stale rows. */}
        {loading ? <StateBlock><Spinner /></StateBlock>
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
                    const rc = resolveCurrency(r.currencies, currency);
                    // A mixed row's money cells show "Mixed" — no heat shading from cross-currency sums.
                    const shade = !(isMoneyMetric(metric) && rc.kind === 'mixed');
                    return (
                      <tr key={r.date}>
                        <td className="font-medium text-fg">{new Date(r.date).toISOString().slice(0, 10)}</td>
                        <td className="px-4 py-3 text-right text-fg-secondary">{r.topLevel.toLocaleString()}</td>
                        {dayHeaders.map((n, i) => {
                          const v = r.days[i] ?? null;
                          const intensity = v != null && v > 0 ? Math.min(1, v / max) : 0;
                          return (
                            <td key={n} className="px-4 py-3 text-right"
                              style={shade && v != null && v > 0 ? { backgroundColor: `rgb(var(--accent) / ${0.08 + intensity * 0.22})` } : undefined}>
                              <CohortCell v={v} metric={metric} rc={rc} />
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
        </ReportBody>
      </ReportCard>
    </>
  );
}
