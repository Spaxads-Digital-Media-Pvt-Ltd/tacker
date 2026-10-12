/**
 * Reporting › Offer — verified item-by-item against the live reference, including the full Summary
 * tile set (21 tiles), the full Detailed Report column set (14 metric columns — Margin/RPC/RPA are
 * Summary-only in the reference, not table columns), and the "Reporting Filters" flyout structure.
 *
 * Gross Clicks / Clicks (net of fraud-flagged) / Dup. Clicks / Invalid Clicks / Total CV (all
 * statuses) / CV (approved only) all derive from real columns (`clicks.is_unique`,
 * `clicks.fraud_flags`, `conversions.status` — see api-backend/src/lib/reporting/postgres.ts).
 * Impressions/CTR/CPM/RPM/VT CV/Media Buying Cost/Avg Sale Value/Gross Sales/Throttle/Events have no
 * real source anywhere in this app (no impression/pixel tracking, no view-through attribution, no
 * per-click cost or throttle outcome, no distinct "events" concept) — shown as "—" rather than a
 * fabricated 0, so the tile/column is structurally present but honestly marked as untracked.
 *
 * Timezone/currency in the header follow this app's own existing convention (see
 * controlCenter/PlatformTab.tsx, AdvertiserCreate.tsx) of a fixed non-functional Timezone display —
 * except Currency here is real, read from this network's own `default_currency` (GET /api/settings).
 *
 * No "Run Report": every control applies on its own — dates once they form a valid range (debounced,
 * since the native date input reports each typed segment), Reporting Filters / chips / sort
 * immediately. The applied report is mirrored to the address bar, so the URL itself is the shareable link.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Search, MoreVertical } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { api } from '../../lib/api';
import { PageHeader, Spinner, StateBlock, Overlay, PromptModal } from '../../shared-components/primitives/ui';
import { type FilterCategory, type FilterValues } from '../../shared-components/primitives/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../shared-components/primitives/TableActionsKit';
import type { Advertiser, Offer, Publisher } from '../../types';
import {
  type AggResult, type AggRow, METRICS_PARAM, DASH, DEVICE_OPTIONS, pct, num, toIso, daysAgo, todayStr,
  deriveRow, type DerivedRow, MiniChart, SummaryGrid, RowKebabMenu, Pagination,
  type MetricFilters, METRIC_FILTER_FIELDS, passesMetricFilters,
  reportingFiltersCount, ReportingFiltersFlyout, type ReportingFiltersValue, EMPTY_REPORTING_FILTERS,
  reportingChips, withoutReportingChip, fetchAllPages, useReportExport, ExportStatus,
  type SavedReportConfig, loadSavedReports, persistSavedReports,
} from '../../shared-components/primitives/ReportPageKit';
import {
  readUrlFilters, writeUrlFilters, readUrlDate, readUrlIds, readUrlMetricFilters, writeUrlMetricFilters,
  IGNORE_FAIL_PARAM, readUrlFlag,
} from '../../lib/reportFilterState';
import { ActiveFilterChips } from '../../shared-components/primitives/ActiveFilterChips';
import {
  combineCurrencies, combineMoneyByCurrency, currenciesOf, filterWithMoneyRule, hasMoneyFilter, isMixed, mixedTitle, moneyByCurrencyOf,
  moneyFilterBlockedBy, resolveCurrency, showSortedWithinNote, withBreakdownMetrics, withCurrenciesMetric, withRowCurrency, type RowCurrency,
} from '../../lib/reportCurrency';
import { CurrencyNotes, Money, MoneyPct } from '../../shared-components/primitives/ReportMoney';
import { countryLabel } from '../../data/geo';
import { flexReportPath } from '../../lib/flexReportLink';
import { useAutoDateRange } from './reportView';
import { ReportCard, ReportControls, DateRangeField, FiltersButton, ClearButton, ResultsBar, ReportBody } from '../../shared-components/primitives/ReportLayout';
import { REPORT_CONTROL as CONTROL } from '../../shared-components/primitives/reportControl';

const ALL_COLUMNS = [
  'Clicks', 'Uniq. Clicks', 'Dup. Clicks', 'Invalid Clicks', 'Total CV', 'CV', 'Throttle', 'Events',
  'CVR', 'CPC', 'CPA', 'Revenue', 'Payout', 'Profit', 'Margin', 'Fraud',
] as const;
type OrderMetric = 'clicks' | 'unique_clicks' | 'invalid_clicks' | 'conversions' | 'total_conversions' | 'payout' | 'revenue' | 'margin' | 'avg_fraud_score';

function metricCells(shown: Set<string>, d: DerivedRow, rc: RowCurrency) {
  return (
    <>
      {shown.has('Clicks') && <td className="px-4 py-3 text-right">{d.clicks.toLocaleString()}</td>}
      {shown.has('Uniq. Clicks') && <td className="px-4 py-3 text-right">{d.uniqueClicks.toLocaleString()}</td>}
      {shown.has('Dup. Clicks') && <td className="px-4 py-3 text-right">{d.dupClicks.toLocaleString()}</td>}
      {shown.has('Invalid Clicks') && <td className="px-4 py-3 text-right">{d.invalidClicks.toLocaleString()}</td>}
      {shown.has('Total CV') && <td className="px-4 py-3 text-right">{d.totalCv.toLocaleString()}</td>}
      {shown.has('CV') && <td className="px-4 py-3 text-right">{d.cv.toLocaleString()}</td>}
      {shown.has('Throttle') && <td className="px-4 py-3 text-right text-fg-muted">{DASH}</td>}
      {shown.has('Events') && <td className="px-4 py-3 text-right text-fg-muted">{DASH}</td>}
      {shown.has('CVR') && <td className="px-4 py-3 text-right">{pct(d.cvr)}</td>}
      {shown.has('CPC') && <td className="px-4 py-3 text-right"><Money value={d.cpc} rc={rc} /></td>}
      {shown.has('CPA') && <td className="px-4 py-3 text-right"><Money value={d.cpa} rc={rc} /></td>}
      {shown.has('Revenue') && <td className="px-4 py-3 text-right"><Money value={d.revenue} rc={rc} /></td>}
      {shown.has('Payout') && <td className="px-4 py-3 text-right"><Money value={d.payout} rc={rc} /></td>}
      {shown.has('Profit') && <td className="px-4 py-3 text-right"><Money value={d.margin} rc={rc} /></td>}
      {shown.has('Margin') && <td className="px-4 py-3 text-right"><MoneyPct value={d.marginPct} rc={rc} /></td>}
      {shown.has('Fraud') && <td className={`px-4 py-3 text-right ${d.fraudScore >= 40 ? 'text-danger-text' : d.fraudScore > 0 ? 'text-warning-text' : ''}`}>{d.fraudScore.toFixed(0)}</td>}
    </>
  );
}

/** Labels for traffic grouped under a null key — kept as rows so the table agrees with Summary/total. */
const NO_OFFER = '(No offer)';
const NO_PARTNER = '(No partner)';

interface PartnerRow { publisherId: string | null; publisherName: string; derived: DerivedRow; rc: RowCurrency }
function ExpandedPartnerRows({ offerId, colSpanBefore, shown, dimParams, from, to, currency }: { offerId: string; colSpanBefore: number; shown: Set<string>; dimParams: Record<string, string | number | undefined>; from: string; to: string; currency: string }) {
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  // Same date range + filters as the parent table; the row's own offer is set last so a page-level
  // Offer filter can't override it.
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(dimParams)) if (v !== undefined && v !== '') p.set(k, String(v));
    p.set('groupBy', 'publisher'); p.set('metrics', withCurrenciesMetric(METRICS_PARAM));
    p.set('from', toIso(from)); p.set('to', toIso(to, true)); p.set('limit', '200');
    p.set('offerId', offerId);
    return p.toString();
  }, [offerId, dimParams, from, to]);
  const { data, loading } = useQuery<AggResult>(`/api/reports?${qs}`);
  const rows: PartnerRow[] = useMemo(() => (data?.rows ?? []).map((r) => {
    const id = r.dimensions['publisher'] ?? null;
    return {
      publisherId: id,
      publisherName: id ? (publishers?.find((p) => p.id === id)?.name ?? id.slice(0, 8)) : NO_PARTNER,
      derived: deriveRow(r.metrics), rc: resolveCurrency(currenciesOf(r.metrics), currency),
    };
  }), [data, publishers, currency]);

  if (loading) return <tr><td colSpan={colSpanBefore + ALL_COLUMNS.length} className="px-4 py-3 text-center"><Spinner /></td></tr>;
  if (!rows.length) return <tr><td colSpan={colSpanBefore + ALL_COLUMNS.length} className="px-4 py-3 text-small text-fg-muted">No partner activity for this offer in the selected period.</td></tr>;

  return (
    <>
      {rows.map((r) => (
        <tr key={r.publisherId ?? '__no-partner__'} className="bg-page/60 text-small text-fg-secondary">
          <td className={`py-2 pl-10 pr-4${r.publisherId ? '' : ' italic'}`}>{r.publisherName}</td>
          {metricCells(shown, r.derived, r.rc)}
          <td />
        </tr>
      ))}
    </>
  );
}

interface AccessDTO { id: string; publisherId: string; access: 'allow' | 'deny'; approvalStatus: string }

/**
 * Verified against the live reference: "Adjust Visibility" is NOT a public/private/ask toggle — it
 * opens a "Partner Visibility Settings" dual-list picker (Available ↔ Selected) for choosing exactly
 * which partners can see this offer. This app has the same real concept, just under a different
 * name: `offer_publisher_access` (access='allow'/'deny' per offer+publisher), already CRUD-exposed
 * via GET/POST/DELETE /api/offers/:id/publishers (api-backend/src/surfaces/dashboard/offers/routes.ts).
 * No bulk-set endpoint exists, so Save diffs the selection against the fetched rows and fires the
 * existing single-item POST/DELETE calls for whatever changed.
 */
function AdjustVisibilityModal({ offer, publishers, onClose, onSaved }: { offer: { id: string; name: string }; publishers: Publisher[]; onClose: () => void; onSaved: () => void }) {
  const { data: access, loading } = useQuery<AccessDTO[]>(`/api/offers/${offer.id}/publishers`);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (access && selected === null) setSelected(new Set(access.filter((a) => a.access === 'allow').map((a) => a.publisherId)));
  }, [access, selected]);

  const sel = selected ?? new Set<string>();
  const matches = (p: Publisher) => p.name.toLowerCase().includes(q.toLowerCase());
  const available = publishers.filter((p) => !sel.has(p.id) && matches(p));
  const selectedList = publishers.filter((p) => sel.has(p.id) && matches(p));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s ?? []); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const save = async () => {
    setSaving(true);
    try {
      const originallyAllowed = new Map((access ?? []).filter((a) => a.access === 'allow').map((a) => [a.publisherId, a.id] as const));
      const toAdd = [...sel].filter((id) => !originallyAllowed.has(id));
      const toRemove = [...originallyAllowed.entries()].filter(([pid]) => !sel.has(pid));
      await Promise.all([
        ...toAdd.map((publisherId) => api.post(`/api/offers/${offer.id}/publishers`, { publisherId, access: 'allow', approvalStatus: 'approved' })),
        ...toRemove.map(([, accessId]) => api.del(`/api/offers/${offer.id}/publishers/${accessId}`)),
      ]);
      onSaved();
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-2xl rounded-card border border-border bg-elevated p-6 shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-h3 font-semibold tracking-tight text-fg">Partner Visibility Settings</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg" aria-label="Close">✕</button>
        </div>
        <p className="mt-1 text-small text-fg-secondary">{offer.name}</p>
        <div className="relative mt-4">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input className="input !pl-8" placeholder="Search in both, available and selected" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {loading || selected === null ? <div className="py-8"><Spinner /></div> : (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-card border border-border">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-tiny font-semibold uppercase text-fg-secondary">Available</span>
                <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setSelected((s) => new Set([...(s ?? []), ...available.map((p) => p.id)]))}>Select All</button>
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                {available.map((p) => (
                  <button key={p.id} type="button" onClick={() => toggle(p.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-success" /> ({p.ref ?? '—'}) {p.name}
                  </button>
                ))}
                {!available.length && <p className="px-3 py-3 text-small text-fg-muted">No partners.</p>}
              </div>
            </div>
            <div className="rounded-card border border-border">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-tiny font-semibold uppercase text-fg-secondary">Selected</span>
                <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setSelected(new Set())}>Clear All</button>
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                {selectedList.map((p) => (
                  <button key={p.id} type="button" onClick={() => toggle(p.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-success" /> ({p.ref ?? '—'}) {p.name}
                  </button>
                ))}
                {!selectedList.length && <p className="px-3 py-3 text-small text-fg-muted">No partners selected.</p>}
              </div>
            </div>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={saving || loading} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Overlay>
  );
}

interface RowActionMenuProps { offer: { id: string; name: string; visibility?: string }; publishers: Publisher[]; onChanged: () => void; flexHref: string }
function RowActionMenu({ offer, publishers, onChanged, flexHref }: RowActionMenuProps) {
  const [visModalOpen, setVisModalOpen] = useState(false);
  const nav = useNavigate();

  return (
    <>
      <RowKebabMenu items={[
        { label: 'View Offer', onClick: () => nav(`/app/offers/${offer.id}`) },
        { label: 'Adjust Visibility', onClick: () => setVisModalOpen(true) },
        { label: 'Open Flex Report', onClick: () => nav(flexHref) },
        { label: 'Add Conversion', onClick: () => nav(`/app/conversions/add?offerId=${offer.id}`) },
      ]} />
      {visModalOpen && <AdjustVisibilityModal offer={offer} publishers={publishers} onClose={() => setVisModalOpen(false)} onSaved={onChanged} />}
    </>
  );
}

type SavedConfig = SavedReportConfig<OrderMetric>;

export default function OfferReport() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Dates apply on their own once they form a valid range (see useAutoDateRange); everything else
  // applies immediately and returns to page 1. `page` lives with the range, so a new range and the
  // page reset land in one render (one request).
  const [initRange] = useState(() => ({ from: readUrlDate(searchParams, 'from', daysAgo(30)), to: readUrlDate(searchParams, 'to', todayStr()) }));
  const range = useAutoDateRange(initRange.from, initRange.to);
  const { appliedFrom, appliedTo, page, setPage, toFirstPage } = range;
  // `f.offer` wins; the legacy `offerId` (or `offer`) deep-link param is the fallback.
  const [filters, setFilters] = useState<FilterValues>(() => {
    const f = readUrlFilters(searchParams, 'f');
    const legacy = readUrlIds(searchParams, 'offerId', 'offer');
    return legacy.length && !f['offer']?.length ? { ...f, offer: legacy } : f;
  });
  const [exclusions, setExclusions] = useState<FilterValues>(() => readUrlFilters(searchParams, 'x'));
  const [metricFilters, setMetricFilters] = useState<MetricFilters>(() => readUrlMetricFilters<MetricFilters>(searchParams, METRIC_FILTER_FIELDS.map((f) => f.key)));
  const [ignoreFailTraffic, setIgnoreFailTraffic] = useState(() => readUrlFlag(searchParams, IGNORE_FAIL_PARAM));
  const [filterOpen, setFilterOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [graphOpen, setGraphOpen] = useState(false);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [orderBy, setOrderBy] = useState<OrderMetric>((searchParams.get('orderBy') as OrderMetric) || 'conversions');
  const [orderDir, setOrderDir] = useState<'asc' | 'desc'>((searchParams.get('orderDir') as 'asc' | 'desc') || 'desc');
  const pageSize = 25;
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [showApiRequest, setShowApiRequest] = useState(false);
  const tableActionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tableActionsOpen) return;
    const onDown = (e: MouseEvent) => { if (!tableActionsRef.current?.contains(e.target as Node)) { setTableActionsOpen(false); setExportOpen(false); } };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [tableActionsOpen]);

  // The reference's page-level kebab also offers Schedule Report / Request Report / Share Offer(s)
  // Details — none of those have any real backing in this app (no report-scheduling or email-send
  // worker exists anywhere in api-backend/src/surfaces/workers), so they're omitted rather than
  // faked. Save/Load are real (localStorage-persisted full report configs, same mechanism the
  // Filters flyout already uses for its own presets); Show API Request is real. There is no separate
  // Copy Link — the whole report state (dates, filters, sort) round-trips through the URL, so the
  // address bar is the link.
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [savedReports, setSavedReports] = useState(() => loadSavedReports<OrderMetric>('offer-report'));
  const pageMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pageMenuOpen) return;
    const onDown = (e: MouseEvent) => { if (!pageMenuRef.current?.contains(e.target as Node)) { setPageMenuOpen(false); setLoadOpen(false); } };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pageMenuOpen]);

  const { data: settings } = useQuery<{ general?: { defaultCurrency?: string } }>('/api/settings');
  const currency = settings?.general?.defaultCurrency ?? 'USD';

  const { data: offers, refetch: refetchOffers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  // Country has no static option list anywhere in this app (no ISO list, no facet endpoint) — the
  // real distinct codes present in this network's own click data are pulled live via a groupBy=country
  // report request, same mechanism DimensionalReport.tsx already uses for the same dimension.
  const { data: countryAgg } = useQuery<AggResult>('/api/reports?groupBy=country&metrics=clicks&limit=200');
  const countryOptions = useMemo(() => (countryAgg?.rows ?? [])
    .map((r) => r.dimensions['country'])
    .filter((c): c is string => Boolean(c))
    .map((c) => ({ value: c, label: countryLabel(c) }))
    .sort((a, b) => a.label.localeCompare(b.label)), [countryAgg]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'advertiser', label: 'Advertiser', options: (advertisers ?? []).map((a) => ({ value: a.id, label: a.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
    { key: 'country', label: 'Country', options: countryOptions },
    { key: 'device', label: 'Device', options: DEVICE_OPTIONS },
  ], [offers, advertisers, publishers, countryOptions]);

  const offerIdFilter = filters['offer']?.join(',');
  const advertiserIdFilter = filters['advertiser']?.join(',');
  const publisherIdFilter = filters['partner']?.join(',');
  const countryFilter = filters['country']?.join(',');
  const deviceFilter = filters['device']?.join(',');
  const excludeOfferId = exclusions['offer']?.join(',');
  const excludeAdvertiserId = exclusions['advertiser']?.join(',');
  const excludePublisherId = exclusions['partner']?.join(',');
  const excludeCountry = exclusions['country']?.join(',');
  const excludeDevice = exclusions['device']?.join(',');

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };

  // Keep the URL in sync with the applied report state (replace, not push), so the address bar
  // always reflects a real, re-loadable report configuration — reload / back / a shared link keep it.
  useEffect(() => {
    const next = new URLSearchParams();
    next.set('from', appliedFrom);
    next.set('to', appliedTo);
    writeUrlFilters(next, 'f', filters);
    writeUrlFilters(next, 'x', exclusions);
    writeUrlMetricFilters(next, metricFilters);
    if (ignoreFailTraffic) next.set(IGNORE_FAIL_PARAM, '1');
    next.set('orderBy', orderBy);
    next.set('orderDir', orderDir);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedFrom, appliedTo, JSON.stringify(filters), JSON.stringify(exclusions), JSON.stringify(metricFilters), ignoreFailTraffic, orderBy, orderDir]);

  const dimParams = {
    offerId: offerIdFilter, advertiserId: advertiserIdFilter, publisherId: publisherIdFilter,
    country: countryFilter, device: deviceFilter,
    excludeOfferId, excludeAdvertiserId, excludePublisherId, excludeCountry, excludeDevice,
    excludeInvalid: ignoreFailTraffic ? 1 : undefined,
  };

  // Summary tiles: one exact grand-total row (groupBy=none) — summing the top-N grouped rows
  // undercounted as soon as there were more groups than the page limit.
  const summaryQs = qs({ groupBy: 'none', metrics: withBreakdownMetrics(METRICS_PARAM), from: toIso(appliedFrom), to: toIso(appliedTo, true), ...dimParams });
  const { data: summaryData, loading: summaryLoading, error: summaryError } = useQuery<AggResult>(`/api/reports?${summaryQs}`);
  const summary = useMemo(() => {
    const rows = summaryData?.rows ?? [];
    if (!rows.length) return null;
    const totals = rows.reduce((acc, r) => {
      acc.clicks += num(r.metrics['clicks'] ?? 0); acc.unique_clicks += num(r.metrics['unique_clicks'] ?? 0);
      acc.invalid_clicks += num(r.metrics['invalid_clicks'] ?? 0);
      acc.conversions += num(r.metrics['conversions'] ?? 0); acc.total_conversions += num(r.metrics['total_conversions'] ?? 0);
      acc.payout += num(r.metrics['payout'] ?? 0);
      acc.revenue += num(r.metrics['revenue'] ?? 0); acc.margin += num(r.metrics['margin'] ?? 0);
      return acc;
    }, { clicks: 0, unique_clicks: 0, invalid_clicks: 0, conversions: 0, total_conversions: 0, payout: 0, revenue: 0, margin: 0 });
    return deriveRow(totals);
  }, [summaryData]);
  // The summary's money is in its conversions' currency — "Mixed" (no total) when they differ.
  const summaryRc = useMemo(() => combineCurrencies((summaryData?.rows ?? []).map((r) => currenciesOf(r.metrics)), currency), [summaryData, currency]);
  // …and, when mixed, its per-currency amounts (newer API) for the Payout/Revenue/Profit tiles.
  const summaryBreakdown = useMemo(() => combineMoneyByCurrency((summaryData?.rows ?? []).map((r) => moneyByCurrencyOf(r.metrics))), [summaryData]);

  const graphQs = qs({ groupBy: 'day', metrics: withCurrenciesMetric('clicks,revenue'), from: toIso(appliedFrom), to: toIso(appliedTo, true), ...dimParams, limit: 200 });
  const { data: graphData, loading: graphLoading, error: graphError } = useQuery<AggResult>(graphOpen ? `/api/reports?${graphQs}` : null);
  const graphSeries = useMemo(() => {
    const rows = [...(graphData?.rows ?? [])].sort((a, b) => (a.dimensions['day'] ?? '').localeCompare(b.dimensions['day'] ?? ''));
    return {
      labels: rows.map((r) => (r.dimensions['day'] ?? '').slice(0, 10)),
      revenue: rows.map((r) => num(r.metrics['revenue'] ?? 0)),
      clicks: rows.map((r) => num(r.metrics['clicks'] ?? 0)),
      // Revenue across days in different currencies isn't one comparable series — not plotted then.
      rc: combineCurrencies(rows.map((r) => currenciesOf(r.metrics)), currency),
    };
  }, [graphData, currency]);

  const tableParams = {
    groupBy: 'offer', metrics: withCurrenciesMetric(METRICS_PARAM),
    from: toIso(appliedFrom), to: toIso(appliedTo, true), ...dimParams,
    orderBy, orderDir,
  };
  const tableQs = qs({ ...tableParams, limit: pageSize, offset: (page - 1) * pageSize });
  const { data, loading, error, refetch: refetchTable } = useQuery<AggResult>(`/api/reports?${tableQs}`);

  // Traffic with no offer groups under a null key — kept as a "(No offer)" row (offerId null: not
  // expandable, no row actions) so the table agrees with Summary/total.
  const toRows = useCallback((src: AggRow[]) => src.map((r) => {
    const id = r.dimensions['offer'] ?? null;
    const offer = id ? offers?.find((o) => o.id === id) : undefined;
    return { offerId: id, offerName: id ? (offer?.name ?? id.slice(0, 8)) : NO_OFFER, offerStatus: offer?.status, offerVisibility: offer?.visibility, derived: deriveRow(r.metrics), rc: resolveCurrency(currenciesOf(r.metrics), currency) };
  }), [offers, currency]);
  const loadedRows = useMemo(() => toRows(data?.rows ?? []), [data, toRows]);
  // A Payout/Revenue threshold has no currency: not applied while the loaded rows span several
  // currencies (the flyout disables it and the results bar says so) — lib/reportCurrency.
  const moneyBlocked = useMemo(() => moneyFilterBlockedBy(loadedRows.map((r) => r.rc)), [loadedRows]);
  const rows = useMemo(() => loadedRows
    .filter((r) => !q.trim() || r.offerName.toLowerCase().includes(q.trim().toLowerCase()))
    .filter((r) => passesMetricFilters(r.derived, metricFilters, !!moneyBlocked)),
  [loadedRows, q, metricFilters, moneyBlocked]);

  // Reset dates and every Reporting Filter in one render → one request per query. The debounced
  // range catches up to the same values later and is then a no-op.
  const clearAll = () => {
    range.reset({ from: daysAgo(30), to: todayStr() });
    setFilters({}); setExclusions({}); setMetricFilters({}); setIgnoreFailTraffic(false);
  };

  const toggleSort = (metric: OrderMetric) => {
    if (orderBy === metric) setOrderDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setOrderBy(metric); setOrderDir('desc'); }
    toFirstPage();
  };
  const toggleExpand = (offerId: string) => setExpanded((s) => { const n = new Set(s); n.has(offerId) ? n.delete(offerId) : n.add(offerId); return n; });

  const shown = useMemo(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const exportRow = (r: ReturnType<typeof toRows>[number]) => ({
    offer: r.offerName, clicks: r.derived.clicks, uniqueClicks: r.derived.uniqueClicks, dupClicks: r.derived.dupClicks,
    invalidClicks: r.derived.invalidClicks, totalCv: r.derived.totalCv, cv: r.derived.cv, throttle: DASH, events: DASH,
    cvr: pct(r.derived.cvr), cpc: r.derived.cpc.toFixed(2), cpa: r.derived.cpa.toFixed(2),
    revenue: r.derived.revenue.toFixed(2), payout: r.derived.payout.toFixed(2), profit: r.derived.margin.toFixed(2),
    margin: pct(r.derived.marginPct), fraud: r.derived.fraudScore.toFixed(0),
  });
  // Export every row matching the applied filters (all pages), not just the visible page — the
  // search box is a page-local filter and does not apply here. Money stays plain decimals; the
  // row's currency rides along in a trailing `currency` column — "MIXED", with the money columns
  // left empty, for a row whose conversions mix currencies (lib/reportCurrency).
  const exp = useReportExport();
  const runExport = (format: 'csv' | 'xlsx') => {
    setTableActionsOpen(false); setExportOpen(false);
    void exp.run(format, 'offer-report', async () => {
      const r = await fetchAllPages<AggRow>((limit, offset) => `/api/reports?${qs({ ...tableParams, limit, offset })}`, 200);
      return { rows: filterWithMoneyRule(toRows(r.rows), (x) => x.rc, (x, skip) => passesMetricFilters(x.derived, metricFilters, skip)).map((x) => withRowCurrency(exportRow(x), x.rc)), capped: r.capped, total: r.total };
    });
  };
  const reporting: ReportingFiltersValue = { filters, exclusions, metricFilters, ignoreFailTraffic };
  // Flyout Apply, chip removal and the chips' "Clear all" apply at once and return to page 1.
  const setReporting = (v: ReportingFiltersValue) => {
    setFilters(v.filters); setExclusions(v.exclusions); setMetricFilters(v.metricFilters); setIgnoreFailTraffic(v.ignoreFailTraffic);
    toFirstPage();
  };

  const sortIcon = (metric: OrderMetric) => (orderBy === metric ? (orderDir === 'desc' ? '↓' : '↑') : '');
  const sortableHeader = (label: string, metric: OrderMetric) => (
    <th className="cursor-pointer whitespace-nowrap px-4 py-3 text-right font-semibold" onClick={() => toggleSort(metric)}>{label} {sortIcon(metric)}</th>
  );

  const saveReport = (name: string) => {
    const config: SavedConfig = { from: appliedFrom, to: appliedTo, filters, exclusions, metricFilters, ignoreFailTraffic, orderBy, orderDir, hiddenColumns: [...hiddenColumns] };
    const next = [...savedReports.filter((s) => s.name !== name), { name, config }];
    setSavedReports(next);
    persistSavedReports('offer-report', next);
    setPageMenuOpen(false);
  };
  const applySavedReport = (config: SavedConfig) => {
    // range.reset sets the inputs, the applied range and page 1 together — one render, one request.
    range.reset({ from: config.from, to: config.to });
    setFilters(config.filters); setExclusions(config.exclusions ?? {}); setMetricFilters(config.metricFilters ?? {}); setIgnoreFailTraffic(config.ignoreFailTraffic ?? false);
    setOrderBy(config.orderBy); setOrderDir(config.orderDir);
    setHiddenColumns(new Set(config.hiddenColumns));
    setPageMenuOpen(false); setLoadOpen(false);
  };
  const deleteSavedReport = (name: string) => {
    const next = savedReports.filter((s) => s.name !== name);
    setSavedReports(next);
    persistSavedReports('offer-report', next);
  };

  return (
    <>
      <PageHeader title="Offer Report" subtitle="Reporting › Offer" />

      <ReportCard className="mb-4">
        <ReportControls problem={range.problem} actions={<>
          <ClearButton onClick={clearAll} />
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
          <div className="flex items-center gap-3">
            <div ref={pageMenuRef} className="relative">
              <button type="button" title="Page Actions" onClick={() => setPageMenuOpen((o) => !o)}
                className="grid h-10 w-10 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
                <MoreVertical size={15} />
              </button>
              {pageMenuOpen && (
                <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                  <button onClick={() => { setPageMenuOpen(false); setSaveModalOpen(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Save</button>
                  <div className="relative" onMouseEnter={() => setLoadOpen(true)} onMouseLeave={() => setLoadOpen(false)}>
                    <button disabled={!savedReports.length} onClick={() => setLoadOpen((s) => !s)}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle disabled:cursor-not-allowed disabled:text-fg-muted">
                      Load{savedReports.length ? ` (${savedReports.length})` : ''} <ChevronRight size={13} className="text-fg-muted" />
                    </button>
                    {loadOpen && savedReports.length > 0 && (
                      <div className="absolute right-full top-0 mr-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                        {savedReports.map((s) => (
                          <div key={s.name} className="flex items-center justify-between px-3 py-1.5 text-small hover:bg-accent-subtle">
                            <button onClick={() => applySavedReport(s.config)} className="flex-1 truncate text-left text-fg">{s.name}</button>
                            <button onClick={() => deleteSavedReport(s.name)} className="ml-2 text-fg-muted hover:text-danger-text">×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => { setPageMenuOpen(false); setShowApiRequest(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Show API Request</button>
                </div>
              )}
            </div>
          </div>
        </>}>
          <DateRangeField idPrefix="offer-report" from={range.from} to={range.to} max={todayStr()} invalid={range.problem !== null}
            onFrom={range.setFrom} onTo={range.setTo} />
        </ReportControls>

        <div className="border-t border-border px-5 py-4 sm:px-6">
          <button type="button" onClick={() => setSummaryOpen((o) => !o)} className="flex w-full items-center gap-2 text-small font-medium text-fg">
            <ChevronDown size={14} className={`transition-transform ${summaryOpen ? '' : '-rotate-90'}`} /> Summary
          </button>
          {summaryOpen && (
            summaryLoading ? <div className="pt-4"><Spinner /></div> : summaryError ? <p className="pt-3 text-small text-danger-text">{summaryError}</p> : !summary ? <p className="pt-3 text-small text-fg-muted">No data for this period.</p> : (
              <SummaryGrid summary={summary} currency={currency} rc={summaryRc} breakdown={summaryBreakdown} />
            )
          )}
        </div>
      </ReportCard>

      <div className="card mb-4">
        <button type="button" onClick={() => setGraphOpen((o) => !o)} className="flex w-full items-center gap-2 text-small font-medium text-fg">
          <ChevronRight size={14} className={`transition-transform ${graphOpen ? 'rotate-90' : ''}`} /> Performance Graph
        </button>
        {graphOpen && (
          graphLoading || (!graphData && !graphError) ? <div className="pt-4"><Spinner /></div> : graphError ? <p className="pt-3 text-small text-danger-text">{graphError}</p> : graphSeries.labels.length === 0 ? <p className="pt-3 text-small text-fg-muted">No data for this period.</p> : (
            <div className="pt-4">
              {graphSeries.labels.length >= 200 && <p className="mb-2 text-tiny text-fg-muted">Graph shows the first {graphSeries.labels.length} days — narrow the date range to see the rest.</p>}
              <div className="mb-2 flex items-center gap-4 text-tiny text-fg-secondary">
                {isMixed(graphSeries.rc)
                  ? <span className="text-fg-muted" title={mixedTitle(graphSeries.rc.currencies)}>Revenue not plotted — mixed currencies</span>
                  : <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded bg-accent-text" /> Revenue</span>}
                <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 bg-fg-muted" /> Clicks</span>
              </div>
              <MiniChart labels={graphSeries.labels} revenue={isMixed(graphSeries.rc) ? null : graphSeries.revenue} clicks={graphSeries.clicks} />
            </div>
          )
        )}
      </div>

      <ReportCard>
        <ResultsBar position="top" title={<>Detailed Report <span className="ml-1 font-normal text-fg-muted" title={`Report times are UTC. Money is shown in each row’s own currency (network default ${currency} for rows without conversions); rows mixing currencies show Mixed.`}>· UTC · row currency</span></>} loading={loading} actions={<>
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className={`input ${CONTROL} !pl-8 sm:!w-56`} placeholder="Search this page…" title="Filters only the rows on the current page"
              aria-label="Search this page" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div ref={tableActionsRef} className="relative">
            <button type="button" title="Table Actions" aria-label="Table Actions" onClick={() => setTableActionsOpen((o) => !o)}
              className="grid h-10 w-10 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
              <MoreVertical size={15} />
            </button>
            {tableActionsOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                <div className="px-3 py-1 text-tiny font-semibold uppercase text-fg-secondary">Table Actions</div>
                <div className="relative" onMouseEnter={() => setExportOpen(true)} onMouseLeave={() => setExportOpen(false)}>
                  <button onClick={() => setExportOpen((s) => !s)} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                    Export <ChevronRight size={13} className="text-fg-muted" />
                  </button>
                  {exportOpen && (
                    <div className="absolute right-full top-0 mr-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                      <button disabled={exp.busy} onClick={() => runExport('csv')} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle disabled:cursor-not-allowed disabled:text-fg-muted">CSV</button>
                      <button disabled={exp.busy} onClick={() => runExport('xlsx')} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle disabled:cursor-not-allowed disabled:text-fg-muted">Excel</button>
                    </div>
                  )}
                </div>
                <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
              </div>
            )}
          </div>
        </>}>
          <CurrencyNotes sortedWithin={showSortedWithinNote(data?.sortedWithinCurrency, loadedRows.map((r) => r.rc))}
            moneyFilterBlockedBy={moneyBlocked} moneyFilterActive={hasMoneyFilter(metricFilters)} />
          <ActiveFilterChips
            chips={reportingChips(FILTER_CATEGORIES, reporting)}
            onRemove={(c) => setReporting(withoutReportingChip(reporting, c))}
            onClearAll={() => setReporting(EMPTY_REPORTING_FILTERS)} />
        </ResultsBar>

        <ReportBody>
        <ExportStatus {...exp} onDismiss={exp.dismiss} />
        {loading ? <StateBlock><Spinner /></StateBlock>
          : error ? <StateBlock>{error}</StateBlock>
          : !rows.length ? <StateBlock>No Record Found</StateBlock>
          : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th >
                      Offer<br /><span className="text-[10px] normal-case text-fg-muted">↳ Partner</span>
                    </th>
                    {shown.has('Clicks') && sortableHeader('Clicks', 'clicks')}
                    {shown.has('Uniq. Clicks') && sortableHeader('Uniq. Clicks', 'unique_clicks')}
                    {shown.has('Dup. Clicks') && <th className="text-right font-semibold">Dup. Clicks</th>}
                    {shown.has('Invalid Clicks') && sortableHeader('Invalid Clicks', 'invalid_clicks')}
                    {shown.has('Total CV') && sortableHeader('Total CV', 'total_conversions')}
                    {shown.has('CV') && sortableHeader('CV', 'conversions')}
                    {shown.has('Throttle') && <th className="text-right font-semibold">Throttle</th>}
                    {shown.has('Events') && <th className="text-right font-semibold">Events</th>}
                    {shown.has('CVR') && <th className="text-right font-semibold">CVR</th>}
                    {shown.has('CPC') && <th className="text-right font-semibold">CPC</th>}
                    {shown.has('CPA') && <th className="text-right font-semibold">CPA</th>}
                    {shown.has('Revenue') && sortableHeader('Revenue', 'revenue')}
                    {shown.has('Payout') && sortableHeader('Payout', 'payout')}
                    {shown.has('Profit') && sortableHeader('Profit', 'margin')}
                    {shown.has('Margin') && <th className="text-right font-semibold">Margin</th>}
                    {shown.has('Fraud') && sortableHeader('Fraud', 'avg_fraud_score')}
                    <th className="w-9" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const id = r.offerId;
                    if (id === null) {
                      return (
                        <tr key="__no-offer__">
                          <td><span className="inline-flex items-center gap-1.5 pl-[19px] italic text-fg-secondary" title="Traffic not attributed to an offer">{r.offerName}</span></td>
                          {metricCells(shown, r.derived, r.rc)}
                          <td />
                        </tr>
                      );
                    }
                    return (
                      <Fragment key={id}>
                        <tr>
                          <td >
                            <button type="button" onClick={() => toggleExpand(id)} className="inline-flex items-center gap-1.5 text-fg hover:text-accent-text">
                              <ChevronRight size={13} className={`transition-transform ${expanded.has(id) ? 'rotate-90' : ''}`} />
                              <span className={`h-2 w-2 rounded-full ${r.offerStatus === 'active' ? 'bg-success' : 'bg-fg-muted'}`} />
                              {r.offerName}
                            </button>
                          </td>
                          {metricCells(shown, r.derived, r.rc)}
                          <td className="text-right">
                            <RowActionMenu offer={{ id, name: r.offerName, visibility: r.offerVisibility }} publishers={publishers ?? []} onChanged={() => { refetchOffers(); refetchTable(); }}
                              flexHref={flexReportPath({ from: appliedFrom, to: appliedTo, reporting, entity: ['offer', id] })} />
                          </td>
                        </tr>
                        {expanded.has(id) && <ExpandedPartnerRows offerId={id} colSpanBefore={1} shown={shown} dimParams={dimParams} from={appliedFrom} to={appliedTo} currency={currency} />}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        <div className="mt-3 flex justify-end">
          {/* A failed request keeps the previous `data` in useQuery — never show its total as current. */}
          <Pagination total={error ? 0 : (data?.total ?? 0)} page={page} pageSize={pageSize} onPageChange={setPage} />
        </div>
        </ReportBody>
      </ReportCard>

      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={[...ALL_COLUMNS]} hidden={hiddenColumns} onClose={() => setShowColumns(false)} reorderable={false} onApply={(_o, h) => setHiddenColumns(h)} />}
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, offer: offerIdFilter, advertiser: advertiserIdFilter, partner: publisherIdFilter, country: countryFilter, device: deviceFilter,
        excludeOffer: excludeOfferId, excludeAdvertiser: excludeAdvertiserId, excludePartner: excludePublisherId, excludeCountry, excludeDevice,
        ignoreFailTraffic: ignoreFailTraffic ? 'true' : undefined,
      }} />}
      <PromptModal open={saveModalOpen} onClose={() => setSaveModalOpen(false)} title="Save Report" message="Name this saved report:" placeholder="e.g. Offer Overview" onConfirm={saveReport} />
    </>
  );
}
