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
 * mirrors the reference's real "Converted" column) and `smart_link_id` in the row payload.
 *
 * Columns shown are a reduced, fully-backed subset of the reference's ~45 (Date, Converted, Offer,
 * Partner, Country, Region, City, ISP, Device, OS, Browser, Unique, Fraud, IP Address, Sub1-5) —
 * the reference's IDFA/Google Ad ID/Android ID/ZIP/Language/Platform/Brand/Proxy/Test Mode/Project
 * ID/etc. have no real source anywhere in this schema, so they're omitted rather than faked.
 *
 * Pagination here is "has more" (overfetch by one row), not a numeric total — the shared API client
 * (lib/api.ts) discards the response envelope's pagination metadata app-wide, and plumbing a real
 * total through it is a bigger, riskier change than this page warrants.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, MoreVertical, ChevronLeft, ChevronRight, Check, SlidersHorizontal, X } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../shared-components/primitives/ui';
import { CategoryFilterDrawer, type FilterCategory, type FilterValues } from '../../shared-components/primitives/CategoryFilterDrawer';
import { ColumnsModal, ApiRequestModal } from '../../shared-components/primitives/TableActionsKit';
import { daysAgo, todayStr, toIso, DASH, DEVICE_OPTIONS, deviceLabel, fetchAllPages, useReportExport, ExportStatus } from '../../shared-components/primitives/ReportPageKit';
import { readUrlDate, readUrlIds, reportLink } from '../../lib/reportFilterState';
import type { Advertiser, Offer, Publisher } from '../../types';
import { countryLabel, countryName, regionName, useRegions } from '../../data/geo';
import { formatDateTime } from '../../lib/datetime';
import { TimeZoneSelect } from '../../shared-components/primitives/ReportTimeZone';
import { useReportTimeZone } from '../../lib/useReportTimeZone';
import { ActiveFilterChips } from '../../shared-components/primitives/ActiveFilterChips';
import { chipsFromValues, withoutValue } from '../../lib/filterChips';

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
}

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

/** Applied report state from the URL (Copy Link / reload / legacy deep links). */
function readInitialState() {
  const sp = new URLSearchParams(window.location.search);
  const gb = sp.get('groupBy') ?? '';
  const filters: FilterValues = {};
  for (const [cat, param] of URL_FILTER_PARAMS) {
    const ids = readUrlIds(sp, param).slice(0, 1); // the drawer is single-select per category
    if (ids.length) filters[cat] = ids;
  }
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
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [appliedFrom, setAppliedFrom] = useState(init.from);
  const [appliedTo, setAppliedTo] = useState(init.to);
  const [filters, setFilters] = useState<Record<string, string[]>>(init.filters);
  const [appliedFilters, setAppliedFilters] = useState<Record<string, string[]>>(init.filters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [hasRun, setHasRun] = useState(true);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [showApiRequest, setShowApiRequest] = useState(false);
  const [copied, setCopied] = useState(false);
  // Draft (the Group By select) vs applied (what the table shows) — applied on Run Report.
  const [groupByDraft, setGroupByDraft] = useState(init.groupBy);
  const [groupBy, setGroupBy] = useState(init.groupBy);
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
  ], [offers, advertisers, publishers, smartLinks, countryOptions]);

  const offerIdFilter = appliedFilters['offer']?.[0];
  const advertiserIdFilter = appliedFilters['advertiser']?.[0];
  const publisherIdFilter = appliedFilters['partner']?.[0];
  const smartLinkIdFilter = appliedFilters['smartLink']?.[0];
  const countryFilter = appliedFilters['country']?.[0];
  const deviceFilter = appliedFilters['device']?.[0];
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
    country: countryFilter, device: deviceFilter,
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
    for (const [cat, param] of URL_FILTER_PARAMS) { const v = appliedFilters[cat]?.[0]; if (v) next.set(param, v); }
    return next.toString();
  }, [appliedFrom, appliedTo, groupBy, appliedFilters]);
  useEffect(() => {
    if (window.location.search.replace(/^\?/, '') !== urlState) setSearchParams(new URLSearchParams(urlState), { replace: true });
  }, [urlState, setSearchParams]);
  // /grouped returns { rows, totals } — rows keyed by `key`.
  const groupedQ = useQuery<{ rows: GroupedRow[] }>(hasRun && groupedPath ? groupedPath : null);
  const rowQ = useQuery<ClickRow[]>(hasRun && rowPath ? rowPath : null);

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

  const runReport = () => {
    setAppliedFrom(from); setAppliedTo(to); setAppliedFilters(filters); setGroupBy(groupByDraft);
    setHasRun(true); setPage(1);
  };
  const clearAll = () => {
    setFrom(daysAgo(7)); setTo(todayStr()); setFilters({});
    setAppliedFrom(daysAgo(7)); setAppliedTo(todayStr()); setAppliedFilters({});
    setGroupByDraft(''); setGroupBy('');
    setPage(1);
  };
  const showIndividualClicks = () => { setGroupByDraft(''); setGroupBy(''); setPage(1); };

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
  // Every row matching the applied filters (not just this page); grouped mode exports the groups.
  const runExport = (format: 'csv' | 'xlsx') => {
    if (groupBy) {
      void exp.run(format, `click-report-by-${groupBy}`, async () => ({
        rows: allGroupedRows.map((r) => ({
          [groupByLabel(groupBy)]: groupedLabel(r), clicks: r.clicks, conversions: r.conversions,
          cr: `${r.cr.toFixed(2)}%`, payout: r.payout, revenue: r.revenue, profit: r.profit,
        })),
      }));
      return;
    }
    void exp.run(format, 'click-report', async () => {
      const res = await fetchAllPages<ClickRow>((limit, offset) => `/api/reports/clicks?${qs({ ...baseParams, limit, offset })}`, 500);
      return { ...res, rows: res.rows.map(toExportRow) };
    });
  };

  const copyLink = async () => {
    // The link carries the applied report (dates, filters, grouping) — the page reads these back on load.
    const link = reportLink({
      from: appliedFrom, to: appliedTo, groupBy: groupBy || undefined, offerId: offerIdFilter, advertiserId: advertiserIdFilter,
      publisherId: publisherIdFilter, smartLinkId: smartLinkIdFilter, country: countryFilter, device: deviceFilter,
    });
    await navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <>
      <PageHeader title="Click Report" subtitle="Reporting › Click" action={
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { copyLink(); }} className="text-small font-medium text-accent-text hover:underline">{copied ? 'Copied!' : 'Copy Link'}</button>
          <button type="button" title="Show API Request" onClick={() => setShowApiRequest(true)}
            className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <MoreVertical size={15} />
          </button>
        </div>
      } />

      <div className="card mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">From (UTC)</label>
            <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To (UTC)</label>
            <input type="date" className="input" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="relative">
            <button type="button" onClick={() => setFilterOpen((o) => !o)}
              className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg relative">
              <SlidersHorizontal size={15} />
              {Object.values(appliedFilters).reduce((n, arr) => n + (arr?.length ?? 0), 0) > 0 && (
                <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                  {Object.values(appliedFilters).reduce((n, arr) => n + (arr?.length ?? 0), 0)}
                </span>
              )}
            </button>
            {filterOpen && (
              <CategoryFilterDrawer categories={FILTER_CATEGORIES} values={filters} singleSelectKeys={FILTER_CATEGORIES.map((c) => c.key)}
                onApply={setFilters} onClose={() => setFilterOpen(false)} />
            )}
          </div>
          <div>
            <label className="label" htmlFor="click-report-group-by">Group By</label>
            <select id="click-report-group-by" className="input" value={groupByDraft} onChange={(e) => setGroupByDraft(e.target.value)}>
              <option value="">None (individual clicks)</option>
              {GROUP_BY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <button type="button" className="text-small font-medium text-accent-text hover:underline" onClick={clearAll}>Clear</button>
          <div className="flex-1" />
          <button type="button" className="btn-primary" onClick={runReport}>Run Report</button>
        </div>
      </div>

      <div className="card">
        <ActiveFilterChips className="mb-3"
          chips={chipsFromValues(FILTER_CATEGORIES, appliedFilters)}
          onRemove={(c) => { const n = withoutValue(appliedFilters, c.key, c.value); setFilters(n); setAppliedFilters(n); setPage(1); }}
          onClearAll={() => { setFilters({}); setAppliedFilters({}); setPage(1); }} />
        {groupBy && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-small">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-accent-subtle px-2.5 py-1 text-fg">
              Grouped by {groupByLabel(groupBy)}
              <button type="button" onClick={showIndividualClicks} title="Show individual clicks" aria-label="Show individual clicks"
                className="text-fg-muted hover:text-fg"><X size={13} /></button>
            </span>
            <button type="button" className="font-medium text-accent-text hover:underline" onClick={showIndividualClicks}>Show individual clicks</button>
          </div>
        )}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-h3 font-medium text-fg">{groupBy ? `Clicks by ${groupByLabel(groupBy)}` : 'Detailed Report'}</h3>
          <div className="flex flex-wrap items-center gap-2">
            {!groupBy && <TimeZoneSelect zone={zone} />}
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input className="input !w-56 !pl-8" placeholder="Search this page…" title="Filters only the rows on the current page"
                value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="relative">
              <button type="button" title="Table Actions" onClick={() => setTableActionsOpen((o) => !o)}
                className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
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
                </div>
              )}
            </div>
          </div>
        </div>

        <ExportStatus {...exp} onDismiss={exp.dismiss} />
        {groupBy && !isLoading && !displayError && groupedRows.length > 0 ? (
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
                    <td className="text-right tabular-nums">{r.payout}</td>
                    <td className="text-right tabular-nums">{r.revenue}</td>
                    <td className="text-right tabular-nums">{r.profit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : groupBy && isLoading ? <StateBlock><Spinner /></StateBlock>
          : groupBy && displayError ? <StateBlock>{displayError}</StateBlock>
          : groupBy && !groupedRows.length ? <StateBlock>No Record Found</StateBlock>
          : !hasRun ? <StateBlock>Set parameters and run report</StateBlock>
          : isLoading ? <StateBlock><Spinner /></StateBlock>
          : displayError ? <StateBlock>{displayError}</StateBlock>
          : !rows.length ? <StateBlock>No Record Found</StateBlock>
          : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th title={zone.tz}>Date <span className="font-normal normal-case opacity-80">({zone.label})</span></th>
                    {shown.has('Converted') && <th >Converted</th>}
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
        {!groupBy && hasRun && !displayError && rows.length > 0 && (
          <div className="mt-3 flex items-center justify-end gap-3 text-tiny text-fg-secondary">
            <span>Page {page}</span>
            <div className="flex items-center gap-1">
              <button type="button" title="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="grid h-7 w-7 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">
                <ChevronLeft size={14} />
              </button>
              <button type="button" title="Next page" disabled={!hasNextPage} onClick={() => setPage((p) => p + 1)}
                className="grid h-7 w-7 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={[...ALL_COLUMNS]} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(_o, h) => setHiddenColumns(h)} />}
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`${groupBy ? '/api/reports/grouped' : '/api/reports/clicks'}?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, groupBy: groupBy || undefined, offer: offerIdFilter, advertiser: advertiserIdFilter, partner: publisherIdFilter, smartLink: smartLinkIdFilter, country: countryFilter, device: deviceFilter,
      }} />}
    </>
  );
}
