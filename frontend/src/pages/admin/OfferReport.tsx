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
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Search, MoreVertical, SlidersHorizontal } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { api } from '../../lib/api';
import { PageHeader, Spinner, StateBlock, Overlay, PromptModal } from '../../shared-components/primitives/ui';
import { type FilterCategory, type FilterValues } from '../../shared-components/primitives/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../shared-components/primitives/TableActionsKit';
import type { Advertiser, Offer, Publisher } from '../../types';
import {
  type AggResult, type AggRow, METRICS_PARAM, DASH, DEVICE_OPTIONS, money, pct, num, toIso, daysAgo, todayStr,
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
import { countryLabel } from '../../data/geo';

const ALL_COLUMNS = [
  'Clicks', 'Uniq. Clicks', 'Dup. Clicks', 'Invalid Clicks', 'Total CV', 'CV', 'Throttle', 'Events',
  'CVR', 'CPC', 'CPA', 'Revenue', 'Payout', 'Profit', 'Margin', 'Fraud',
] as const;
type OrderMetric = 'clicks' | 'unique_clicks' | 'invalid_clicks' | 'conversions' | 'total_conversions' | 'payout' | 'revenue' | 'margin' | 'avg_fraud_score';

function metricCells(shown: Set<string>, d: DerivedRow) {
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
      {shown.has('CPC') && <td className="px-4 py-3 text-right">{money(d.cpc)}</td>}
      {shown.has('CPA') && <td className="px-4 py-3 text-right">{money(d.cpa)}</td>}
      {shown.has('Revenue') && <td className="px-4 py-3 text-right">{money(d.revenue)}</td>}
      {shown.has('Payout') && <td className="px-4 py-3 text-right">{money(d.payout)}</td>}
      {shown.has('Profit') && <td className="px-4 py-3 text-right">{money(d.margin)}</td>}
      {shown.has('Margin') && <td className="px-4 py-3 text-right">{pct(d.marginPct)}</td>}
      {shown.has('Fraud') && <td className={`px-4 py-3 text-right ${d.fraudScore >= 40 ? 'text-danger-text' : d.fraudScore > 0 ? 'text-warning-text' : ''}`}>{d.fraudScore.toFixed(0)}</td>}
    </>
  );
}

interface PartnerRow { publisherId: string; publisherName: string; derived: DerivedRow }
function ExpandedPartnerRows({ offerId, colSpanBefore, shown, dimParams, from, to }: { offerId: string; colSpanBefore: number; shown: Set<string>; dimParams: Record<string, string | number | undefined>; from: string; to: string }) {
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  // Same date range + filters as the parent table; the row's own offer is set last so a page-level
  // Offer filter can't override it.
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(dimParams)) if (v !== undefined && v !== '') p.set(k, String(v));
    p.set('groupBy', 'publisher'); p.set('metrics', METRICS_PARAM);
    p.set('from', toIso(from)); p.set('to', toIso(to, true)); p.set('limit', '200');
    p.set('offerId', offerId);
    return p.toString();
  }, [offerId, dimParams, from, to]);
  const { data, loading } = useQuery<AggResult>(`/api/reports?${qs}`);
  const rows: PartnerRow[] = useMemo(() => (data?.rows ?? [])
    .filter((r) => r.dimensions['publisher'])
    .map((r) => ({
      publisherId: r.dimensions['publisher']!,
      publisherName: publishers?.find((p) => p.id === r.dimensions['publisher'])?.name ?? r.dimensions['publisher']!.slice(0, 8),
      derived: deriveRow(r.metrics),
    })), [data, publishers]);

  if (loading) return <tr><td colSpan={colSpanBefore + ALL_COLUMNS.length} className="px-4 py-3 text-center"><Spinner /></td></tr>;
  if (!rows.length) return <tr><td colSpan={colSpanBefore + ALL_COLUMNS.length} className="px-4 py-3 text-small text-fg-muted">No partner activity for this offer in the selected period.</td></tr>;

  return (
    <>
      {rows.map((r) => (
        <tr key={r.publisherId} className="bg-page/60 text-small text-fg-secondary">
          <td className="py-2 pl-10 pr-4">{r.publisherName}</td>
          {metricCells(shown, r.derived)}
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

interface RowActionMenuProps { offer: { id: string; name: string; visibility?: string }; publishers: Publisher[]; onChanged: () => void }
function RowActionMenu({ offer, publishers, onChanged }: RowActionMenuProps) {
  const [visModalOpen, setVisModalOpen] = useState(false);
  const nav = useNavigate();

  return (
    <>
      <RowKebabMenu items={[
        { label: 'View Offer', onClick: () => nav(`/app/offers/${offer.id}`) },
        { label: 'Adjust Visibility', onClick: () => setVisModalOpen(true) },
        { label: 'Open Flex Report', onClick: () => nav(`/app/analytics?tab=flex&offerId=${offer.id}`) },
        { label: 'Add Conversion', onClick: () => nav(`/app/conversions/add?offerId=${offer.id}`) },
      ]} />
      {visModalOpen && <AdjustVisibilityModal offer={offer} publishers={publishers} onClose={() => setVisModalOpen(false)} onSaved={onChanged} />}
    </>
  );
}

type SavedConfig = SavedReportConfig<OrderMetric>;

export default function OfferReport() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [from, setFrom] = useState(() => readUrlDate(searchParams, 'from', daysAgo(30)));
  const [to, setTo] = useState(() => readUrlDate(searchParams, 'to', todayStr()));
  const [appliedFrom, setAppliedFrom] = useState(from);
  const [appliedTo, setAppliedTo] = useState(to);
  // `f.offer` wins; the legacy `offerId` (or `offer`) deep-link param is the fallback.
  const [filters, setFilters] = useState<FilterValues>(() => {
    const f = readUrlFilters(searchParams, 'f');
    const legacy = readUrlIds(searchParams, 'offerId', 'offer');
    return legacy.length && !f['offer']?.length ? { ...f, offer: legacy } : f;
  });
  const [appliedFilters, setAppliedFilters] = useState<FilterValues>(filters);
  const [exclusions, setExclusions] = useState<FilterValues>(() => readUrlFilters(searchParams, 'x'));
  const [appliedExclusions, setAppliedExclusions] = useState<FilterValues>(exclusions);
  const [metricFilters, setMetricFilters] = useState<MetricFilters>(() => readUrlMetricFilters<MetricFilters>(searchParams, METRIC_FILTER_FIELDS.map((f) => f.key)));
  const [appliedMetricFilters, setAppliedMetricFilters] = useState<MetricFilters>(metricFilters);
  const [ignoreFailTraffic, setIgnoreFailTraffic] = useState(() => readUrlFlag(searchParams, IGNORE_FAIL_PARAM));
  const [appliedIgnoreFailTraffic, setAppliedIgnoreFailTraffic] = useState(ignoreFailTraffic);
  const [filterOpen, setFilterOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [graphOpen, setGraphOpen] = useState(false);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [orderBy, setOrderBy] = useState<OrderMetric>((searchParams.get('orderBy') as OrderMetric) || 'conversions');
  const [orderDir, setOrderDir] = useState<'asc' | 'desc'>((searchParams.get('orderDir') as 'asc' | 'desc') || 'desc');
  const [page, setPage] = useState(1);
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
  // Filters flyout already uses for its own presets); Copy Link is real (the whole report state —
  // dates, filters, sort — round-trips through the URL); Show API Request is real.
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [savedReports, setSavedReports] = useState(() => loadSavedReports<OrderMetric>('offer-report'));
  const [copied, setCopied] = useState(false);
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

  const offerIdFilter = appliedFilters['offer']?.join(',');
  const advertiserIdFilter = appliedFilters['advertiser']?.join(',');
  const publisherIdFilter = appliedFilters['partner']?.join(',');
  const countryFilter = appliedFilters['country']?.join(',');
  const deviceFilter = appliedFilters['device']?.join(',');
  const excludeOfferId = appliedExclusions['offer']?.join(',');
  const excludeAdvertiserId = appliedExclusions['advertiser']?.join(',');
  const excludePublisherId = appliedExclusions['partner']?.join(',');
  const excludeCountry = appliedExclusions['country']?.join(',');
  const excludeDevice = appliedExclusions['device']?.join(',');

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };

  // Keep the URL in sync with the applied (not draft) report state, so "Copy Link to Report" — and
  // this page's own address bar — always reflects a real, re-loadable report configuration.
  useEffect(() => {
    const next = new URLSearchParams();
    next.set('from', appliedFrom);
    next.set('to', appliedTo);
    writeUrlFilters(next, 'f', appliedFilters);
    writeUrlFilters(next, 'x', appliedExclusions);
    writeUrlMetricFilters(next, appliedMetricFilters);
    if (appliedIgnoreFailTraffic) next.set(IGNORE_FAIL_PARAM, '1');
    next.set('orderBy', orderBy);
    next.set('orderDir', orderDir);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedFrom, appliedTo, JSON.stringify(appliedFilters), JSON.stringify(appliedExclusions), JSON.stringify(appliedMetricFilters), appliedIgnoreFailTraffic, orderBy, orderDir]);

  const dimParams = {
    offerId: offerIdFilter, advertiserId: advertiserIdFilter, publisherId: publisherIdFilter,
    country: countryFilter, device: deviceFilter,
    excludeOfferId, excludeAdvertiserId, excludePublisherId, excludeCountry, excludeDevice,
    excludeInvalid: appliedIgnoreFailTraffic ? 1 : undefined,
  };

  // Summary tiles: one exact grand-total row (groupBy=none) — summing the top-N grouped rows
  // undercounted as soon as there were more groups than the page limit.
  const summaryQs = qs({ groupBy: 'none', metrics: METRICS_PARAM, from: toIso(appliedFrom), to: toIso(appliedTo, true), ...dimParams });
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

  const graphQs = qs({ groupBy: 'day', metrics: 'clicks,revenue', from: toIso(appliedFrom), to: toIso(appliedTo, true), ...dimParams, limit: 200 });
  const { data: graphData, loading: graphLoading, error: graphError } = useQuery<AggResult>(graphOpen ? `/api/reports?${graphQs}` : null);
  const graphSeries = useMemo(() => {
    const rows = [...(graphData?.rows ?? [])].sort((a, b) => (a.dimensions['day'] ?? '').localeCompare(b.dimensions['day'] ?? ''));
    return {
      labels: rows.map((r) => (r.dimensions['day'] ?? '').slice(0, 10)),
      revenue: rows.map((r) => num(r.metrics['revenue'] ?? 0)),
      clicks: rows.map((r) => num(r.metrics['clicks'] ?? 0)),
    };
  }, [graphData]);

  const tableParams = {
    groupBy: 'offer', metrics: METRICS_PARAM,
    from: toIso(appliedFrom), to: toIso(appliedTo, true), ...dimParams,
    orderBy, orderDir,
  };
  const tableQs = qs({ ...tableParams, limit: pageSize, offset: (page - 1) * pageSize });
  const { data, loading, error, refetch: refetchTable } = useQuery<AggResult>(`/api/reports?${tableQs}`);

  const toRows = useCallback((src: AggRow[]) => src
    .filter((r) => r.dimensions['offer'])
    .map((r) => {
      const offer = offers?.find((o) => o.id === r.dimensions['offer']);
      return { offerId: r.dimensions['offer']!, offerName: offer?.name ?? r.dimensions['offer']!.slice(0, 8), offerStatus: offer?.status, offerVisibility: offer?.visibility, derived: deriveRow(r.metrics) };
    }), [offers]);
  const rows = useMemo(() => toRows(data?.rows ?? [])
    .filter((r) => !q.trim() || r.offerName.toLowerCase().includes(q.trim().toLowerCase()))
    .filter((r) => passesMetricFilters(r.derived, appliedMetricFilters)),
  [data, toRows, q, appliedMetricFilters]);

  const runReport = () => {
    setAppliedFrom(from); setAppliedTo(to); setAppliedFilters(filters);
    setAppliedExclusions(exclusions); setAppliedMetricFilters(metricFilters); setAppliedIgnoreFailTraffic(ignoreFailTraffic);
    setPage(1);
  };
  const clearAll = () => {
    setFrom(daysAgo(30)); setTo(todayStr()); setFilters({}); setExclusions({}); setMetricFilters({}); setIgnoreFailTraffic(false);
    setAppliedFrom(daysAgo(30)); setAppliedTo(todayStr()); setAppliedFilters({});
    setAppliedExclusions({}); setAppliedMetricFilters({}); setAppliedIgnoreFailTraffic(false);
    setPage(1);
  };

  const toggleSort = (metric: OrderMetric) => {
    if (orderBy === metric) setOrderDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setOrderBy(metric); setOrderDir('desc'); }
    setPage(1);
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
  // search box is a page-local filter and does not apply here.
  const exp = useReportExport();
  const runExport = (format: 'csv' | 'xlsx') => {
    setTableActionsOpen(false); setExportOpen(false);
    void exp.run(format, 'offer-report', async () => {
      const r = await fetchAllPages<AggRow>((limit, offset) => `/api/reports?${qs({ ...tableParams, limit, offset })}`, 200);
      return { rows: toRows(r.rows).filter((x) => passesMetricFilters(x.derived, appliedMetricFilters)).map(exportRow), capped: r.capped, total: r.total };
    });
  };
  const appliedReporting: ReportingFiltersValue = { filters: appliedFilters, exclusions: appliedExclusions, metricFilters: appliedMetricFilters, ignoreFailTraffic: appliedIgnoreFailTraffic };
  const setReporting = (v: ReportingFiltersValue) => {
    setFilters(v.filters); setAppliedFilters(v.filters);
    setExclusions(v.exclusions); setAppliedExclusions(v.exclusions);
    setMetricFilters(v.metricFilters); setAppliedMetricFilters(v.metricFilters);
    setIgnoreFailTraffic(v.ignoreFailTraffic); setAppliedIgnoreFailTraffic(v.ignoreFailTraffic);
    setPage(1);
  };

  const sortIcon = (metric: OrderMetric) => (orderBy === metric ? (orderDir === 'desc' ? '↓' : '↑') : '');
  const sortableHeader = (label: string, metric: OrderMetric) => (
    <th className="cursor-pointer whitespace-nowrap px-4 py-3 text-right font-semibold" onClick={() => toggleSort(metric)}>{label} {sortIcon(metric)}</th>
  );

  const saveReport = (name: string) => {
    const config: SavedConfig = { from, to, filters, exclusions, metricFilters, ignoreFailTraffic, orderBy, orderDir, hiddenColumns: [...hiddenColumns] };
    const next = [...savedReports.filter((s) => s.name !== name), { name, config }];
    setSavedReports(next);
    persistSavedReports('offer-report', next);
    setPageMenuOpen(false);
  };
  const applySavedReport = (config: SavedConfig) => {
    setFrom(config.from); setTo(config.to); setFilters(config.filters);
    setExclusions(config.exclusions ?? {}); setMetricFilters(config.metricFilters ?? {}); setIgnoreFailTraffic(config.ignoreFailTraffic ?? false);
    setAppliedFrom(config.from); setAppliedTo(config.to); setAppliedFilters(config.filters);
    setAppliedExclusions(config.exclusions ?? {}); setAppliedMetricFilters(config.metricFilters ?? {}); setAppliedIgnoreFailTraffic(config.ignoreFailTraffic ?? false);
    setOrderBy(config.orderBy); setOrderDir(config.orderDir);
    setHiddenColumns(new Set(config.hiddenColumns));
    setPage(1); setPageMenuOpen(false); setLoadOpen(false);
  };
  const deleteSavedReport = (name: string) => {
    const next = savedReports.filter((s) => s.name !== name);
    setSavedReports(next);
    persistSavedReports('offer-report', next);
  };
  const copyLink = async () => {
    await navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <>
      <PageHeader title="Offer Report" subtitle="Reporting › Offer" action={
        <div className="flex items-center gap-3">
          <span className="text-small text-fg-secondary" title="Report times are UTC">UTC · {currency}</span>
          <div ref={pageMenuRef} className="relative">
            <button type="button" title="Page Actions" onClick={() => setPageMenuOpen((o) => !o)}
              className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
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
                <button onClick={() => { copyLink(); setPageMenuOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">{copied ? 'Copied!' : 'Copy Link to Report'}</button>
                <button onClick={() => { setPageMenuOpen(false); setShowApiRequest(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Show API Request</button>
              </div>
            )}
          </div>
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

      <div className="card mb-4">
        <button type="button" onClick={() => setSummaryOpen((o) => !o)} className="flex w-full items-center gap-2 text-small font-medium text-fg">
          <ChevronDown size={14} className={`transition-transform ${summaryOpen ? '' : '-rotate-90'}`} /> Summary
        </button>
        {summaryOpen && (
          summaryLoading ? <div className="pt-4"><Spinner /></div> : summaryError ? <p className="pt-3 text-small text-danger-text">{summaryError}</p> : !summary ? <p className="pt-3 text-small text-fg-muted">No data for this period.</p> : (
            <SummaryGrid summary={summary} />
          )
        )}
      </div>

      <div className="card mb-4">
        <button type="button" onClick={() => setGraphOpen((o) => !o)} className="flex w-full items-center gap-2 text-small font-medium text-fg">
          <ChevronRight size={14} className={`transition-transform ${graphOpen ? 'rotate-90' : ''}`} /> Performance Graph
        </button>
        {graphOpen && (
          graphLoading || (!graphData && !graphError) ? <div className="pt-4"><Spinner /></div> : graphError ? <p className="pt-3 text-small text-danger-text">{graphError}</p> : graphSeries.labels.length === 0 ? <p className="pt-3 text-small text-fg-muted">No data for this period.</p> : (
            <div className="pt-4">
              {graphSeries.labels.length >= 200 && <p className="mb-2 text-tiny text-fg-muted">Graph shows the first {graphSeries.labels.length} days — narrow the date range to see the rest.</p>}
              <div className="mb-2 flex items-center gap-4 text-tiny text-fg-secondary">
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded bg-accent-text" /> Revenue</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 bg-fg-muted" /> Clicks</span>
              </div>
              <MiniChart labels={graphSeries.labels} revenue={graphSeries.revenue} clicks={graphSeries.clicks} />
            </div>
          )
        )}
      </div>

      <div className="card">
        <ActiveFilterChips className="mb-3"
          chips={reportingChips(FILTER_CATEGORIES, appliedReporting)}
          onRemove={(c) => setReporting(withoutReportingChip(appliedReporting, c))}
          onClearAll={() => setReporting(EMPTY_REPORTING_FILTERS)} />
        <ExportStatus {...exp} onDismiss={exp.dismiss} />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-h3 font-medium text-fg">Detailed Report</h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input className="input !w-56 !pl-8" placeholder="Search this page…" title="Filters only the rows on the current page" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div ref={tableActionsRef} className="relative">
              <button type="button" title="Table Actions" onClick={() => setTableActionsOpen((o) => !o)}
                className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
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
          </div>
        </div>

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
                  {rows.map((r) => (
                    <Fragment key={r.offerId}>
                      <tr>
                        <td >
                          <button type="button" onClick={() => toggleExpand(r.offerId)} className="inline-flex items-center gap-1.5 text-fg hover:text-accent-text">
                            <ChevronRight size={13} className={`transition-transform ${expanded.has(r.offerId) ? 'rotate-90' : ''}`} />
                            <span className={`h-2 w-2 rounded-full ${r.offerStatus === 'active' ? 'bg-success' : 'bg-fg-muted'}`} />
                            {r.offerName}
                          </button>
                        </td>
                        {metricCells(shown, r.derived)}
                        <td className="text-right">
                          <RowActionMenu offer={{ id: r.offerId, name: r.offerName, visibility: r.offerVisibility }} publishers={publishers ?? []} onChanged={() => { refetchOffers(); refetchTable(); }} />
                        </td>
                      </tr>
                      {expanded.has(r.offerId) && <ExpandedPartnerRows offerId={r.offerId} colSpanBefore={1} shown={shown} dimParams={dimParams} from={appliedFrom} to={appliedTo} />}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        <div className="mt-3 flex justify-end">
          <Pagination total={data?.total ?? 0} page={page} pageSize={pageSize} onPageChange={setPage} />
        </div>
      </div>

      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={[...ALL_COLUMNS]} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(_o, h) => setHiddenColumns(h)} />}
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, offer: offerIdFilter, advertiser: advertiserIdFilter, partner: publisherIdFilter, country: countryFilter, device: deviceFilter,
        excludeOffer: excludeOfferId, excludeAdvertiser: excludeAdvertiserId, excludePartner: excludePublisherId, excludeCountry, excludeDevice,
        ignoreFailTraffic: appliedIgnoreFailTraffic ? 'true' : undefined,
      }} />}
      <PromptModal open={saveModalOpen} onClose={() => setSaveModalOpen(false)} title="Save Report" message="Name this saved report:" placeholder="e.g. Offer Overview" onConfirm={saveReport} />
    </>
  );
}
