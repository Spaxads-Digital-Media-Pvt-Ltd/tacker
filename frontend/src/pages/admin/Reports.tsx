/**
 * Legacy `/app/reports/:type` hub: redirects old report links to the dedicated report pages, and
 * hosts the Offline and Import & Export logs.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import { SearchFilterDrawer, FieldBlock } from '../../shared-components/primitives/SearchFilterDrawer';
import { PageHeader, Table, Badge, Spinner, StateBlock, type Column } from '../../shared-components/primitives/ui';
import type { Offer, Publisher, Advertiser } from '../../types';

// ── Option context ────────────────────────────────────────────────────────────
// Exported for Analytics.tsx, which shares these option lists.
export interface Opt { value: string; label: string }
export type RefMap = Map<string, { ref?: number; name: string }>;
export interface Opts { offers: Opt[]; publishers: Opt[]; advertisers: Opt[]; smartLinks: Opt[]; offerMap: RefMap; pubMap: RefMap; advMap: RefMap }
const emptyMap: RefMap = new Map();
export const OptsCtx = createContext<Opts>({ offers: [], publishers: [], advertisers: [], smartLinks: [], offerMap: emptyMap, pubMap: emptyMap, advMap: emptyMap });

/** Loads the offer/publisher/advertiser/smart-link option lists shared by every report page. */
export function useReportOpts(): Opts {
  const offers = useQuery<Offer[]>('/api/offers');
  const publishers = useQuery<Publisher[]>('/api/publishers');
  const advertisers = useQuery<Advertiser[]>('/api/advertisers');
  const smartLinks = useQuery<{ id: string; name: string }[]>('/api/smart-links');
  return {
    offers: (offers.data ?? []).map((o) => ({ value: o.id, label: o.ref != null ? `(${o.ref}) ${o.name}` : o.name })),
    publishers: (publishers.data ?? []).map((p) => ({ value: p.id, label: p.ref != null ? `(${p.ref}) ${p.name}` : p.name })),
    advertisers: (advertisers.data ?? []).map((a) => ({ value: a.id, label: a.ref != null ? `(${a.ref}) ${a.name}` : a.name })),
    smartLinks: (smartLinks.data ?? []).map((s) => ({ value: s.id, label: s.name })),
    offerMap: new Map((offers.data ?? []).map((o) => [o.id, { ref: o.ref, name: o.name }])),
    pubMap: new Map((publishers.data ?? []).map((p) => [p.id, { ref: p.ref, name: p.name }])),
    advMap: new Map((advertisers.data ?? []).map((a) => [a.id, { ref: a.ref, name: a.name }])),
  };
}

const TITLES: Record<string, string> = {
  offer: 'Offer Report', affiliate: 'Affiliate Report', advertiser: 'Advertiser Report',
  daily: 'Daily Report', goals: 'Goals Report', smartlink: 'Smart Link Report', custom: 'Custom Report',
  clicks: 'Clicks Report', conversions: 'Conversions Report', cap: 'Cap Report',
  'postback-logs': 'Postback Logs Report', offline: 'Offline Report', 'import-export': 'Import & Export Logs',
};

/**
 * Legacy `/app/reports/:type` hub. Each report type below now has a dedicated page with working
 * filters (this hub's drawers collected filters it never sent), so old links/bookmarks redirect
 * there, carrying the entity + date params those pages read on load.
 */
const LEGACY_REDIRECT: Record<string, string> = {
  offer: '/app/reports/offer', affiliate: '/app/reports/partner', advertiser: '/app/reports/advertiser',
  daily: '/app/reports/daily', smartlink: '/app/reports/smartlink', custom: '/app/analytics',
  goals: '/app/reports/event', clicks: '/app/reports/click', conversions: '/app/reports/conversion',
  cap: '/app/reports/pacing', 'postback-logs': '/app/reports/partner-postback',
};
const CARRIED_PARAMS = ['offerId', 'publisherId', 'advertiserId', 'smartLinkId', 'from', 'to'];

export default function Reports() {
  const { type = 'offer' } = useParams();
  const [searchParams] = useSearchParams();
  const target = LEGACY_REDIRECT[type];
  if (target) {
    const carried = new URLSearchParams();
    for (const k of CARRIED_PARAMS) { const v = searchParams.get(k); if (v) carried.set(k, v); }
    const q = carried.toString();
    return <Navigate to={q ? `${target}?${q}` : target} replace />;
  }
  return <LegacyReport type={type} />;
}

function LegacyReport({ type }: { type: string }) {
  const opts = useReportOpts();
  return (
    <OptsCtx.Provider value={opts}>
      <PageHeader title={TITLES[type] ?? 'Report'} subtitle={`Reports › ${TITLES[type] ?? type}`} />
      <Section name={type} />
    </OptsCtx.Provider>
  );
}

function Section({ name }: { name: string }) {
  switch (name) {
    case 'offline': return <OfflineReport />;
    case 'import-export': return <ImportExportReport />;
    default: return <StateBlock>{name} report — not available yet.</StateBlock>;
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────
const short = (v: unknown) => (v == null ? '—' : String(v).slice(0, 8) + '…');
const money = (v: unknown) => (v == null ? '—' : `$${v}`);
const dt = (v: unknown) => (v == null ? '—' : new Date(String(v)).toLocaleString());

type FilterState = Record<string, string>;
type FKey =
  | 'from' | 'to' | 'offerId' | 'publisherId' | 'advertiserId' | 'smartLinkId'
  | 'country' | 'region' | 'city' | 'device' | 'os' | 'browser'
  | 'sub1' | 'sub2' | 'sub3' | 'sub4' | 'sub5'
  | 'event' | 'source' | 'currency' | 'status' | 'success' | 'isUnique' | 'fraudMin';


function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center justify-between gap-3">{children}</div>;
}

function FiltersBtn({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button type="button" className="btn-ghost relative" onClick={onClick}>
      <span aria-hidden>⛃</span> Filters
      {count > 0 && (
        <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">
          {count}
        </span>
      )}
    </button>
  );
}

interface OffRow { conversion_id: string; created_at: string; offer_id: string; publisher_id: string | null; event_name: string | null; status: string; payout: string | null; revenue: string | null }
function OfflineReport() {
  const opts = useContext(OptsCtx);
  const cols: Column<OffRow>[] = [
    { header: 'Time', cell: (r) => dt(r.created_at) },
    { header: 'Conv', cell: (r) => <span className="font-mono text-xs">{r.conversion_id.slice(0, 10)}…</span> },
    { header: 'Offer', cell: (r) => { const m = opts.offerMap.get(r.offer_id); return <span className="text-brand-600">{m ? `(${m.ref ?? '—'}) ${m.name}` : short(r.offer_id)}</span>; } },
    { header: 'Event', cell: (r) => r.event_name ?? '—' },
    { header: 'Status', cell: (r) => <Badge value={r.status} /> },
    { header: 'Payout', className: 'text-right', cell: (r) => money(r.payout) },
    { header: 'Revenue', className: 'text-right', cell: (r) => money(r.revenue) },
  ];
  const { data, loading, error } = useQuery<OffRow[]>('/api/offline/conversions');
  return (
    <>
      <Toolbar>
        <p className="text-small text-fg-secondary">{data ? `${data.length} rows` : ''}</p>
        <Link to="/app/conversions/add" className="btn-primary">Record offline conversion</Link>
      </Toolbar>
      {loading ? <StateBlock><Spinner /></StateBlock> : error ? <StateBlock>{error}</StateBlock>
        : !data?.length ? <StateBlock>No offline conversions recorded.</StateBlock>
        : <Table columns={cols} rows={data} rowKey={(r) => r.conversion_id} />}
    </>
  );
}

interface IeRow { id: string; kind: string; entity: string; status: string; row_count: number; detail: string | null; created_at: string }
const EXPORT_KEYS: FKey[] = ['from', 'to', 'offerId', 'publisherId', 'status', 'source'];
function ImportExportReport() {
  const { data, loading, error, refetch } = useQuery<IeRow[]>('/api/import-export');
  const [f, setF] = useState<FilterState>({});
  const [open, setOpen] = useState(false);
  const exp = useMutation((body: Record<string, unknown>) => api.post<{ entity: string; rowCount: number; rows: Record<string, unknown>[] }>('/api/import-export/export', body));

  const run = async (entity: string, format: 'csv' | 'xlsx') => {
    const body: Record<string, unknown> = { entity };
    for (const k of EXPORT_KEYS) if (f[k]) body[k] = f[k];
    try {
      const res = await exp.run(body);
      if (res && res.rows.length) {
        const name = `${entity}.${format}`;
        if (format === 'csv') downloadCsv(name, res.rows); else await downloadXlsx(name, res.rows);
      }
    } catch { /* exp.error is rendered below */ }
    refetch();
  };

  const cols: Column<IeRow>[] = [
    { header: 'Time', cell: (r) => dt(r.created_at) },
    { header: 'Kind', cell: (r) => <Badge value={r.kind === 'export' ? 'active' : 'pending'} /> },
    { header: 'Entity', cell: (r) => r.entity },
    { header: 'Rows', className: 'text-right', cell: (r) => String(r.row_count) },
    { header: 'Status', cell: (r) => <Badge value={r.status === 'completed' ? 'approved' : 'rejected'} /> },
    { header: 'Detail', cell: (r) => r.detail ?? '' },
  ];
  const applied = EXPORT_KEYS.filter((k) => f[k]).length;

  return (
    <>
      {exp.error && <p className="mb-3 rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{exp.error}</p>}
      <Toolbar>
        <div className="flex flex-wrap gap-2">
          <span className="self-center text-small text-fg-secondary">Export Conversions:</span>
          <button type="button" className="btn-ghost border border-border" disabled={exp.busy} onClick={() => run('conversions', 'csv')}>CSV</button>
          <button type="button" className="btn-ghost border border-border" disabled={exp.busy} onClick={() => run('conversions', 'xlsx')}>Excel</button>
          <span className="ml-4 self-center text-small text-fg-secondary">Clicks:</span>
          <button type="button" className="btn-ghost border border-border" disabled={exp.busy} onClick={() => run('clicks', 'csv')}>CSV</button>
          <button type="button" className="btn-ghost border border-border" disabled={exp.busy} onClick={() => run('clicks', 'xlsx')}>Excel</button>
        </div>
        <FiltersBtn count={applied} onClick={() => setOpen(true)} />
      </Toolbar>
      {loading ? <StateBlock><Spinner /></StateBlock> : error ? <StateBlock>{error}</StateBlock>
        : !data?.length ? <StateBlock>No import/export activity yet.</StateBlock>
        : <Table columns={cols} rows={data} rowKey={(r) => r.id} />}
      {open && (
        <SearchFilterDrawer appliedCount={applied} onClose={() => setOpen(false)} onApply={() => setOpen(false)}>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <FieldBlock label="From"><input type="date" className="input" value={f.from ?? ''} onChange={(e) => setF((s) => ({ ...s, from: e.target.value }))} /></FieldBlock>
            <FieldBlock label="To"><input type="date" className="input" value={f.to ?? ''} onChange={(e) => setF((s) => ({ ...s, to: e.target.value }))} /></FieldBlock>
          </div>
          <FieldBlock label="Status">
            <select className="input" value={f.status ?? ''} onChange={(e) => setF((s) => ({ ...s, status: e.target.value }))}>
              <option value="">Any</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </select>
          </FieldBlock>
        </SearchFilterDrawer>
      )}
    </>
  );
}
