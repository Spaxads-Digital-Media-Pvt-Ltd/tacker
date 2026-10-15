/**
 * Reporting › Click — the row-level click log (one row per click), backed by `GET /api/reports/clicks`
 * (api-backend/src/surfaces/dashboard/reports/detail-reports.ts), with an optional Group By mode on
 * `GET /api/reports/grouped`.
 *
 * Filters + columns live in one modal — "Apply filters to narrow down your results"
 * (clickReport/ClickFiltersModal.tsx; logic in lib/clickReportFilters.ts): Offer / Partner /
 * Advertiser / Smart Link / Country / Conversion Status, display Timezone, Click IDs (comma list),
 * IP address, Device, Visibility (Unique / Duplicate clicks → `isUnique`) and the "Click Report
 * Fields" checkbox list. The modal edits a draft; Apply commits it, Cancel / × / Escape discard it.
 * Every applied filter is a real request param (same names in the URL, so the address bar is the
 * shareable link) and applies in both the individual-clicks and Group By modes.
 *
 * Fields: the reference's field list is shown in full, but only fields with a real source can be
 * picked — `clicks` columns, or the network's own offers / partners / advertisers (Offer ID / Title,
 * Partner ID / Name / Company, Advertiser ID / Name). The rest (GAID, IDFA, landing page,
 * proxy, …) aren't tracked anywhere in this schema, so they're listed disabled ("not tracked") and
 * never faked. The selected fields drive the table, the CSV / Excel export and the `cols` URL param.
 *
 * Converted: a click is converted when it has ANY conversion (pending / rejected count too); the
 * Conversion Status filter narrows which clicks are listed. Group-By money is in each group's own
 * currency (`currencies` — lib/reportCurrency): a group mixing currencies shows "Mixed".
 *
 * Pagination is "has more" (overfetch by one row), not a numeric total — the shared API client
 * (lib/api.ts) discards the envelope's pagination metadata app-wide.
 *
 * No "Run Report": dates apply once they form a valid range (debounced), Group By / chips immediately,
 * the modal on Apply. The applied report is mirrored to the address bar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, MoreVertical, ChevronLeft, ChevronRight, Check, X } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { api } from '../../lib/api';
import { PageHeader, Spinner, StateBlock } from '../../shared-components/primitives/ui';
import { ApiRequestModal } from '../../shared-components/primitives/TableActionsKit';
import { DASH, DEVICE_OPTIONS, deviceLabel, fetchAllPages, useReportExport, ExportStatus } from '../../shared-components/primitives/ReportPageKit';
import { readUrlDate } from '../../lib/reportFilterState';
import { useAutoDateRange } from './reportView';
import { ReportCard, ReportControls, ControlField, DateRangeField, FiltersButton, ClearButton, ResultsBar, ReportBody } from '../../shared-components/primitives/ReportLayout';
import { REPORT_CONTROL as CONTROL } from '../../shared-components/primitives/reportControl';
import type { Advertiser, Offer, Publisher } from '../../types';
import { countryLabel, countryName, regionName, useRegions } from '../../data/geo';
import { formatDateTime } from '../../lib/datetime';
import { useReportZone } from '../../lib/useReportZone';
import { ActiveFilterChips } from '../../shared-components/primitives/ActiveFilterChips';
import { chipsFromValues, type ChipCategory } from '../../lib/filterChips';
import { CONVERSION_STATUS_OPTIONS } from '../../lib/reportStatusFilters';
import { parseMoneyByCurrency, resolveCurrency, withRowCurrency, type RowCurrency } from '../../lib/reportCurrency';
import { money } from '../../lib/reportMath';
import { displayBrowser, displayOs } from '../../lib/userAgentDisplay';
import { Money } from '../../shared-components/primitives/ReportMoney';
import {
  DEFAULT_FIELDS, EMPTY_CLICK_FILTERS, GROUPED_CONVERSIONS_NOTE, VISIBILITY_OPTIONS, appliedFilterCount, chipValues,
  exportRecord, fieldByKey, fieldsFromUrl, filtersFromUrl, groupDimensionHeader, toApiParams, visibleColumns, withoutChip,
  writeFieldsToUrl, writeFiltersToUrl, type ClickFilters,
} from '../../lib/clickReportFilters';
import { ClickFiltersModal, type ClickFiltersApply } from './clickReport/ClickFiltersModal';

interface SmartLink { id: string; ref?: number | string; name: string }
interface ClickRow {
  click_id: string; created_at: string; offer_id: string; publisher_id: string | null;
  smart_link_id: string | null; ip: string | null; country: string | null; region: string | null;
  city: string | null; isp: string | null; device: string | null; os: string | null; browser: string | null;
  is_unique: boolean; fraud_score: number; fraud_flags: string[];
  sub1: string | null; sub2: string | null; sub3: string | null; sub4: string | null; sub5: string | null;
  converted: boolean;
  // Newer API (absent from an older backend → shown as "—").
  referrer?: string | null; user_agent?: string | null; currency?: string | null;
  resolved_payout?: string | null; resolved_revenue?: string | null;
  source_id?: string | null; fbclid?: string | null; gclid?: string | null;
}
interface GroupedRow {
  key: string; id: number | null; label: string; currency: string;
  clicks: number; conversions: number; payout: string; revenue: string; profit: string; cr: number; epc: number;
  /** Distinct currencies of the group's money-bearing conversions (newer API) — see lib/reportCurrency. */
  currencies?: string[];
  /** Per-currency payout/revenue/margin (newer API) — a mixed group lists them in its "Mixed" tooltip. */
  moneyByCurrency?: unknown;
}
/** `/api/reports/grouped` totals across every group (same filters). */
interface GroupedTotals { clicks: number; conversions: number; payout: string; revenue: string; profit: string; currencies?: string[]; moneyByCurrency?: unknown }
/** A group's money currency: its conversions' one currency, "mixed", or (none / older API) `currency`. */
const groupedCurrency = (r: GroupedRow): RowCurrency => resolveCurrency(r.currencies, r.currency || 'USD');

/** `/api/reports/grouped` groupings ('' = individual clicks via `/api/reports/clicks`). */
const GROUP_BY_OPTIONS = [
  { value: 'offer', label: 'Offer' }, { value: 'publisher', label: 'Partner' }, { value: 'advertiser', label: 'Advertiser' },
  { value: 'day', label: 'Day' }, { value: 'country', label: 'Country' }, { value: 'device', label: 'Device' },
] as const;
const groupByLabel = (g: string) => GROUP_BY_OPTIONS.find((o) => o.value === g)?.label ?? g;

const URL_OPTS = { conversionStatuses: CONVERSION_STATUS_OPTIONS.map((o) => o.value), devices: DEVICE_OPTIONS.map((o) => o.value) };

/** Applied report state from the URL (reload / shared link / legacy deep links). */
function readInitialState() {
  const sp = new URLSearchParams(window.location.search);
  const gb = sp.get('groupBy') ?? '';
  return {
    // '' = the report zone's default range, filled in by the page (it knows the zone).
    from: readUrlDate(sp, 'from', ''),
    to: readUrlDate(sp, 'to', ''),
    groupBy: GROUP_BY_OPTIONS.some((o) => o.value === gb) ? gb : '',
    filters: filtersFromUrl(sp, URL_OPTS),
    fields: fieldsFromUrl(sp) ?? [...DEFAULT_FIELDS],
  };
}

const RIGHT = new Set(['fraudScore', 'payout', 'revenue']);
const MONO = new Set(['clickId', 'ip', 'smartLinkId', 'userAgent', 'referer', 'fbClickId', 'googleClickId']);

export default function ClickReport() {
  const [init] = useState(readInitialState);
  const [, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<ClickFilters>(init.filters);
  // D7: the report's time zone — the network's unless one is picked: its days, "today" and the times
  // shown (a Country filter adds that country's zones to the picker's suggestions).
  const zone = useReportZone(filters.country || null);
  // Dates apply on their own once they form a valid range (see useAutoDateRange); everything else
  // applies on Apply / immediately and returns to page 1.
  const [initRange] = useState(() => ({ from: init.from || zone.daysAgo(7), to: init.to || zone.today() }));
  const range = useAutoDateRange(initRange.from, initRange.to);
  const { from, to, appliedFrom, appliedTo, page, setPage, toFirstPage } = range;

  const [fields, setFields] = useState<string[]>(init.fields);
  const [groupBy, setGroupBy] = useState(init.groupBy);
  const [modal, setModal] = useState<null | 'filters' | 'fields'>(null);
  const [q, setQ] = useState('');
  const pageSize = 25;
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [showApiRequest, setShowApiRequest] = useState(false);
  const exp = useReportExport();
  // Table Actions closes on an outside click / tap or Escape (mouse-leave alone never fires on touch
  // screens and leaves keyboard users without a way out) — same as the other report pages.
  const tableActionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tableActionsOpen) return;
    const close = () => { setTableActionsOpen(false); setExportOpen(false); };
    const onDown = (e: PointerEvent) => { if (!tableActionsRef.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [tableActionsOpen]);

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

  const offerById = useMemo(() => new Map((offers ?? []).map((o) => [o.id, o])), [offers]);
  const pubById = useMemo(() => new Map((publishers ?? []).map((p) => [p.id, p])), [publishers]);
  const advById = useMemo(() => new Map((advertisers ?? []).map((a) => [a.id, a])), [advertisers]);
  const slById = useMemo(() => new Map((smartLinks ?? []).map((s) => [s.id, s])), [smartLinks]);

  const pickerOptions = useMemo(() => ({
    offers: (offers ?? []).map((o) => ({ value: o.id, label: o.ref != null ? `(${o.ref}) ${o.name}` : o.name })),
    partners: (publishers ?? []).map((p) => ({ value: p.id, label: p.ref != null ? `(${p.ref}) ${p.name}` : p.name })),
    advertisers: (advertisers ?? []).map((a) => ({ value: a.id, label: a.ref != null ? `(${a.ref}) ${a.name}` : a.name })),
    smartLinks: (smartLinks ?? []).map((s) => ({ value: s.id, label: s.ref != null ? `(${s.ref}) ${s.name}` : s.name })),
  }), [offers, publishers, advertisers, smartLinks]);

  // Chip labels per filter (the modal's options; click IDs / IP show their own value).
  const CHIP_CATEGORIES: ChipCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: pickerOptions.offers },
    { key: 'partner', label: 'Partner', options: pickerOptions.partners },
    { key: 'advertiser', label: 'Advertiser', options: pickerOptions.advertisers },
    { key: 'smartLink', label: 'Smart Link', options: pickerOptions.smartLinks },
    { key: 'country', label: 'Country', options: countryOptions },
    { key: 'device', label: 'Device', options: DEVICE_OPTIONS },
    { key: 'conversionStatus', label: 'Conversion Status', options: [...CONVERSION_STATUS_OPTIONS] },
    { key: 'visibility', label: 'Visibility', options: VISIBILITY_OPTIONS },
    { key: 'clickIds', label: 'Click ID' },
    { key: 'ip', label: 'IP' },
    { key: 'sourceId', label: 'Source' },
    { key: 'fbclid', label: 'FB Click ID' },
    { key: 'gclid', label: 'Google Click ID' },
  ], [pickerOptions, countryOptions]);

  const regions = useRegions();
  const formatDate = (iso: string) => formatDateTime(iso, zone.tz);
  const regionLabel = (r: ClickRow) => (r.region ? (regionName(regions, r.region, r.country) ?? r.region) : DASH);

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };

  // Keys shared by /clicks and /grouped (both accept exactly these).
  const baseParams = { ...zone.range(appliedFrom, appliedTo), ...toApiParams(filters) };
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
    writeFiltersToUrl(next, filters);
    writeFieldsToUrl(next, fields);
    return next.toString();
  }, [appliedFrom, appliedTo, groupBy, filters, fields]);
  useEffect(() => {
    if (window.location.search.replace(/^\?/, '') !== urlState) setSearchParams(new URLSearchParams(urlState), { replace: true });
  }, [urlState, setSearchParams]);
  // /grouped returns { rows, totals } — rows keyed by `key`.
  const groupedQ = useQuery<{ rows: GroupedRow[]; totals?: GroupedTotals }>(groupedPath);
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
  // Totals over ALL groups (from the API, so "Search groups…" narrowing the visible rows doesn't change them).
  const groupedTotals = groupBy && !groupedQ.error ? groupedQ.data?.totals ?? null : null;
  const isLoading = groupBy ? groupedQ.loading : rowQ.loading;
  const activeFilterCount = appliedFilterCount(filters);
  const displayError = groupBy ? groupedQ.error : rowQ.error;
  const hasNextPage = !groupBy && (rowQ.data?.length ?? 0) > pageSize;

  const offerName = (id: string) => offerById.get(id)?.name ?? id;
  const pubName = (id: string | null) => (id ? (pubById.get(id)?.name ?? id) : '');
  const searchNeedle = q.trim().toLowerCase();
  const groupedLabel = (r: GroupedRow) => (r.key === '~none~' ? r.label
    : groupBy === 'country' ? countryLabel(r.key) : groupBy === 'device' ? deviceLabel(r.key) : r.label);
  const groupedRows = searchNeedle
    ? allGroupedRows.filter((r) => groupedLabel(r).toLowerCase().includes(searchNeedle))
    : allGroupedRows;
  const rows = useMemo(() => filteredRows.filter((r) => {
    if (!searchNeedle) return true;
    return [offerById.get(r.offer_id)?.name, r.publisher_id ? pubById.get(r.publisher_id)?.name : null, r.country,
      r.country ? countryName(r.country) : null, r.city, r.ip, r.click_id, r.sub1, r.sub2, r.sub3, r.sub4, r.sub5, r.source_id]
      .some((v) => (v ?? '').toLowerCase().includes(searchNeedle));
  }), [filteredRows, searchNeedle, offerById, pubById]);

  // Reset dates, filters and grouping in one render → one request. The debounced range catches up to
  // the same values later and is then a no-op. Selected fields are a view preference and stay.
  const clearAll = () => { range.reset({ from: zone.daysAgo(7), to: zone.today() }); setFilters(EMPTY_CLICK_FILTERS); setGroupBy(''); };
  const changeGroupBy = (g: string) => { setGroupBy(g); toFirstPage(); };
  const showIndividualClicks = () => changeGroupBy('');
  const applyModal = (next: ClickFiltersApply) => {
    setFilters(next.filters);
    setFields(next.fields);
    if ((next.timezone || null) !== zone.override) zone.setOverride(next.timezone || null);
    toFirstPage();
    setModal(null);
  };
  const closeModal = useCallback(() => setModal(null), []);

  // ONE ordered column list drives <thead>, <tbody> and the export, so they can't drift apart.
  const columns = useMemo(() => visibleColumns(fields), [fields]);

  /** Plain-text value of one field for a row (table cells without links, and exports). */
  const textValue = (r: ClickRow, key: string): string | number => {
    const offer = offerById.get(r.offer_id);
    const pub = r.publisher_id ? pubById.get(r.publisher_id) : undefined;
    const adv = offer ? advById.get(offer.advertiserId) : undefined;
    const sl = r.smart_link_id ? slById.get(r.smart_link_id) : undefined;
    const cur = r.currency ?? null;
    const amt = (v: string | null | undefined) => (v == null ? DASH : cur ? money(Number(v), cur) : v);
    switch (key) {
      case 'createdDate': return formatDate(r.created_at);
      case 'converted': return r.converted ? 'Yes' : 'No';
      case 'clickId': return r.click_id;
      case 'offerId': return offer?.ref != null ? String(offer.ref) : r.offer_id;
      case 'offerTitle': return offerName(r.offer_id);
      case 'partnerId': return r.publisher_id ? (pub?.ref != null ? String(pub.ref) : r.publisher_id) : DASH;
      case 'partnerName': return pub?.contactName || DASH;
      case 'partnerCompany': return r.publisher_id ? pubName(r.publisher_id) : DASH;
      case 'smartLinkId': return r.smart_link_id ? (sl?.ref != null ? String(sl.ref) : r.smart_link_id) : DASH;
      case 'advertiserId': return adv?.ref != null ? String(adv.ref) : (offer?.advertiserId ?? DASH);
      case 'advertiserName': return adv?.name ?? DASH;
      case 'ip': return r.ip ?? DASH;
      case 'country': return r.country ? countryName(r.country) : DASH;
      case 'region': return regionLabel(r);
      case 'city': return r.city ?? DASH;
      case 'isp': return r.isp ?? DASH;
      case 'device': return r.device ?? DASH;
      // As much precision as the request carried (reduced User-Agent) — lib/userAgentDisplay.
      case 'browser': return displayBrowser(r.browser).text ?? DASH;
      case 'os': return displayOs(r.os, r.user_agent).text ?? DASH;
      case 'userAgent': return r.user_agent ?? DASH;
      case 'referer': return r.referrer ?? DASH;
      // Click-URL values (?source_id|source|src, ?fbclid, ?gclid) — "—" when the click URL had none.
      case 'source': return r.source_id ?? DASH;
      case 'fbClickId': return r.fbclid ?? DASH;
      case 'googleClickId': return r.gclid ?? DASH;
      case 'isUnique': return r.is_unique ? 'Y' : 'N';
      case 'currency': return cur ?? DASH;
      case 'payout': return amt(r.resolved_payout);
      case 'revenue': return amt(r.resolved_revenue);
      case 'fraudScore': return r.fraud_score;
      case 'sub1': return r.sub1 ?? DASH;
      case 'sub2': return r.sub2 ?? DASH;
      case 'sub3': return r.sub3 ?? DASH;
      case 'sub4': return r.sub4 ?? DASH;
      case 'sub5': return r.sub5 ?? DASH;
      default: return DASH;
    }
  };
  /** Export value: money as plain decimal text (spreadsheets stay numeric), the rest as shown. */
  const exportValue = (r: ClickRow, key: string): string | number => {
    if (key === 'payout') return r.resolved_payout ?? DASH;
    if (key === 'revenue') return r.resolved_revenue ?? DASH;
    return textValue(r, key);
  };

  const headerCell = (key: string) => {
    const f = fieldByKey(key)!;
    if (key === 'createdDate') return <th key={key} title={zone.tz}>{f.label} <span className="font-normal normal-case opacity-80">({zone.label})</span></th>;
    return <th key={key} title={f.hint} className={RIGHT.has(key) ? 'text-right font-semibold' : undefined}>{f.label}</th>;
  };
  const bodyCell = (r: ClickRow, key: string) => {
    switch (key) {
      case 'createdDate': return <td key={key} className="whitespace-nowrap font-medium text-fg">{formatDate(r.created_at)}</td>;
      case 'converted': return <td key={key} className="px-4 py-3">{r.converted ? <Check size={15} className="text-success-text" aria-label="Converted" /> : <span className="text-fg-muted">{DASH}</span>}</td>;
      case 'offerTitle': return <td key={key} className="px-4 py-3"><Link to={`/app/offers/${r.offer_id}`} className="text-accent-text hover:underline">{offerName(r.offer_id)}</Link></td>;
      case 'partnerCompany': return <td key={key} className="px-4 py-3">{r.publisher_id ? <Link to={`/app/publishers/${r.publisher_id}`} className="text-accent-text hover:underline">{pubName(r.publisher_id)}</Link> : DASH}</td>;
      case 'country': return <td key={key} className="px-4 py-3" title={r.country ?? undefined}>{textValue(r, key)}</td>;
      case 'region': return <td key={key} className="px-4 py-3" title={r.region ?? undefined}>{textValue(r, key)}</td>;
      case 'device': return <td key={key} className="px-4 py-3 capitalize">{textValue(r, key)}</td>;
      case 'browser': return <td key={key} className="px-4 py-3" title={displayBrowser(r.browser).note}>{textValue(r, key)}</td>;
      case 'os': return <td key={key} className="px-4 py-3" title={displayOs(r.os, r.user_agent).note}>{textValue(r, key)}</td>;
      case 'fraudScore': return <td key={key} className={`px-4 py-3 text-right ${r.fraud_score >= 40 ? 'text-danger-text' : r.fraud_score > 0 ? 'text-warning-text' : ''}`}>{r.fraud_score}</td>;
      case 'userAgent': case 'referer': {
        const v = String(textValue(r, key));
        return <td key={key} className="max-w-xs truncate px-4 py-3 font-mono text-tiny" title={v}>{v}</td>;
      }
      default:
        return <td key={key} className={`px-4 py-3 ${RIGHT.has(key) ? 'text-right tabular-nums' : ''} ${MONO.has(key) ? 'font-mono text-tiny' : ''}`}>{textValue(r, key)}</td>;
    }
  };

  // Every row matching the applied filters (not just this page), exactly the selected columns in table
  // order; grouped mode exports the groups, fetched for the applied filters at export time (the
  // table's `groupedQ.data` still holds the previous filters' groups while a new request is in flight).
  const runExport = (format: 'csv' | 'xlsx') => {
    if (groupBy) {
      void exp.run(format, `click-report-by-${groupBy}`, async () => ({
        // Money in the group's currency — "MIXED" with payout/revenue/profit left empty when it mixes currencies.
        rows: ((await api.get<{ rows: GroupedRow[] }>(`/api/reports/grouped?${qs({ groupBy, ...baseParams })}`))?.rows ?? []).map((r) => withRowCurrency({
          [groupDimensionHeader(groupBy, groupByLabel(groupBy), zone.short).label]: groupedLabel(r), clicks: r.clicks, conversions: r.conversions,
          cr: `${r.cr.toFixed(2)}%`, payout: r.payout, revenue: r.revenue, profit: r.profit,
        }, groupedCurrency(r), ['payout', 'revenue', 'profit'])),
      }));
      return;
    }
    const cols = columns;
    const params = baseParams;
    void exp.run(format, 'click-report', async () => {
      const res = await fetchAllPages<ClickRow>((limit, offset) => `/api/reports/clicks?${qs({ ...params, limit, offset })}`, 500);
      return {
        ...res,
        rows: res.rows.map((r) => ({
          ...exportRecord(cols, (k) => exportValue(r, k)),
          ...(cols.includes('createdDate') ? { Timezone: zone.tz } : {}),
        })),
      };
    });
  };

  const chips = chipsFromValues(CHIP_CATEGORIES, chipValues(filters));

  return (
    <>
      <PageHeader title="Click Report" subtitle="Reporting › Click" />

      <ReportCard>
        <ReportControls problem={range.problem} actions={<>
          <ClearButton onClick={clearAll} title="Reset dates, filters and grouping" />
          <FiltersButton count={activeFilterCount} onClick={() => setModal((m) => (m ? null : 'filters'))} />
        </>}>
          <DateRangeField idPrefix="click-report" from={from} to={to} max={zone.today()} invalid={range.problem !== null}
            onFrom={range.setFrom} onTo={range.setTo} zone={zone} />
          <ControlField label="Group By" htmlFor="click-report-group-by">
            <select id="click-report-group-by" className={`input ${CONTROL}`} value={groupBy} onChange={(e) => changeGroupBy(e.target.value)}>
              <option value="">None (individual clicks)</option>
              {GROUP_BY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </ControlField>
        </ReportControls>

        <ResultsBar title={groupBy ? `Clicks by ${groupByLabel(groupBy)}` : 'Detailed Report'} loading={isLoading} actions={<>
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            {/* Grouped mode loads every group, so its search covers them all; individual clicks are paged. */}
            <input className={`input ${CONTROL} !pl-8 sm:!w-56`} placeholder={groupBy ? 'Search groups…' : 'Search this page…'}
              title={groupBy ? 'Filters the groups by name' : 'Filters only the rows on the current page'}
              aria-label={groupBy ? 'Search groups' : 'Search this page'} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="relative" ref={tableActionsRef}>
            <button type="button" title="Table Actions" aria-label="Table Actions" aria-haspopup="menu" aria-expanded={tableActionsOpen}
              onClick={() => setTableActionsOpen((o) => !o)}
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
                {/* One column picker: the filter modal's "Click Report Fields" section. */}
                <button onClick={() => { setTableActionsOpen(false); setModal('fields'); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
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
            chips={chips}
            onRemove={(c) => { setFilters((f) => withoutChip(f, c.key, c.value)); toFirstPage(); }}
            onClearAll={() => { setFilters(EMPTY_CLICK_FILTERS); toFirstPage(); }} />
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
                  <th scope="col" title={groupDimensionHeader(groupBy, groupByLabel(groupBy), zone.short).title}>{groupDimensionHeader(groupBy, groupByLabel(groupBy), zone.short).label}</th>
                  <th scope="col" className="font-semibold text-right">Clicks</th>
                  <th scope="col" className="font-semibold text-right" title={GROUPED_CONVERSIONS_NOTE}>Conversions</th>
                  <th scope="col" className="font-semibold text-right" title={`Conversions ÷ clicks — ${GROUPED_CONVERSIONS_NOTE.toLowerCase()}`}>Conv. Rate</th>
                  <th scope="col" className="font-semibold text-right" title={GROUPED_CONVERSIONS_NOTE}>Payout</th>
                  <th scope="col" className="font-semibold text-right" title={GROUPED_CONVERSIONS_NOTE}>Revenue</th>
                  <th scope="col" className="font-semibold text-right" title={GROUPED_CONVERSIONS_NOTE}>Profit</th>
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
              {groupedTotals && (() => {
                // Every group (not just the ones "Search groups…" leaves visible); money per currency when mixed.
                const rc = resolveCurrency(groupedTotals.currencies, allGroupedRows[0]?.currency || 'USD');
                const breakdown = parseMoneyByCurrency(groupedTotals.moneyByCurrency);
                const cr = groupedTotals.clicks > 0 ? (groupedTotals.conversions / groupedTotals.clicks) * 100 : 0;
                return (
                  <tfoot>
                    <tr className="border-t-2 border-border font-semibold text-fg">
                      <th scope="row" className="text-left" title={searchNeedle ? 'Totals of every group, including ones hidden by the search' : undefined}>
                        Total{searchNeedle ? ' (all groups)' : ''}
                      </th>
                      <td className="text-right tabular-nums">{groupedTotals.clicks.toLocaleString()}</td>
                      <td className="text-right tabular-nums">{groupedTotals.conversions.toLocaleString()}</td>
                      <td className="text-right tabular-nums">{cr.toFixed(2)}%</td>
                      <td className="text-right tabular-nums"><Money value={Number(groupedTotals.payout)} rc={rc} breakdown={breakdown} field="payout" /></td>
                      <td className="text-right tabular-nums"><Money value={Number(groupedTotals.revenue)} rc={rc} breakdown={breakdown} field="revenue" /></td>
                      <td className="text-right tabular-nums"><Money value={Number(groupedTotals.profit)} rc={rc} breakdown={breakdown} field="margin" /></td>
                    </tr>
                  </tfoot>
                );
              })()}
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
                  <tr>{columns.map(headerCell)}</tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.click_id} className="hover:bg-accent-subtle/40">{columns.map((k) => bodyCell(r, k))}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {/* Paging follows the loaded page, not "Search this page" (which can hide every row) — and stays
           reachable on an emptied later page so Previous still works. */}
        {!groupBy && !displayError && (filteredRows.length > 0 || page > 1) && (
          <div className="mt-3 flex items-center justify-end gap-3 text-tiny text-fg-secondary">
            <span aria-live="polite">Page {page}</span>
            <div className="flex items-center gap-1">
              <button type="button" title="Previous page" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))}
                className="grid h-7 w-7 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">
                <ChevronLeft size={14} />
              </button>
              <button type="button" title="Next page" aria-label="Next page" disabled={!hasNextPage || isLoading} onClick={() => setPage(page + 1)}
                className="grid h-7 w-7 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
        </ReportBody>
      </ReportCard>

      {modal && (
        <ClickFiltersModal
          applied={filters} appliedCount={activeFilterCount} timezone={zone.override ?? ''} fields={fields} zone={zone}
          offers={pickerOptions.offers} partners={pickerOptions.partners} advertisers={pickerOptions.advertisers}
          smartLinks={pickerOptions.smartLinks} countries={countryOptions} devices={DEVICE_OPTIONS}
          conversionStatuses={CONVERSION_STATUS_OPTIONS} groupMode={groupBy !== ''} focusFields={modal === 'fields'}
          onApply={applyModal} onClose={closeModal} />
      )}
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`${groupBy ? '/api/reports/grouped' : '/api/reports/clicks'}?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, groupBy: groupBy || undefined,
        offer: filters.offer || undefined, advertiser: filters.advertiser || undefined, partner: filters.partner || undefined,
        smartLink: filters.smartLink || undefined, country: filters.country || undefined, device: filters.device || undefined,
        conversionStatus: CONVERSION_STATUS_OPTIONS.find((o) => o.value === filters.conversionStatus)?.label,
        clickIds: filters.clickIds.length ? `${filters.clickIds.length} ID${filters.clickIds.length === 1 ? '' : 's'}` : undefined,
        ip: filters.ip || undefined,
        source: filters.sourceId || undefined, fbClickId: filters.fbclid || undefined, googleClickId: filters.gclid || undefined,
        visibility: filters.visibility !== 'all' ? VISIBILITY_OPTIONS.find((o) => o.value === filters.visibility)?.label : undefined,
      }} />}
    </>
  );
}
