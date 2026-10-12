/**
 * Reporting › Click — verified against the live reference as far as its flakiness allowed: same
 * raw event-log shape as Impression Report (one row per click, not a grouped aggregate — no
 * Summary/graph section), URL `/reporting/clicks`, and the same ~45-column header set (mostly
 * device/fraud metadata this app's schema doesn't have). Unlike Impression Report, clicks are real
 * and voluminous here, so this is a genuinely populated, working report backed by the existing
 * `GET /api/reports/clicks` row-level endpoint (api-backend/src/surfaces/dashboard/reports/
 * detail-reports.ts) — already real, already filtered/parameterized, no rebuild needed there.
 *
 * Two small honest backend additions: a `converted` flag (EXISTS against conversions.click_id —
 * mirrors the reference's real "Converted" column; any status, so pending/rejected count too, unlike
 * the grouped mode's approved-only Conversions) and `smart_link_id` in the row payload.
 *
 * Reporting Filters › "Conversion Status" (both modes) sends `conversionStatus`: only clicks with a
 * conversion in that status (Any / Approved / Pending / Rejected), or "Not converted" for clicks
 * with none. No selection sends nothing — every click, as before. It narrows which clicks are
 * listed; the Converted column itself still means "has a conversion of any status".
 *
 * Group-By money is in each group's own currency (`currencies` — lib/reportCurrency): a group whose
 * conversions mix currencies shows "Mixed" instead of a cross-currency sum.
 *
 * Columns shown are a reduced, fully-backed subset of the reference's ~45 (Date, Converted, Offer,
 * Partner, Country, Region, City, ISP, Device, OS, Browser, Unique, Fraud, IP Address, Sub1-5) —
 * the reference's IDFA/Google Ad ID/Android ID/ZIP/Language/Platform/Brand/Proxy/Test Mode/Project
 * ID/etc. have no real source anywhere in this schema, so they're omitted rather than faked.
 *
 * Pagination here is "has more" (overfetch by one row), not a numeric total — the shared API client
 * (lib/api.ts) discards the response envelope's pagination metadata app-wide, and plumbing a real
 * total through it is a bigger, riskier change than this page warrants.
 *
 * No "Run Report": every control applies on its own — dates once they form a valid range (debounced,
 * since the native date input reports each typed segment), Group By / filters / chips immediately.
 * The applied report is mirrored to the address bar, so the URL itself is the shareable link.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, MoreVertical, ChevronLeft, ChevronRight, Check, X } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { api } from '../../lib/api';
import { PageHeader, Spinner, StateBlock } from '../../shared-components/primitives/ui';
import { type FilterCategory, type FilterValues } from '../../shared-components/primitives/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../shared-components/primitives/TableActionsKit';
import { daysAgo, todayStr, toIso, DASH, DEVICE_OPTIONS, deviceLabel, fetchAllPages, useReportExport, ExportStatus, ReportingFiltersFlyout, EMPTY_REPORTING_FILTERS } from '../../shared-components/primitives/ReportPageKit';
import { readUrlDate, readUrlIds } from '../../lib/reportFilterState';
import { useAutoDateRange } from './reportView';
import { ReportCard, ReportControls, ControlField, DateRangeField, FiltersButton, ClearButton, ResultsBar, ReportBody } from '../../shared-components/primitives/ReportLayout';
import { REPORT_CONTROL as CONTROL } from '../../shared-components/primitives/reportControl';
import type { Advertiser, Offer, Publisher } from '../../types';
import { countryLabel, countryName, regionName, useRegions } from '../../data/geo';
import { formatDateTime } from '../../lib/datetime';
import { TimeZoneSelect } from '../../shared-components/primitives/ReportTimeZone';
import { useReportTimeZone } from '../../lib/useReportTimeZone';
import { ActiveFilterChips } from '../../shared-components/primitives/ActiveFilterChips';
import { chipsFromValues, withoutValue } from '../../lib/filterChips';
import { CONVERSION_STATUS_OPTIONS, CONVERSION_STATUS_PARAM, readStatusParam, statusParamValue } from '../../lib/reportStatusFilters';
import { parseMoneyByCurrency, resolveCurrency, withRowCurrency, type RowCurrency } from '../../lib/reportCurrency';
import { Money } from '../../shared-components/primitives/ReportMoney';

interface SmartLink { id: string; name: string }
interface ClickRow {
  click_id: string; created_at: string; offer_id: string; publisher_id: string | null;
  smart_link_id: string | null; ip: string | null; country: string | null; region: string | null;
  city: string | null; isp: string | null; device: string | null; os: string | null; browser: string | null;
  is_unique: boolean; fraud_score: number; fraud_flags: string[];
  sub1: string | null; sub2: string | null; sub3: string | null; sub4: string | null; sub5: string | null;
  converted: boolean;
}
interface GroupedRow {
  key: string; id: number | null; label: string; currency: string;
  clicks: number; conversions: number; payout: string; revenue: string; profit: string; cr: number; epc: number;
  /** Distinct currencies of the group's money-bearing conversions (newer API) — see lib/reportCurrency. */
  currencies?: string[];
  /** Per-currency payout/revenue/margin (newer API) — a mixed group lists them in its "Mixed" tooltip. */
  moneyByCurrency?: unknown;
}
/** A group's money currency: its conversions' one currency, "mixed", or (none / older API) `currency`. */
const groupedCurrency = (r: GroupedRow): RowCurrency => resolveCurrency(r.currencies, r.currency || 'USD');

const ALL_COLUMNS = [
  'Converted', 'Offer', 'Partner', 'Country', 'Region', 'City', 'ISP', 'Device', 'OS', 'Browser',
  'Unique', 'Fraud', 'IP Address', 'Sub1', 'Sub2', 'Sub3', 'Sub4', 'Sub5',
] as const;

/** `/api/reports/grouped` groupings ('' = individual clicks via `/api/reports/clicks`). */
const GROUP_BY_OPTIONS = [
  { value: 'offer', label: 'Offer' }, { value: 'publisher', label: 'Partner' }, { value: 'advertiser', label: 'Advertiser' },
  { value: 'day', label: 'Day' }, { value: 'country', label: 'Country' }, { value: 'device', label: 'Device' },
] as const;
const groupByLabel = (g: string) => GROUP_BY_OPTIONS.find((o) => o.value === g)?.label ?? g;

/** Filter-drawer category ⇄ URL/API param (the same names the API takes, so links and requests agree). */
const URL_FILTER_PARAMS: [category: string, param: string][] = [
  ['offer', 'offerId'], ['advertiser', 'advertiserId'], ['partner', 'publisherId'],
  ['smartLink', 'smartLinkId'], ['country', 'country'], ['device', 'device'],
];
/** "Conversion Status" category key — its URL/API param is `conversionStatus`, validated on read. */
const CONVERSION_STATUS_CATEGORY = 'conversionStatus';

/** Applied report state from the URL (reload / shared link / legacy deep links). */
function readInitialState() {
  const sp = new URLSearchParams(window.location.search);
  const gb = sp.get('groupBy') ?? '';
  const filters: FilterValues = {};
  for (const [cat, param] of URL_FILTER_PARAMS) {
    const ids = readUrlIds(sp, param).slice(0, 1); // the drawer is single-select per category
    if (ids.length) filters[cat] = ids;
  }
  const conversionStatus = readStatusParam(sp, CONVERSION_STATUS_PARAM, CONVERSION_STATUS_OPTIONS);
  if (conversionStatus) filters[CONVERSION_STATUS_CATEGORY] = [conversionStatus];
  return {
    from: readUrlDate(sp, 'from', daysAgo(7)),
    to: readUrlDate(sp, 'to', todayStr()),
    groupBy: GROUP_BY_OPTIONS.some((o) => o.value === gb) ? gb : '',
    filters,
  };
}

export default function ClickReport() {
  const [init] = useState(readInitialState);
  const [, setSearchParams] = useSearchParams();
  // Dates apply on their own once they form a valid range (see useAutoDateRange); everything else
  // applies immediately and returns to page 1.
  const range = useAutoDateRange(init.from, init.to);
  const { from, to, appliedFrom, appliedTo, page, setPage, toFirstPage } = range;

  const [filters, setFilters] = useState<Record<string, string[]>>(init.filters);
  const [groupBy, setGroupBy] = useState(init.groupBy);
  const [filterOpen, setFilterOpen] = useState(false);
  const [q, setQ] = useState('');
  const pageSize = 25;
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [showApiRequest, setShowApiRequest] = useState(false);
  const exp = useReportExport();

  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: smartLinks } = useQuery<SmartLink[]>('/api/smart-links');
  const { data: countryAgg } = useQuery<{ rows: { dimensions: Record<string, string | null> }[] }>('/api/reports?groupBy=country&metrics=clicks&limit=200');
  const countryOptions = useMemo(() => (countryAgg?.rows ?? [])
    .map((r) => r.dimensions['country'])
    .filter((c): c is string => Boolean(c))
    .map((c) => ({ value: c, label: countryLabel(c) }))
    .sort((a, b) => a.label.localeCompare(b.label)), [countryAgg]);

  const offerMap = useMemo(() => new Map((offers ?? []).map((o) => [o.id, o.name])), [offers]);
  const pubMap = useMemo(() => new Map((publishers ?? []).map((p) => [p.id, p.name])), [publishers]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'advertiser', label: 'Advertiser', options: (advertisers ?? []).map((a) => ({ value: a.id, label: a.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
    { key: 'smartLink', label: 'Smart Link', options: (smartLinks ?? []).map((s) => ({ value: s.id, label: s.name })) },
    { key: 'country', label: 'Country', options: countryOptions },
    { key: 'device', label: 'Device', options: DEVICE_OPTIONS },
    { key: CONVERSION_STATUS_CATEGORY, label: 'Conversion Status', options: [...CONVERSION_STATUS_OPTIONS] },
  ], [offers, advertisers, publishers, smartLinks, countryOptions]);

  const offerIdFilter = filters['offer']?.[0];
  const advertiserIdFilter = filters['advertiser']?.[0];
  const publisherIdFilter = filters['partner']?.[0];
  const smartLinkIdFilter = filters['smartLink']?.[0];
  const countryFilter = filters['country']?.[0];
  const deviceFilter = filters['device']?.[0];
  const conversionStatusFilter = statusParamValue(filters[CONVERSION_STATUS_CATEGORY], CONVERSION_STATUS_OPTIONS);
  // Timestamps follow the filtered country's zone (else network/browser) — re-formatting only.
  const zone = useReportTimeZone(countryFilter);
  const regions = useRegions();
  const formatDate = (iso: string) => formatDateTime(iso, zone.tz);
  const regionLabel = (r: ClickRow) => (r.region ? (regionName(regions, r.region, r.country) ?? r.region) : DASH);

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };

  // Keys shared by /clicks and /grouped (both accept exactly these).
  const baseParams = {
    from: toIso(appliedFrom), to: toIso(appliedTo, true),
    offerId: offerIdFilter, advertiserId: advertiserIdFilter, publisherId: publisherIdFilter, smartLinkId: smartLinkIdFilter,
    country: countryFilter, device: deviceFilter, [CONVERSION_STATUS_PARAM]: conversionStatusFilter,
  };
  const tableQs = groupBy
    ? qs({ groupBy, ...baseParams })
    : qs({ ...baseParams, limit: pageSize + 1, offset: (page - 1) * pageSize });
  const groupedPath = groupBy ? `/api/reports/grouped?${tableQs}` : null;
  const rowPath = groupBy ? null : `/api/reports/clicks?${tableQs}`;

  // The applied report lives in the URL (replace, not push) so reload / back keep it.
  const urlState = useMemo(() => {
    const next = new URLSearchParams();
    next.set('from', appliedFrom); next.set('to', appliedTo);
    if (groupBy) next.set('groupBy', groupBy);
    for (const [cat, param] of URL_FILTER_PARAMS) { const v = filters[cat]?.[0]; if (v) next.set(param, v); }
    if (conversionStatusFilter) next.set(CONVERSION_STATUS_PARAM, conversionStatusFilter);
    return next.toString();
  }, [appliedFrom, appliedTo, groupBy, filters, conversionStatusFilter]);
  useEffect(() => {
    if (window.location.search.replace(/^\?/, '') !== urlState) setSearchParams(new URLSearchParams(urlState), { replace: true });
  }, [urlState, setSearchParams]);
  // /grouped returns { rows, totals } — rows keyed by `key`.
  const groupedQ = useQuery<{ rows: GroupedRow[] }>(groupedPath);
  const rowQ = useQuery<ClickRow[]>(rowPath);

  const [filteredRows, setFilteredRows] = useState<ClickRow[]>([]);
  useEffect(() => {
    setFilteredRows((rowQ.data ?? []).slice(0, pageSize));
  }, [rowQ.data, pageSize]);

  // A failed request keeps the previous `data` in useQuery — never show/export it as current.
  const allGroupedRows = useMemo(
    () => (groupBy && !groupedQ.error ? (groupedQ.data?.rows ?? []) : []),
    [groupBy, groupedQ.data, groupedQ.error],
  );
  const isLoading = groupBy ? groupedQ.loading : rowQ.loading;
  const activeFilterCount = Object.values(filters).reduce((n, arr) => n + (arr?.length ?? 0), 0);
  const displayError = groupBy ? groupedQ.error : rowQ.error;
  const hasNextPage = !groupBy && (rowQ.data?.length ?? 0) > pageSize;

  const searchNeedle = q.trim().toLowerCase();
  const groupedLabel = (r: GroupedRow) => (r.key === '~none~' ? r.label
    : groupBy === 'country' ? countryLabel(r.key) : groupBy === 'device' ? deviceLabel(r.key) : r.label);
  const groupedRows = searchNeedle
    ? allGroupedRows.filter((r) => groupedLabel(r).toLowerCase().includes(searchNeedle))
    : allGroupedRows;
  const rows = useMemo(() => filteredRows.filter((r) => {
    if (!searchNeedle) return true;
    const offerName = offerMap.get(r.offer_id) ?? '';
    const pubName = r.publisher_id ? (pubMap.get(r.publisher_id) ?? '') : '';
    return [offerName, pubName, r.country, r.country ? countryName(r.country) : null, r.city, r.ip, r.sub1, r.sub2, r.sub3, r.sub4, r.sub5]
      .some((v) => (v ?? '').toLowerCase().includes(searchNeedle));
  }), [filteredRows, searchNeedle, offerMap, pubMap]);

  // Reset dates, filters and grouping in one render → one request. The debounced range catches up to
  // the same values later and is then a no-op.
  const clearAll = () => { range.reset({ from: daysAgo(7), to: todayStr() }); setFilters({}); setGroupBy(''); };
  const changeGroupBy = (g: string) => { setGroupBy(g); toFirstPage(); };
  const showIndividualClicks = () => changeGroupBy('');

  const shown = useMemo(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const toExportRow = (r: ClickRow) => ({
    date: formatDate(r.created_at), converted: r.converted ? 'Yes' : 'No',
    offer: offerMap.get(r.offer_id) ?? r.offer_id, partner: r.publisher_id ? (pubMap.get(r.publisher_id) ?? r.publisher_id) : DASH,
    timezone: zone.tz,
    country: r.country ? countryName(r.country) : DASH, region: regionLabel(r), city: r.city ?? DASH, isp: r.isp ?? DASH,
    device: r.device ?? DASH, os: r.os ?? DASH, browser: r.browser ?? DASH, unique: r.is_unique ? 'Y' : 'N',
    fraud: r.fraud_score, ip: r.ip ?? DASH,
    sub1: r.sub1 ?? DASH, sub2: r.sub2 ?? DASH, sub3: r.sub3 ?? DASH, sub4: r.sub4 ?? DASH, sub5: r.sub5 ?? DASH,
  });
  // Every row matching the applied filters (not just this page); grouped mode exports the groups,
  // fetched for the applied filters at export time — the table's `groupedQ.data` still holds the
  // previous filters' groups while a new request is in flight.
  const runExport = (format: 'csv' | 'xlsx') => {
    if (groupBy) {
      void exp.run(format, `click-report-by-${groupBy}`, async () => ({
        // Money in the group's currency — "MIXED" with payout/revenue/profit left empty when it mixes currencies.
        rows: ((await api.get<{ rows: GroupedRow[] }>(`/api/reports/grouped?${qs({ groupBy, ...baseParams })}`))?.rows ?? []).map((r) => withRowCurrency({
          [groupByLabel(groupBy)]: groupedLabel(r), clicks: r.clicks, conversions: r.conversions,
          cr: `${r.cr.toFixed(2)}%`, payout: r.payout, revenue: r.revenue, profit: r.profit,
        }, groupedCurrency(r), ['payout', 'revenue', 'profit'])),
      }));
      return;
    }
    void exp.run(format, 'click-report', async () => {
      const res = await fetchAllPages<ClickRow>((limit, offset) => `/api/reports/clicks?${qs({ ...baseParams, limit, offset })}`, 500);
      return { ...res, rows: res.rows.map(toExportRow) };
    });
  };

  return (
    <>
      <PageHeader title="Click Report" subtitle="Reporting › Click" />

      <ReportCard>
        <ReportControls problem={range.problem} actions={<>
          <ClearButton onClick={clearAll} title="Reset dates, filters and grouping" />
          <FiltersButton count={activeFilterCount} onClick={() => setFilterOpen((o) => !o)}>
            {filterOpen && (
              <ReportingFiltersFlyout sections={['filters']} singleSelect dimCategories={FILTER_CATEGORIES}
                value={{ ...EMPTY_REPORTING_FILTERS, filters }}
                onApply={(v) => { setFilters(v.filters); toFirstPage(); }} onClose={() => setFilterOpen(false)} />
            )}
          </FiltersButton>
        </>}>
          <DateRangeField idPrefix="click-report" from={from} to={to} max={todayStr()} invalid={range.problem !== null}
            onFrom={range.setFrom} onTo={range.setTo} />
          <ControlField label="Group By" htmlFor="click-report-group-by">
            <select id="click-report-group-by" className={`input ${CONTROL}`} value={groupBy} onChange={(e) => changeGroupBy(e.target.value)}>
              <option value="">None (individual clicks)</option>
              {GROUP_BY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </ControlField>
        </ReportControls>

        <ResultsBar title={groupBy ? `Clicks by ${groupByLabel(groupBy)}` : 'Detailed Report'} loading={isLoading} actions={<>
          {/* min-w-0 / max-w: the long "Auto — …" option text truncates instead of stretching the bar. */}
          {!groupBy && <div className="min-w-0 max-w-full"><TimeZoneSelect zone={zone} selectClassName={`${CONTROL} min-w-0 max-w-full text-small sm:max-w-[22rem]`} /></div>}
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className={`input ${CONTROL} !pl-8 sm:!w-56`} placeholder="Search this page…" title="Filters only the rows on the current page"
              aria-label="Search this page" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="relative">
            <button type="button" title="Table Actions" aria-label="Table Actions" onClick={() => setTableActionsOpen((o) => !o)}
              className="grid h-10 w-10 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
              <MoreVertical size={15} />
            </button>
            {tableActionsOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated"
                onMouseLeave={() => { setTableActionsOpen(false); setExportOpen(false); }}>
                <div className="px-3 py-1 text-tiny font-semibold uppercase text-fg-secondary">Table Actions</div>
                <div className="relative" onMouseEnter={() => setExportOpen(true)}>
                  <button onClick={() => setExportOpen((s) => !s)} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                    Export <ChevronRight size={13} className="text-fg-muted" />
                  </button>
                  {exportOpen && (
                    <div className="absolute right-full top-0 mr-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                      <button disabled={exp.busy} onClick={() => { runExport('csv'); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle disabled:opacity-50">CSV</button>
                      <button disabled={exp.busy} onClick={() => { runExport('xlsx'); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle disabled:opacity-50">Excel</button>
                    </div>
                  )}
                </div>
                <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
                <button onClick={() => { setTableActionsOpen(false); setShowApiRequest(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Show API Request</button>
              </div>
            )}
          </div>
        </>}>
          {groupBy && (
            <>
              <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-subtle px-2.5 py-0.5 text-tiny text-fg">
                <span className="text-fg-muted">Grouped by:</span> <span className="font-medium">{groupByLabel(groupBy)}</span>
                <button type="button" onClick={showIndividualClicks} title="Show individual clicks" aria-label="Show individual clicks"
                  className="ml-0.5 text-fg-muted hover:text-fg"><X size={11} /></button>
              </span>
              <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={showIndividualClicks}>Show individual clicks</button>
              {activeFilterCount > 0 && <span className="mx-1 h-4 w-px bg-border" aria-hidden />}
            </>
          )}
          <ActiveFilterChips
            chips={chipsFromValues(FILTER_CATEGORIES, filters)}
            onRemove={(c) => { setFilters(withoutValue(filters, c.key, c.value)); toFirstPage(); }}
            onClearAll={() => { setFilters({}); toFirstPage(); }} />
        </ResultsBar>

        <ReportBody>
        <ExportStatus {...exp} onDismiss={exp.dismiss} />
        {displayError ? <StateBlock>{displayError}</StateBlock>
          // Grouped: a new grouping has different rows/labels, so show the spinner rather than stale groups.
          : groupBy ? (isLoading ? <StateBlock><Spinner /></StateBlock> : groupedRows.length > 0 ? (
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="premium-table">
              <thead>
                <tr>
                  <th >{groupByLabel(groupBy)}</th>
                  <th className="font-semibold text-right">Clicks</th>
                  <th className="font-semibold text-right">Conversions</th>
                  <th className="font-semibold text-right">Conv. Rate</th>
                  <th className="font-semibold text-right">Payout</th>
                  <th className="font-semibold text-right">Revenue</th>
                  <th className="font-semibold text-right">Profit</th>
                </tr>
              </thead>
              <tbody>
                {groupedRows.map((r) => (
                  <tr key={r.key} className="hover:bg-accent-subtle/40">
                    <td className="font-medium text-fg">{groupedLabel(r)}</td>
                    <td className="text-right tabular-nums">{r.clicks.toLocaleString()}</td>
                    <td className="text-right tabular-nums">{r.conversions.toLocaleString()}</td>
                    <td className="text-right tabular-nums">{r.cr.toFixed(2)}%</td>
                    <td className="text-right tabular-nums"><Money value={Number(r.payout)} rc={groupedCurrency(r)} breakdown={parseMoneyByCurrency(r.moneyByCurrency)} field="payout" /></td>
                    <td className="text-right tabular-nums"><Money value={Number(r.revenue)} rc={groupedCurrency(r)} breakdown={parseMoneyByCurrency(r.moneyByCurrency)} field="revenue" /></td>
                    <td className="text-right tabular-nums"><Money value={Number(r.profit)} rc={groupedCurrency(r)} breakdown={parseMoneyByCurrency(r.moneyByCurrency)} field="margin" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <StateBlock>No Record Found</StateBlock>)
          // Individual clicks. While a new request runs, the previous rows stay (dimmed) instead of
          // the table collapsing to a spinner and back.
          : !rows.length ? (isLoading ? <StateBlock><Spinner /></StateBlock> : <StateBlock>No Record Found</StateBlock>)
          : (
            <div className={`overflow-x-auto rounded-card border border-border transition-opacity ${isLoading ? 'opacity-60' : ''}`} aria-busy={isLoading}>
              <table className="premium-table">
                <thead>
                  <tr>
                    <th title={zone.tz}>Date <span className="font-normal normal-case opacity-80">({zone.label})</span></th>
                    {shown.has('Converted') && <th title="Has any conversion (approved, pending or rejected)">Converted</th>}
                    {shown.has('Offer') && <th >Offer</th>}
                    {shown.has('Partner') && <th >Partner</th>}
                    {shown.has('Country') && <th >Country</th>}
                    {shown.has('Region') && <th >Region</th>}
                    {shown.has('City') && <th >City</th>}
                    {shown.has('ISP') && <th >ISP</th>}
                    {shown.has('Device') && <th >Device</th>}
                    {shown.has('OS') && <th >OS</th>}
                    {shown.has('Browser') && <th >Browser</th>}
                    {shown.has('Unique') && <th >Unique</th>}
                    {shown.has('Fraud') && <th className="text-right font-semibold">Fraud</th>}
                    {shown.has('IP Address') && <th >IP Address</th>}
                    {shown.has('Sub1') && <th >Sub1</th>}
                    {shown.has('Sub2') && <th >Sub2</th>}
                    {shown.has('Sub3') && <th >Sub3</th>}
                    {shown.has('Sub4') && <th >Sub4</th>}
                    {shown.has('Sub5') && <th >Sub5</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.click_id} className="hover:bg-accent-subtle/40">
                      <td className="font-medium text-fg">{formatDate(r.created_at)}</td>
                      {shown.has('Converted') && <td className="px-4 py-3">{r.converted ? <Check size={15} className="text-success-text" /> : <span className="text-fg-muted">{DASH}</span>}</td>}
                      {shown.has('Offer') && <td className="px-4 py-3"><Link to={`/app/offers/${r.offer_id}`} className="text-accent-text hover:underline">{offerMap.get(r.offer_id) ?? r.offer_id}</Link></td>}
                      {shown.has('Partner') && <td className="px-4 py-3">{r.publisher_id ? <Link to={`/app/publishers/${r.publisher_id}`} className="text-accent-text hover:underline">{pubMap.get(r.publisher_id) ?? r.publisher_id}</Link> : DASH}</td>}
                      {shown.has('Country') && <td className="px-4 py-3" title={r.country ?? undefined}>{r.country ? countryName(r.country) : DASH}</td>}
                      {shown.has('Region') && <td className="px-4 py-3" title={r.region ?? undefined}>{regionLabel(r)}</td>}
                      {shown.has('City') && <td className="px-4 py-3">{r.city ?? DASH}</td>}
                      {shown.has('ISP') && <td className="px-4 py-3">{r.isp ?? DASH}</td>}
                      {shown.has('Device') && <td className="px-4 py-3 capitalize">{r.device ?? DASH}</td>}
                      {shown.has('OS') && <td className="px-4 py-3">{r.os ?? DASH}</td>}
                      {shown.has('Browser') && <td className="px-4 py-3">{r.browser ?? DASH}</td>}
                      {shown.has('Unique') && <td className="px-4 py-3">{r.is_unique ? 'Y' : 'N'}</td>}
                      {shown.has('Fraud') && <td className={`px-4 py-3 text-right ${r.fraud_score >= 40 ? 'text-danger-text' : r.fraud_score > 0 ? 'text-warning-text' : ''}`}>{r.fraud_score}</td>}
                      {shown.has('IP Address') && <td className="font-mono text-tiny">{r.ip ?? DASH}</td>}
                      {shown.has('Sub1') && <td className="px-4 py-3">{r.sub1 ?? DASH}</td>}
                      {shown.has('Sub2') && <td className="px-4 py-3">{r.sub2 ?? DASH}</td>}
                      {shown.has('Sub3') && <td className="px-4 py-3">{r.sub3 ?? DASH}</td>}
                      {shown.has('Sub4') && <td className="px-4 py-3">{r.sub4 ?? DASH}</td>}
                      {shown.has('Sub5') && <td className="px-4 py-3">{r.sub5 ?? DASH}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {/* Paging follows the loaded page, not "Search this page" (which can hide every row) — and stays
           reachable on an emptied later page so Previous still works. */}
        {!groupBy && !displayError && (filteredRows.length > 0 || page > 1) && (
          <div className="mt-3 flex items-center justify-end gap-3 text-tiny text-fg-secondary">
            <span>Page {page}</span>
            <div className="flex items-center gap-1">
              <button type="button" title="Previous page" disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))}
                className="grid h-7 w-7 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">
                <ChevronLeft size={14} />
              </button>
              <button type="button" title="Next page" disabled={!hasNextPage || isLoading} onClick={() => setPage(page + 1)}
                className="grid h-7 w-7 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
        </ReportBody>
      </ReportCard>

      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={[...ALL_COLUMNS]} hidden={hiddenColumns} onClose={() => setShowColumns(false)} reorderable={false} onApply={(_o, h) => setHiddenColumns(h)} />}
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`${groupBy ? '/api/reports/grouped' : '/api/reports/clicks'}?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, groupBy: groupBy || undefined, offer: offerIdFilter, advertiser: advertiserIdFilter, partner: publisherIdFilter, smartLink: smartLinkIdFilter, country: countryFilter, device: deviceFilter,
        conversionStatus: CONVERSION_STATUS_OPTIONS.find((o) => o.value === conversionStatusFilter)?.label,
      }} />}
    </>
  );
}
