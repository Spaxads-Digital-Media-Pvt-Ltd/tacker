/**
 * Reporting › Advertiser Postback — verified against the live reference (URL
 * `/reporting/advertisers/postbacks`, 236 real rows: Date | Partner | Offer | Advertiser | Postback
 * URL | Conversion ID | Transaction ID | Status | CV Method | Revenue | Payout, no Summary/graph).
 * Reuses the same `GET /api/reports/conversions` endpoint as Conversion Report (already extended
 * with `raw_params` for this page), filtered client-side to `source !== 'manual'` — an inbound
 * advertiser postback/pixel/iframe hit IS a conversion row in this schema, so this report is that
 * same data read as "what advertisers sent us" rather than "what we recorded."
 *
 * Real gap, stated plainly: this app has no raw inbound-attempt log — `recordConversion()`
 * (api-backend/src/surfaces/tracking/conversions/record.ts) only writes a `conversions` row for
 * requests that pass idempotency/click-match/security checks. A request that fails before that point
 * (duplicate, click not found, bad secure_code) returns an HTTP response but is never persisted
 * anywhere, so — unlike the reference, whose sample row showed an "Invalid" status with no
 * Conversion ID — this report can only show attempts that succeeded far enough to become a real
 * conversion row. There is no fabricated "Invalid" row here.
 *
 * Column mapping: Postback URL → this schema doesn't store the raw inbound request URL, but it does
 * store the raw query params received (`conversions.raw_params`, real) — shown here as "Payload"
 * (compact JSON) rather than a reconstructed URL that could be wrong. CV Method → `source`
 * (postback/pixel/iframe, real).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, MoreVertical, ChevronRight, ChevronLeft } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock, Badge } from '../../components/ui';
import { FilterButton, CategorizedFiltersFlyout, appliedFilterCount, type FilterCategory, type FilterValues } from '../../components/CategorizedFilters';
import { ColumnsModal, ApiRequestModal } from '../../components/TableActionsKit';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import { daysAgo, todayStr, toIso, DASH } from '../../components/ReportPageKit';
import type { Advertiser, Offer, Publisher } from '../../types';

interface ConvRow {
  conversion_id: string; created_at: string; offer_id: string;
  publisher_id: string | null; advertiser_id: string | null;
  status: string; reason: string | null; payout: string | null; revenue: string | null;
  currency: string | null; transaction_id: string | null; source: string;
  raw_params: Record<string, unknown> | null;
}

const ALL_COLUMNS = ['Partner', 'Offer', 'Advertiser', 'Payload', 'Conversion ID', 'Transaction ID', 'Status', 'CV Method', 'Revenue', 'Payout'] as const;

function formatDate(iso: string): string {
  const d = new Date(iso);
  const date = `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
  return `${date} ${time}`;
}
function money(v: string | null): string {
  return v == null ? DASH : `$${Number(v).toFixed(2)}`;
}
function payloadPreview(p: Record<string, unknown> | null): string {
  if (!p || Object.keys(p).length === 0) return DASH;
  return Object.entries(p).map(([k, v]) => `${k}=${v}`).join('&');
}

const METHOD_OPTIONS = [
  { value: 'postback', label: 'Server Postback' },
  { value: 'pixel', label: 'Pixel' },
  { value: 'iframe', label: 'iFrame' },
];

export default function AdvertiserPostbackReport() {
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(todayStr());
  const [appliedFrom, setAppliedFrom] = useState(from);
  const [appliedTo, setAppliedTo] = useState(to);
  const [filters, setFilters] = useState<FilterValues>({});
  const [appliedFilters, setAppliedFilters] = useState<FilterValues>({});
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

  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const offerMap = useMemo(() => new Map((offers ?? []).map((o) => [o.id, o.name])), [offers]);
  const pubMap = useMemo(() => new Map((publishers ?? []).map((p) => [p.id, p.name])), [publishers]);
  const advMap = useMemo(() => new Map((advertisers ?? []).map((a) => [a.id, a.name])), [advertisers]);

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'offer', label: 'Offer', options: (offers ?? []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'advertiser', label: 'Advertiser', options: (advertisers ?? []).map((a) => ({ value: a.id, label: a.name })) },
    { key: 'partner', label: 'Partner', options: (publishers ?? []).map((p) => ({ value: p.id, label: p.name })) },
    { key: 'method', label: 'CV Method', options: METHOD_OPTIONS },
  ], [offers, advertisers, publishers]);

  const offerIdFilter = appliedFilters['offer']?.[0];
  const advertiserIdFilter = appliedFilters['advertiser']?.[0];
  const publisherIdFilter = appliedFilters['partner']?.[0];
  const methodFilter = appliedFilters['method']?.[0];

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };

  const tableQs = qs({
    from: toIso(appliedFrom), to: toIso(appliedTo, true),
    offerId: offerIdFilter, publisherId: publisherIdFilter, advertiserId: advertiserIdFilter, source: methodFilter,
    limit: pageSize + 1, offset: (page - 1) * pageSize,
  });
  const { data, loading, error } = useQuery<ConvRow[]>(hasRun ? `/api/reports/conversions?${tableQs}` : null);
  const advertiserSourced = useMemo(() => (data ?? []).filter((r) => r.source !== 'manual'), [data]);
  const hasNextPage = advertiserSourced.length > pageSize;
  const pageRows = advertiserSourced.slice(0, pageSize);

  const rows = useMemo(() => pageRows.filter((r) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    const offerName = offerMap.get(r.offer_id) ?? '';
    const pubName = r.publisher_id ? (pubMap.get(r.publisher_id) ?? '') : '';
    const advName = r.advertiser_id ? (advMap.get(r.advertiser_id) ?? '') : '';
    return [offerName, pubName, advName, r.transaction_id, r.conversion_id]
      .some((v) => (v ?? '').toLowerCase().includes(needle));
  }), [pageRows, q, offerMap, pubMap, advMap]);

  const runReport = () => {
    setAppliedFrom(from); setAppliedTo(to); setAppliedFilters(filters);
    setHasRun(true); setPage(1);
  };
  const clearAll = () => {
    setFrom(daysAgo(7)); setTo(todayStr()); setFilters({});
    setAppliedFrom(daysAgo(7)); setAppliedTo(todayStr()); setAppliedFilters({});
    setPage(1);
  };

  const shown = useMemo(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const exportRows = () => rows.map((r) => ({
    date: formatDate(r.created_at),
    partner: r.publisher_id ? (pubMap.get(r.publisher_id) ?? r.publisher_id) : DASH,
    offer: offerMap.get(r.offer_id) ?? r.offer_id,
    advertiser: r.advertiser_id ? (advMap.get(r.advertiser_id) ?? r.advertiser_id) : DASH,
    payload: payloadPreview(r.raw_params), conversionId: r.conversion_id, transactionId: r.transaction_id ?? DASH,
    status: r.status, cvMethod: METHOD_OPTIONS.find((m) => m.value === r.source)?.label ?? r.source,
    revenue: money(r.revenue), payout: money(r.payout),
  }));

  const copyLink = async () => {
    await navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <>
      <PageHeader title="Advertiser Postback Report" subtitle="Reporting › Advertiser Postback" action={
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
            <label className="label mb-1 block">From</label>
            <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label mb-1 block">To</label>
            <input type="date" className="input" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="relative">
            <FilterButton count={appliedFilterCount(appliedFilters)} onClick={() => setFilterOpen((o) => !o)} />
            {filterOpen && (
              <CategorizedFiltersFlyout
                categories={FILTER_CATEGORIES}
                values={filters}
                onApply={setFilters}
                onClose={() => setFilterOpen(false)}
                storageKey="advertiser-postback-report"
              />
            )}
          </div>
          <button type="button" className="text-small font-medium text-accent-text hover:underline" onClick={clearAll}>Clear</button>
          <div className="flex-1" />
          <button type="button" className="btn-primary" onClick={runReport}>Run Report</button>
        </div>
      </div>

      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-h3 font-medium text-fg">Detailed Report</h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input className="input !w-56 !pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
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
                        <button onClick={() => { downloadCsv('advertiser-postback-report.csv', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">CSV</button>
                        <button onClick={() => { downloadXlsx('advertiser-postback-report.xlsx', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Excel</button>
                      </div>
                    )}
                  </div>
                  <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {!hasRun ? <StateBlock>Set parameters and run report</StateBlock>
          : loading ? <StateBlock><Spinner /></StateBlock>
          : error ? <StateBlock>{error}</StateBlock>
          : !rows.length ? <StateBlock>No Record Found</StateBlock>
          : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full min-w-[1900px] text-left text-body">
                <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Date</th>
                    {shown.has('Partner') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Partner</th>}
                    {shown.has('Offer') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Offer</th>}
                    {shown.has('Advertiser') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Advertiser</th>}
                    {shown.has('Payload') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Payload</th>}
                    {shown.has('Conversion ID') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Conversion ID</th>}
                    {shown.has('Transaction ID') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Transaction ID</th>}
                    {shown.has('Status') && <th className="whitespace-nowrap px-4 py-3 font-semibold">Status</th>}
                    {shown.has('CV Method') && <th className="whitespace-nowrap px-4 py-3 font-semibold">CV Method</th>}
                    {shown.has('Revenue') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Revenue</th>}
                    {shown.has('Payout') && <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Payout</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.conversion_id} className="hover:bg-accent-subtle/40">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-fg">{formatDate(r.created_at)}</td>
                      {shown.has('Partner') && <td className="px-4 py-3">{r.publisher_id ? <Link to={`/app/publishers/${r.publisher_id}`} className="text-accent-text hover:underline">{pubMap.get(r.publisher_id) ?? r.publisher_id}</Link> : DASH}</td>}
                      {shown.has('Offer') && <td className="px-4 py-3"><Link to={`/app/offers/${r.offer_id}`} className="text-accent-text hover:underline">{offerMap.get(r.offer_id) ?? r.offer_id}</Link></td>}
                      {shown.has('Advertiser') && <td className="px-4 py-3">{r.advertiser_id ? <Link to={`/app/advertisers/${r.advertiser_id}`} className="text-accent-text hover:underline">{advMap.get(r.advertiser_id) ?? r.advertiser_id}</Link> : DASH}</td>}
                      {shown.has('Payload') && <td className="max-w-xs truncate px-4 py-3 font-mono text-tiny" title={payloadPreview(r.raw_params)}>{payloadPreview(r.raw_params)}</td>}
                      {shown.has('Conversion ID') && <td className="whitespace-nowrap px-4 py-3 font-mono text-tiny">{r.conversion_id.slice(0, 12)}…</td>}
                      {shown.has('Transaction ID') && <td className="whitespace-nowrap px-4 py-3 font-mono text-tiny">{r.transaction_id ?? DASH}</td>}
                      {shown.has('Status') && <td className="px-4 py-3"><Badge value={r.status} /></td>}
                      {shown.has('CV Method') && <td className="px-4 py-3">{METHOD_OPTIONS.find((m) => m.value === r.source)?.label ?? r.source}</td>}
                      {shown.has('Revenue') && <td className="px-4 py-3 text-right">{money(r.revenue)}</td>}
                      {shown.has('Payout') && <td className="px-4 py-3 text-right">{money(r.payout)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {hasRun && rows.length > 0 && (
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
      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={`/api/reports/conversions?${tableQs}`} appliedFilters={{
        from: appliedFrom, to: appliedTo, offer: offerIdFilter, advertiser: advertiserIdFilter, partner: publisherIdFilter, method: methodFilter,
      }} />}
    </>
  );
}
