/**
 * Reports hub — Trackog-style UI: right Search Filter drawer, checkbox-driven Group By /
 * Report Options / column fields, per-page defaults from Trackog screenshots, light theme.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { RefreshCw, Settings2, Plus, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import {
  SearchFilterDrawer, EntitySearchSelect, CheckboxGrid, CompactCheckboxGrid, FieldBlock,
} from '../../components/SearchFilterDrawer';
import { PageHeader, Table, Badge, Spinner, StateBlock, type Column } from '../../components/ui';
import type { Offer, Publisher, Advertiser } from '../../types';
import {
  GROUP_BY_ALL, REPORT_OPTIONS, DEFAULT_METRICS, DEFAULT_GROUP_BY, COMPACT_EXTRA_DIMS,
  CLICK_COLUMNS, DEFAULT_CLICK_COLUMNS, CONVERSION_COLUMNS, DEFAULT_CONVERSION_COLUMNS,
  POSTBACK_COLUMNS, DEFAULT_POSTBACK_COLUMNS,
  toApiGroupBy, toApiMetrics, metricLabel, dimLabel,
} from '../../lib/reportFilters';

// ── Option context ────────────────────────────────────────────────────────────
// Exported so Analytics.tsx's "Flex" tab can reuse GroupedReport (identical to the Custom report).
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

export default function Reports() {
  const { type = 'offer' } = useParams();
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
    case 'offer':
    case 'affiliate':
    case 'advertiser':
    case 'daily':
    case 'custom':
    case 'smartlink':
      return <GroupedReport page={name} />;
    case 'goals': return <Goals />;
    case 'clicks': return <ClicksReport />;
    case 'conversions': return <ConversionsReport />;
    case 'cap': return <CapReport />;
    case 'postback-logs': return <PostbackLogs />;
    case 'offline': return <OfflineReport />;
    case 'import-export': return <ImportExportReport />;
    default: return <StateBlock>{name} report — not available yet.</StateBlock>;
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────
const short = (v: unknown) => (v == null ? '—' : String(v).slice(0, 8) + '…');
const money = (v: unknown) => (v == null ? '—' : `$${v}`);
const dt = (v: unknown) => (v == null ? '—' : new Date(String(v)).toLocaleString());
const num2 = (v: unknown) => new Intl.NumberFormat('en-US').format(Number(v || 0));
const cash2 = (v: unknown) => `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v || 0))}`;

type FilterState = Record<string, string>;
type FKey =
  | 'from' | 'to' | 'offerId' | 'publisherId' | 'advertiserId' | 'smartLinkId'
  | 'country' | 'region' | 'city' | 'device' | 'os' | 'browser'
  | 'sub1' | 'sub2' | 'sub3' | 'sub4' | 'sub5'
  | 'event' | 'source' | 'currency' | 'status' | 'success' | 'isUnique' | 'fraudMin';

interface AggRow { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }
interface AggResult { rows: AggRow[] }

function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center justify-between gap-3">{children}</div>;
}

/** Row-level reports (Clicks/Conversions) don't auto-load — matches the reference's gated
 * "Set Parameters and Run Report" state, avoiding an unbounded query on page load. */
function RunReportBar({ onRun }: { onRun: () => void }) {
  return (
    <button type="button" onClick={onRun} className="btn-primary mb-4 w-full justify-center !py-2.5">
      <RefreshCw size={15} /> Run Report
    </button>
  );
}

function RunReportEmpty() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <Settings2 size={40} className="mb-3 text-accent" />
      <p className="text-small text-fg-muted">Set Parameters and Run Report</p>
    </div>
  );
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

// ── Grouped / aggregate reports ───────────────────────────────────────────────
// Deduped, single-concept version of GROUP_BY_ALL for the Flex report's "Add Columns" chip picker
// (the reference shows one "Offer" chip, not separate "Offer ID"/"Offer Title" chips).
const FLEX_COLUMNS = [
  { key: 'offer_title', label: 'Offer' },
  { key: 'affiliate_name', label: 'Partner' },
  { key: 'advertiser_name', label: 'Advertiser' },
  { key: 'country', label: 'Country' },
  { key: 'date', label: 'Date' },
  { key: 'source', label: 'Source' },
  { key: 'device', label: 'Device' },
  { key: 'hour', label: 'Hour' },
] as const;

/** Matches the reference Flex Report's 3-picker toolbar (Add Columns / Add Customer Value Metrics
 * / Add Filter) instead of the single "Filters" drawer button every other report page uses. */
function FlexInlineToolbar({
  groupByUi, setGroupByUi, from, to, setFrom, setTo, onOpenFilter, filterCount,
}: {
  groupByUi: string[]; setGroupByUi: (v: string[]) => void;
  from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void;
  onOpenFilter: () => void; filterCount: number;
}) {
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const addCol = (k: string) => { if (groupByUi.length < 10 && !groupByUi.includes(k)) setGroupByUi([...groupByUi, k]); setColPickerOpen(false); };
  const removeCol = (k: string) => setGroupByUi(groupByUi.filter((x) => x !== k));

  return (
    <div className="mb-4 flex flex-wrap items-start gap-4 rounded-card border border-border bg-surface p-3">
      <div className="flex items-center gap-2">
        <input type="date" className="input !w-auto !py-1.5 text-tiny" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-fg-muted">–</span>
        <input type="date" className="input !w-auto !py-1.5 text-tiny" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      <div className="relative">
        <button className="btn-ghost !py-1.5" onClick={() => setColPickerOpen((o) => !o)}>
          <Plus size={14} /> Add Columns <span className="text-fg-muted">{groupByUi.filter((k) => FLEX_COLUMNS.some((c) => c.key === k)).length}/10</span>
        </button>
        {colPickerOpen && (
          <div className="absolute left-0 top-full z-40 mt-1 w-44 rounded-card border border-border bg-elevated p-1 shadow-elevated">
            {FLEX_COLUMNS.filter((c) => !groupByUi.includes(c.key)).map((c) => (
              <button key={c.key} onClick={() => addCol(c.key)} className="block w-full rounded-[var(--radius)] px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">{c.label}</button>
            ))}
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap gap-1">
          {groupByUi.filter((k) => FLEX_COLUMNS.some((c) => c.key === k)).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5 rounded-full bg-accent-subtle px-2.5 py-0.5 text-tiny font-medium text-accent-text">
              {FLEX_COLUMNS.find((c) => c.key === k)?.label}
              <button onClick={() => removeCol(k)}><X size={11} /></button>
            </span>
          ))}
        </div>
      </div>

      <button title="Not available yet" className="btn-ghost !py-1.5">
        <Plus size={14} /> Add Customer Value Metrics
      </button>

      <button className="btn-ghost relative !py-1.5" onClick={onOpenFilter}>
        <Plus size={14} /> Add Filter
        {filterCount > 0 && <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">{filterCount}</span>}
      </button>
    </div>
  );
}

export function GroupedReport({ page, toolbarVariant = 'drawer' }: { page: string; toolbarVariant?: 'drawer' | 'inline' }) {
  const ctx = useContext(OptsCtx);
  const [searchParams] = useSearchParams();
  const [groupByUi, setGroupByUi] = useState<string[]>(DEFAULT_GROUP_BY[page] ?? ['offer_id', 'offer_title']);
  const [metricsUi, setMetricsUi] = useState<string[]>([...DEFAULT_METRICS]);
  const [extraDims, setExtraDims] = useState<string[]>([]);
  const [offerIds, setOfferIds] = useState<string[]>(() => {
    const fromUrl = searchParams.get('offerId');
    return fromUrl ? [fromUrl] : [];
  });
  const [pubIds, setPubIds] = useState<string[]>(() => {
    const fromUrl = searchParams.get('publisherId');
    return fromUrl ? [fromUrl] : [];
  });
  const [advIds, setAdvIds] = useState<string[]>([]);
  const [slIds, setSlIds] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState(false);
  // Offer/Affiliate/Advertiser auto-load (matches the reference exactly); Daily/Custom/Smart
  // Link are parameter-driven like Clicks/Conversions, so they wait for an explicit Run Report.
  const autoLoads = page === 'offer' || page === 'affiliate' || page === 'advertiser';
  const [hasRun, setHasRun] = useState(autoLoads);

  const apiGb = toApiGroupBy([...groupByUi, ...extraDims]);
  const apiMs = toApiMetrics(metricsUi);

  const q = new URLSearchParams();
  q.set('groupBy', (apiGb.length ? apiGb : ['offer']).join(','));
  q.set('metrics', (apiMs.length ? apiMs : ['clicks']).join(','));
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  if (offerIds[0]) q.set('offerId', offerIds[0]);
  if (pubIds[0]) q.set('publisherId', pubIds[0]);
  if (advIds[0]) q.set('advertiserId', advIds[0]);

  const { data, loading, error } = useQuery<AggResult>(hasRun ? `/api/reports?${q.toString()}` : null);
  const rows = data?.rows ?? [];

  const resolveDim = (dim: string, val: string | null): string => {
    if (val == null) return '—';
    if (dim === 'offer') { const m = ctx.offerMap.get(val); return m ? `${m.ref ?? ''} ${m.name}`.trim() : val.slice(0, 8); }
    if (dim === 'publisher') { const m = ctx.pubMap.get(val); return m ? `${m.ref ?? ''} ${m.name}`.trim() : val.slice(0, 8); }
    if (dim === 'advertiser') { const m = ctx.advMap.get(val); return m ? `${m.ref ?? ''} ${m.name}`.trim() : val.slice(0, 8); }
    if (dim === 'day') return new Date(val).toLocaleDateString();
    return val;
  };
  const fmtMetric = (key: string, v: unknown) => {
    if (key === 'cr') return `${(Number(v) * 100).toFixed(2)}%`;
    if (key === 'payout' || key === 'revenue' || key === 'margin' || key === 'epc') return cash2(v);
    return num2(v);
  };
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const m of apiMs) { if (m === 'cr' || m === 'epc') continue; t[m] = rows.reduce((s, r) => s + Number(r.metrics[m] || 0), 0); }
    return t;
  }, [rows, apiMs]);

  const appliedCount = groupByUi.length + extraDims.length + metricsUi.length
    + offerIds.length + pubIds.length + advIds.length + slIds.length
    + (from ? 1 : 0) + (to ? 1 : 0);

  const download = () => rows.length && downloadCsv('report.csv', rows.map((r) => ({
    ...Object.fromEntries(apiGb.map((d) => [dimLabel(d), resolveDim(d, r.dimensions[d] ?? null)])),
    ...Object.fromEntries(apiMs.map((m) => [metricLabel(m), r.metrics[m]])),
  })));

  const showCompactExtras = page === 'offer' || page === 'affiliate' || page === 'advertiser' || page === 'goals';
  const showFullGroupBy = page === 'daily' || page === 'custom' || page === 'smartlink' || page === 'offer' || page === 'affiliate' || page === 'advertiser';
  const showSummary = page === 'offer' || page === 'affiliate' || page === 'advertiser';

  // Aggregate CVR/EPC computed from totals (per-row cr/epc can't just be summed).
  const aggCvr = totals['clicks'] ? (Number(totals['conversions'] ?? 0) / totals['clicks']) * 100 : null;
  const aggEpc = totals['clicks'] ? Number(totals['revenue'] ?? 0) / totals['clicks'] : null;

  return (
    <>
      {showSummary && !loading && !error && (
        <div className="card mb-4">
          <h3 className="mb-3 text-h3 font-medium text-fg">Summary</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {apiMs.filter((m) => m !== 'cr' && m !== 'epc').map((m) => (
              <div key={m}>
                <p className="text-tiny uppercase tracking-wide text-fg-muted">{metricLabel(m)}</p>
                <p className="mt-1 text-h3 font-semibold text-fg">{fmtMetric(m, totals[m])}</p>
              </div>
            ))}
            {aggCvr != null && (
              <div>
                <p className="text-tiny uppercase tracking-wide text-fg-muted">CVR</p>
                <p className="mt-1 text-h3 font-semibold text-fg">{aggCvr.toFixed(2)}%</p>
              </div>
            )}
            {aggEpc != null && (
              <div>
                <p className="text-tiny uppercase tracking-wide text-fg-muted">EPC</p>
                <p className="mt-1 text-h3 font-semibold text-fg">{cash2(aggEpc)}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {toolbarVariant === 'inline' && (
        <FlexInlineToolbar
          groupByUi={groupByUi} setGroupByUi={setGroupByUi}
          from={from} to={to} setFrom={setFrom} setTo={setTo}
          onOpenFilter={() => setOpen(true)} filterCount={offerIds.length + pubIds.length + advIds.length}
        />
      )}
      <Toolbar>
        <p className="text-small text-fg-secondary">
          Grouped by <b className="text-fg">{apiGb.map(dimLabel).join(' · ') || '—'}</b>
          {data ? ` · ${rows.length} rows` : ''}
        </p>
        <div className="flex gap-2">
          {toolbarVariant === 'drawer' && <FiltersBtn count={appliedCount} onClick={() => setOpen(true)} />}
          <button type="button" className="btn-primary" onClick={download} disabled={rows.length === 0}>Download</button>
        </div>
      </Toolbar>
      {!autoLoads && <RunReportBar onRun={() => setHasRun(true)} />}
      {!hasRun ? <RunReportEmpty />
        : loading ? <StateBlock><Spinner /></StateBlock> : error ? <StateBlock>{error}</StateBlock>
        : rows.length === 0 ? <StateBlock>No data for this filter.</StateBlock>
        : (
          <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-small">
                <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr>
                    {apiGb.map((d) => <th key={d} className="px-4 py-3 font-semibold">{dimLabel(d)}</th>)}
                    {apiMs.map((m) => <th key={m} className="px-4 py-3 text-right font-semibold">{metricLabel(m)}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r, i) => (
                    <tr key={i} className="hover:bg-accent-subtle/40">
                      {apiGb.map((d) => (
                        <td key={d} className="px-4 py-3 font-medium text-accent-text">{resolveDim(d, r.dimensions[d] ?? null)}</td>
                      ))}
                      {apiMs.map((m) => (
                        <td key={m} className="px-4 py-3 text-right tabular-nums text-fg">{fmtMetric(m, r.metrics[m])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border bg-page font-semibold">
                  <tr>
                    <td className="px-4 py-3" colSpan={Math.max(1, apiGb.length)}>Total</td>
                    {apiMs.map((m) => (
                      <td key={m} className="px-4 py-3 text-right tabular-nums">
                        {m === 'cr' || m === 'epc' ? '' : fmtMetric(m, totals[m])}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="border-t border-border px-4 py-2.5 text-tiny text-fg-secondary">
              Showing 1 to {rows.length} of {rows.length} entries
            </div>
          </div>
        )}

      {open && (
        <AggFilterDrawer
          page={page}
          showCompactExtras={showCompactExtras}
          showFullGroupBy={showFullGroupBy}
          groupBy={groupByUi}
          metrics={metricsUi}
          extraDims={extraDims}
          offerIds={offerIds}
          pubIds={pubIds}
          advIds={advIds}
          slIds={slIds}
          from={from}
          to={to}
          appliedCount={appliedCount}
          onClose={() => setOpen(false)}
          onApply={(next) => {
            setGroupByUi(next.groupBy);
            setMetricsUi(next.metrics);
            setExtraDims(next.extraDims);
            setOfferIds(next.offerIds);
            setPubIds(next.pubIds);
            setAdvIds(next.advIds);
            setSlIds(next.slIds);
            setFrom(next.from);
            setTo(next.to);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

interface AggDraft {
  groupBy: string[]; metrics: string[]; extraDims: string[];
  offerIds: string[]; pubIds: string[]; advIds: string[]; slIds: string[];
  from: string; to: string;
}

function AggFilterDrawer({
  page, showCompactExtras, showFullGroupBy, groupBy, metrics, extraDims,
  offerIds, pubIds, advIds, slIds, from, to, appliedCount, onClose, onApply,
}: {
  page: string; showCompactExtras: boolean; showFullGroupBy: boolean;
  groupBy: string[]; metrics: string[]; extraDims: string[];
  offerIds: string[]; pubIds: string[]; advIds: string[]; slIds: string[];
  from: string; to: string; appliedCount: number;
  onClose: () => void; onApply: (d: AggDraft) => void;
}) {
  const opts = useContext(OptsCtx);
  const [gb, setGb] = useState(groupBy);
  const [ms, setMs] = useState(metrics);
  const [ex, setEx] = useState(extraDims);
  const [oids, setOids] = useState(offerIds);
  const [pids, setPids] = useState(pubIds);
  const [aids, setAids] = useState(advIds);
  const [sids, setSids] = useState(slIds);
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);

  const draftCount = gb.length + ex.length + ms.length + oids.length + pids.length + aids.length + sids.length + (f ? 1 : 0) + (t ? 1 : 0);

  return (
    <SearchFilterDrawer
      appliedCount={draftCount || appliedCount}
      onClose={onClose}
      onApply={() => onApply({ groupBy: gb, metrics: ms, extraDims: ex, offerIds: oids, pubIds: pids, advIds: aids, slIds: sids, from: f, to: t })}
    >
      <EntitySearchSelect label="Select Offers" placeholder="Type to search offers..." options={opts.offers} value={oids} onChange={setOids} />
      <EntitySearchSelect label="Select Affiliates" placeholder="Type to search affiliates..." options={opts.publishers} value={pids} onChange={setPids} />
      <EntitySearchSelect label="Select Advertisers" placeholder="Type to search advertisers..." options={opts.advertisers} value={aids} onChange={setAids} />
      {(page === 'smartlink') && (
        <EntitySearchSelect label="Select Smart Links" placeholder="Type to search smart links..." options={opts.smartLinks} value={sids} onChange={setSids} />
      )}

      <div className="mb-4 grid grid-cols-2 gap-3">
        <FieldBlock label="From"><input type="date" className="input" value={f} onChange={(e) => setF(e.target.value)} /></FieldBlock>
        <FieldBlock label="To"><input type="date" className="input" value={t} onChange={(e) => setT(e.target.value)} /></FieldBlock>
      </div>

      {showCompactExtras && (
        <CompactCheckboxGrid items={COMPACT_EXTRA_DIMS} selected={ex} onChange={setEx} />
      )}

      {showFullGroupBy && (
        <CheckboxGrid title="Group By" items={GROUP_BY_ALL} selected={gb} onChange={setGb} />
      )}

      <CheckboxGrid title="Report Options" items={REPORT_OPTIONS} selected={ms} onChange={setMs} />
    </SearchFilterDrawer>
  );
}

// ── List reports (clicks / conversions / postbacks) ───────────────────────────
function qs(f: FilterState, keys: FKey[]): string {
  const p = new URLSearchParams();
  for (const k of keys) if (f[k]) p.set(k, f[k]!);
  return p.toString();
}

function ClicksReport() {
  const opts = useContext(OptsCtx);
  const [cols, setCols] = useState<string[]>([...DEFAULT_CLICK_COLUMNS]);
  const [f, setF] = useState<FilterState>({});
  const [offerIds, setOfferIds] = useState<string[]>([]);
  const [pubIds, setPubIds] = useState<string[]>([]);
  const [advIds, setAdvIds] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  // Draft state while drawer is open
  const [dCols, setDCols] = useState(cols);
  const [dF, setDF] = useState(f);
  const [dOids, setDOids] = useState(offerIds);
  const [dPids, setDPids] = useState(pubIds);
  const [dAids, setDAids] = useState(advIds);

  const openDrawer = () => {
    setDCols(cols); setDF(f); setDOids(offerIds); setDPids(pubIds); setDAids(advIds); setOpen(true);
  };
  const applyDrawer = () => {
    setCols(dCols); setF(dF); setOfferIds(dOids); setPubIds(dPids); setAdvIds(dAids); setOpen(false);
  };

  const filterKeys: FKey[] = ['from', 'to', 'offerId', 'publisherId', 'country', 'region', 'city', 'device', 'os', 'browser', 'isUnique'];
  const q = qs({ ...f, offerId: offerIds[0] ?? f.offerId ?? '', publisherId: pubIds[0] ?? f.publisherId ?? '' }, filterKeys);
  const { data, loading, error } = useQuery<ClickRow[]>(hasRun ? `/api/reports/clicks${q ? `?${q}` : ''}` : null);

  const allCols: Column<ClickRow>[] = [
    { header: 'Click ID', cell: (r) => <span className="font-mono text-xs text-brand-600">{r.click_id.slice(0, 12)}…</span> },
    { header: 'Offer ID', cell: (r) => { const m = opts.offerMap.get(r.offer_id); return String(m?.ref ?? short(r.offer_id)); } },
    { header: 'Offer Title', cell: (r) => { const m = opts.offerMap.get(r.offer_id); return <span className="text-brand-600">{m?.name ?? short(r.offer_id)}</span>; } },
    { header: 'Affiliate ID', cell: (r) => { const m = r.publisher_id ? opts.pubMap.get(r.publisher_id) : null; return String(m?.ref ?? short(r.publisher_id)); } },
    { header: 'Affiliate Name', cell: (r) => { const m = r.publisher_id ? opts.pubMap.get(r.publisher_id) : null; return m?.name ?? '—'; } },
    { header: 'Affiliate Company', cell: (r) => { const m = r.publisher_id ? opts.pubMap.get(r.publisher_id) : null; return <span className="text-brand-600">{m?.name ?? '—'}</span>; } },
    { header: 'IP Address', cell: (r) => r.ip ?? '—' },
    { header: 'Country', cell: (r) => r.country ?? '—' },
    { header: 'Region', cell: (r) => r.region ?? '—' },
    { header: 'City', cell: (r) => r.city ?? '—' },
    { header: 'Device', cell: (r) => r.device ?? '—' },
    { header: 'Browser', cell: (r) => r.browser ?? '—' },
    { header: 'Operating System', cell: (r) => r.os ?? '—' },
    { header: 'Is Unique', cell: (r) => (r.is_unique ? 'Y' : 'N') },
    { header: 'Source', cell: (r) => r.sub1 ?? '—' },
    { header: 'G1', cell: (r) => r.sub1 ?? '—' },
    { header: 'Created Date', cell: (r) => dt(r.created_at) },
  ];
  const keyToHeader: Record<string, string> = {
    click_id: 'Click ID', offer_id: 'Offer ID', offer_title: 'Offer Title',
    affiliate_id: 'Affiliate ID', affiliate_name: 'Affiliate Name', affiliate_company: 'Affiliate Company',
    ip: 'IP Address', country: 'Country', region: 'Region', city: 'City', device: 'Device',
    browser: 'Browser', os: 'Operating System', is_unique: 'Is Unique', source: 'Source',
    g1: 'G1', created_date: 'Created Date',
  };
  const shown = allCols.filter((c) => cols.some((k) => keyToHeader[k] === c.header));
  const applied = cols.length + offerIds.length + pubIds.length + advIds.length + filterKeys.filter((k) => f[k]).length;
  const draftCount = dCols.length + dOids.length + dPids.length + dAids.length + filterKeys.filter((k) => dF[k]).length;

  return (
    <>
      <Toolbar>
        <FiltersBtn count={applied} onClick={openDrawer} />
        <p className="text-small text-fg-secondary">{data ? `${data.length} rows` : ''}</p>
      </Toolbar>
      <RunReportBar onRun={() => setHasRun(true)} />
      {!hasRun ? <RunReportEmpty />
        : loading ? <StateBlock><Spinner /></StateBlock> : error ? <StateBlock>{error}</StateBlock>
        : !data?.length ? <StateBlock>No rows for this filter.</StateBlock>
        : (
          <>
            <div className="mb-3 flex justify-end">
              <button type="button" className="btn-primary" disabled={!data?.length} onClick={() => data && downloadCsv('clicks.csv', data as unknown as Record<string, unknown>[])}>Download</button>
            </div>
            <Table columns={shown.length ? shown : allCols.slice(0, 6)} rows={data} rowKey={(r) => r.click_id} />
          </>
        )}
      {open && (
        <SearchFilterDrawer appliedCount={draftCount} onClose={() => setOpen(false)} onApply={applyDrawer}>
          <EntitySearchSelect label="Select Offers" placeholder="Type to search offers..." options={opts.offers} value={dOids} onChange={setDOids} />
          <EntitySearchSelect label="Select Affiliates" placeholder="Type to search affiliates..." options={opts.publishers} value={dPids} onChange={setDPids} />
          <EntitySearchSelect label="Select Advertisers" placeholder="Type to search advertisers..." options={opts.advertisers} value={dAids} onChange={setDAids} />
          <div className="mb-4 grid grid-cols-2 gap-3">
            <FieldBlock label="From"><input type="date" className="input" value={dF.from ?? ''} onChange={(e) => setDF((s) => ({ ...s, from: e.target.value }))} /></FieldBlock>
            <FieldBlock label="To"><input type="date" className="input" value={dF.to ?? ''} onChange={(e) => setDF((s) => ({ ...s, to: e.target.value }))} /></FieldBlock>
          </div>
          <CheckboxGrid title="Click Report Fields" items={CLICK_COLUMNS} selected={dCols} onChange={setDCols} />
        </SearchFilterDrawer>
      )}
    </>
  );
}

interface ClickRow {
  click_id: string; created_at: string; offer_id: string; publisher_id: string | null;
  ip: string | null; country: string | null; region?: string | null; city?: string | null;
  device: string | null; os: string | null; browser: string | null; is_unique: boolean;
  fraud_score: number; sub1?: string | null;
}

function ConversionsReport() {
  const opts = useContext(OptsCtx);
  const [searchParams] = useSearchParams();
  const [cols, setCols] = useState<string[]>([...DEFAULT_CONVERSION_COLUMNS]);
  const [f, setF] = useState<FilterState>({});
  const [offerIds, setOfferIds] = useState<string[]>(() => {
    const fromUrl = searchParams.get('offerId');
    return fromUrl ? [fromUrl] : [];
  });
  const [pubIds, setPubIds] = useState<string[]>(() => {
    const fromUrl = searchParams.get('publisherId');
    return fromUrl ? [fromUrl] : [];
  });
  const [advIds, setAdvIds] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [hasRun, setHasRun] = useState(() => Boolean(searchParams.get('offerId') || searchParams.get('publisherId')));
  const [convIds, setConvIds] = useState('');
  const [clickIds, setClickIds] = useState('');
  const [txnId, setTxnId] = useState('');
  const [ip, setIp] = useState('');

  const [dCols, setDCols] = useState(cols);
  const [dF, setDF] = useState(f);
  const [dOids, setDOids] = useState(offerIds);
  const [dPids, setDPids] = useState(pubIds);
  const [dAids, setDAids] = useState(advIds);
  const [dConvIds, setDConvIds] = useState(convIds);
  const [dClickIds, setDClickIds] = useState(clickIds);
  const [dTxnId, setDTxnId] = useState(txnId);
  const [dIp, setDIp] = useState(ip);

  const openDrawer = () => {
    setDCols(cols); setDF(f); setDOids(offerIds); setDPids(pubIds); setDAids(advIds);
    setDConvIds(convIds); setDClickIds(clickIds); setDTxnId(txnId); setDIp(ip); setOpen(true);
  };
  const applyDrawer = () => {
    setCols(dCols); setF(dF); setOfferIds(dOids); setPubIds(dPids); setAdvIds(dAids);
    setConvIds(dConvIds); setClickIds(dClickIds); setTxnId(dTxnId); setIp(dIp); setOpen(false);
  };

  const filterKeys: FKey[] = ['from', 'to', 'offerId', 'publisherId', 'advertiserId', 'status', 'event', 'source'];
  const q = qs({
    ...f,
    offerId: offerIds[0] ?? f.offerId ?? '',
    publisherId: pubIds[0] ?? f.publisherId ?? '',
    advertiserId: advIds[0] ?? f.advertiserId ?? '',
  }, filterKeys);
  const { data, loading, error } = useQuery<ConvRow[]>(hasRun ? `/api/reports/conversions${q ? `?${q}` : ''}` : null);

  const allCols: Column<ConvRow>[] = [
    { header: 'Conversion ID', cell: (r) => <span className="font-mono text-xs text-brand-600">{r.conversion_id.slice(0, 12)}…</span> },
    { header: 'Click ID', cell: (r) => <span className="font-mono text-xs">{(r.click_id ?? '').slice(0, 10) || '—'}…</span> },
    { header: 'Offer ID', cell: (r) => { const m = opts.offerMap.get(r.offer_id); return String(m?.ref ?? short(r.offer_id)); } },
    { header: 'Offer Title', cell: (r) => { const m = opts.offerMap.get(r.offer_id); return <span className="text-brand-600">{m?.name ?? short(r.offer_id)}</span>; } },
    { header: 'Affiliate Company', cell: (r) => { const m = r.publisher_id ? opts.pubMap.get(r.publisher_id) : null; return <span className="text-brand-600">{m?.name ?? '—'}</span>; } },
    { header: 'Goal Title', cell: (r) => r.event_name ?? '—' },
    { header: 'Transaction ID', cell: (r) => r.transaction_id ?? '—' },
    { header: 'Status', cell: (r) => <Badge value={r.status} /> },
    { header: 'Payout', className: 'text-right', cell: (r) => money(r.payout) },
    { header: 'Revenue', className: 'text-right', cell: (r) => money(r.revenue) },
    { header: 'Method', cell: (r) => r.source },
    { header: 'Created', cell: (r) => dt(r.created_at) },
    { header: 'Type', cell: (r) => r.source },
    { header: 'Source', cell: (r) => r.source },
  ];
  const keyToHeader: Record<string, string> = {
    conversion_id: 'Conversion ID', click_id: 'Click ID', offer_id: 'Offer ID', offer_title: 'Offer Title',
    affiliate_company: 'Affiliate Company', goal_title: 'Goal Title', transaction_id: 'Transaction ID',
    status: 'Status', payout: 'Payout', revenue: 'Revenue', method: 'Method', created: 'Created',
    type: 'Type', source: 'Source',
  };
  const shown = allCols.filter((c) => cols.some((k) => keyToHeader[k] === c.header));
  const applied = cols.length + offerIds.length + pubIds.length + advIds.length
    + (convIds ? 1 : 0) + (clickIds ? 1 : 0) + (txnId ? 1 : 0) + (ip ? 1 : 0)
    + filterKeys.filter((k) => f[k]).length;
  const draftCount = dCols.length + dOids.length + dPids.length + dAids.length
    + (dConvIds ? 1 : 0) + (dClickIds ? 1 : 0) + (dTxnId ? 1 : 0) + (dIp ? 1 : 0)
    + filterKeys.filter((k) => dF[k]).length;

  return (
    <>
      <Toolbar>
        <FiltersBtn count={applied} onClick={openDrawer} />
        <p className="text-small text-fg-secondary">Total: {data?.length ?? 0}</p>
      </Toolbar>
      <RunReportBar onRun={() => setHasRun(true)} />
      {!hasRun ? <RunReportEmpty />
        : loading ? <StateBlock><Spinner /></StateBlock> : error ? <StateBlock>{error}</StateBlock>
        : !data?.length ? <StateBlock>No rows for this filter.</StateBlock>
        : (
          <>
            <div className="mb-3 flex justify-end">
              <button type="button" className="btn-primary" disabled={!data?.length} onClick={() => data && downloadCsv('conversions.csv', data as unknown as Record<string, unknown>[])}>Download</button>
            </div>
            <Table columns={shown.length ? shown : allCols.slice(0, 8)} rows={data} rowKey={(r) => r.conversion_id} />
          </>
        )}
      {open && (
        <SearchFilterDrawer appliedCount={draftCount} onClose={() => setOpen(false)} onApply={applyDrawer}>
          <EntitySearchSelect label="Select Offers" placeholder="Type to search offers..." options={opts.offers} value={dOids} onChange={setDOids} />
          <EntitySearchSelect label="Select Affiliates" placeholder="Type to search affiliates..." options={opts.publishers} value={dPids} onChange={setDPids} />
          <EntitySearchSelect label="Select Advertisers" placeholder="Type to search advertisers..." options={opts.advertisers} value={dAids} onChange={setDAids} />
          <FieldBlock label="Conversion IDs (comma separated)">
            <textarea className="input min-h-[64px]" placeholder="e.g. 101, 102" value={dConvIds} onChange={(e) => setDConvIds(e.target.value)} />
          </FieldBlock>
          <FieldBlock label="Click IDs (comma separated)">
            <textarea className="input min-h-[64px]" placeholder="e.g. ck_123, ck_456" value={dClickIds} onChange={(e) => setDClickIds(e.target.value)} />
          </FieldBlock>
          <FieldBlock label="Transaction ID">
            <input className="input" placeholder="Enter Transaction ID" value={dTxnId} onChange={(e) => setDTxnId(e.target.value)} />
          </FieldBlock>
          <FieldBlock label="Status">
            <select className="input" value={dF.status ?? ''} onChange={(e) => setDF((s) => ({ ...s, status: e.target.value }))}>
              <option value="">All</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </select>
          </FieldBlock>
          <FieldBlock label="IP Address">
            <input className="input" placeholder="Enter IP Address" value={dIp} onChange={(e) => setDIp(e.target.value)} />
          </FieldBlock>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <FieldBlock label="From"><input type="date" className="input" value={dF.from ?? ''} onChange={(e) => setDF((s) => ({ ...s, from: e.target.value }))} /></FieldBlock>
            <FieldBlock label="To"><input type="date" className="input" value={dF.to ?? ''} onChange={(e) => setDF((s) => ({ ...s, to: e.target.value }))} /></FieldBlock>
          </div>
          <CheckboxGrid title="Conversion Report Fields" items={CONVERSION_COLUMNS} selected={dCols} onChange={setDCols} />
        </SearchFilterDrawer>
      )}
    </>
  );
}

interface ConvRow {
  conversion_id: string; click_id?: string; created_at: string; status: string;
  event_name: string | null; payout: string | null; revenue: string | null;
  offer_id: string; publisher_id: string | null; source: string; transaction_id?: string | null;
}

function PostbackLogs() {
  const opts = useContext(OptsCtx);
  const [cols, setCols] = useState<string[]>([...DEFAULT_POSTBACK_COLUMNS]);
  const [offerIds, setOfferIds] = useState<string[]>([]);
  const [pubIds, setPubIds] = useState<string[]>([]);
  const [advIds, setAdvIds] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [statusCode, setStatusCode] = useState('');
  const [postbackId, setPostbackId] = useState('');
  const [convIds, setConvIds] = useState('');
  const [clickIds, setClickIds] = useState('');

  const [dCols, setDCols] = useState(cols);
  const [dOids, setDOids] = useState(offerIds);
  const [dPids, setDPids] = useState(pubIds);
  const [dAids, setDAids] = useState(advIds);
  const [dStatusCode, setDStatusCode] = useState(statusCode);
  const [dPostbackId, setDPostbackId] = useState(postbackId);
  const [dConvIds, setDConvIds] = useState(convIds);
  const [dClickIds, setDClickIds] = useState(clickIds);

  const openDrawer = () => {
    setDCols(cols); setDOids(offerIds); setDPids(pubIds); setDAids(advIds);
    setDStatusCode(statusCode); setDPostbackId(postbackId); setDConvIds(convIds); setDClickIds(clickIds);
    setOpen(true);
  };
  const applyDrawer = () => {
    setCols(dCols); setOfferIds(dOids); setPubIds(dPids); setAdvIds(dAids);
    setStatusCode(dStatusCode); setPostbackId(dPostbackId); setConvIds(dConvIds); setClickIds(dClickIds);
    setOpen(false);
  };

  const q = qs({ publisherId: pubIds[0] ?? '' }, ['publisherId']);
  const { data, loading, error } = useQuery<PbRow[]>(hasRun ? `/api/reports/postback-logs${q ? `?${q}` : ''}` : null);

  const allCols: Column<PbRow>[] = [
    { header: 'Log ID', cell: (r) => <span className="font-mono text-xs text-brand-600">{(r.id ?? r.created_at).toString().slice(0, 10)}…</span> },
    { header: 'Conversion ID', cell: (r) => short(r.conversion_id) },
    { header: 'Offer Title', cell: () => '—' },
    { header: 'Status', cell: (r) => <Badge value={r.success ? 'approved' : 'rejected'} /> },
    { header: 'Postback ID', cell: (r) => short(r.postback_id) },
    { header: 'Affiliate Company', cell: (r) => { const m = r.publisher_id ? opts.pubMap.get(r.publisher_id) : null; return m?.name ?? short(r.publisher_id); } },
    { header: 'Full URL', cell: (r) => <span className="block max-w-[280px] truncate font-mono text-xs">{r.url}</span> },
    { header: 'Response Body', cell: (r) => <span className="block max-w-[200px] truncate text-xs">{r.error ?? (r.success ? 'ok' : '')}</span> },
    { header: 'Latency', cell: () => '—' },
    { header: 'Created At', cell: (r) => dt(r.created_at) },
    { header: 'Attempts', className: 'text-right', cell: (r) => String(r.attempt) },
  ];
  const keyToHeader: Record<string, string> = {
    log_id: 'Log ID', conversion_id: 'Conversion ID', offer_title: 'Offer Title', status: 'Status',
    postback_id: 'Postback ID', affiliate_company: 'Affiliate Company', full_url: 'Full URL',
    response_body: 'Response Body', latency: 'Latency', created_at: 'Created At', attempts: 'Attempts',
  };
  const shown = allCols.filter((c) => cols.some((k) => keyToHeader[k] === c.header));
  const applied = cols.length + offerIds.length + pubIds.length + advIds.length
    + (statusCode ? 1 : 0) + (postbackId ? 1 : 0) + (convIds ? 1 : 0) + (clickIds ? 1 : 0);
  const draftCount = dCols.length + dOids.length + dPids.length + dAids.length
    + (dStatusCode ? 1 : 0) + (dPostbackId ? 1 : 0) + (dConvIds ? 1 : 0) + (dClickIds ? 1 : 0);

  return (
    <>
      <Toolbar>
        <FiltersBtn count={applied} onClick={openDrawer} />
        <p className="text-small text-fg-secondary">Total: {data?.length ?? 0}</p>
      </Toolbar>
      <RunReportBar onRun={() => setHasRun(true)} />
      {!hasRun ? <RunReportEmpty />
        : loading ? <StateBlock><Spinner /></StateBlock> : error ? <StateBlock>{error}</StateBlock>
        : !data?.length ? <StateBlock>No rows for this filter.</StateBlock>
        : (
          <>
            <div className="mb-3 flex justify-end">
              <button type="button" className="btn-primary" disabled={!data?.length} onClick={() => data && downloadCsv('postback-logs.csv', data as unknown as Record<string, unknown>[])}>Download</button>
            </div>
            <Table columns={shown.length ? shown : allCols.slice(0, 6)} rows={data} rowKey={(r) => `${r.created_at}-${r.url}-${r.attempt}`} />
          </>
        )}
      {open && (
        <SearchFilterDrawer appliedCount={draftCount} onClose={() => setOpen(false)} onApply={applyDrawer}>
          <EntitySearchSelect label="Select Offers" placeholder="Type to search offers..." options={opts.offers} value={dOids} onChange={setDOids} />
          <EntitySearchSelect label="Select Affiliates" placeholder="Type to search affiliates..." options={opts.publishers} value={dPids} onChange={setDPids} />
          <EntitySearchSelect label="Select Advertisers" placeholder="Type to search advertisers..." options={opts.advertisers} value={dAids} onChange={setDAids} />
          <FieldBlock label="Status Code">
            <select className="input" value={dStatusCode} onChange={(e) => setDStatusCode(e.target.value)}>
              <option value="">All statuses</option>
              <option value="200">200</option>
              <option value="4xx">4xx</option>
              <option value="5xx">5xx</option>
            </select>
          </FieldBlock>
          <FieldBlock label="Postback ID">
            <input className="input" placeholder="Enter Postback ID" value={dPostbackId} onChange={(e) => setDPostbackId(e.target.value)} />
          </FieldBlock>
          <FieldBlock label="Conversion IDs (comma separated)">
            <textarea className="input min-h-[64px]" placeholder="e.g. 101, 102" value={dConvIds} onChange={(e) => setDConvIds(e.target.value)} />
          </FieldBlock>
          <FieldBlock label="Click IDs (comma separated)">
            <textarea className="input min-h-[64px]" placeholder="e.g. ck_123, ck_456" value={dClickIds} onChange={(e) => setDClickIds(e.target.value)} />
          </FieldBlock>
          <CheckboxGrid title="Postback Log Fields" items={POSTBACK_COLUMNS} selected={dCols} onChange={setDCols} />
        </SearchFilterDrawer>
      )}
    </>
  );
}

interface PbRow {
  id?: string; created_at: string; publisher_id: string | null; url: string; attempt: number;
  status_code: number | null; success: boolean; error: string | null;
  conversion_id?: string; postback_id?: string;
}

// ── Remaining specialized reports (keep working, light toolbar) ───────────────
function Goals() {
  const opts = useContext(OptsCtx);
  const cols: Column<GoalRow>[] = [
    { header: 'Goal', cell: (r) => <span className="font-medium">{r.goal}</span> },
    { header: 'Offer', cell: (r) => { const m = opts.offerMap.get(r.offer_id); return <span className="text-brand-600">{m ? `(${m.ref ?? '—'}) ${m.name}` : short(r.offer_id)}</span>; } },
    { header: 'Conv.', className: 'text-right', cell: (r) => String(r.conversions) },
    { header: 'Payout', className: 'text-right', cell: (r) => money(r.payout) },
    { header: 'Revenue', className: 'text-right', cell: (r) => money(r.revenue) },
    { header: 'Margin', className: 'text-right', cell: (r) => money(r.margin) },
  ];
  return <SimpleList path="/api/reports/goals" columns={cols} />;
}
interface GoalRow { goal: string; offer_id: string; conversions: number; payout: string; revenue: string; margin: string }

function CapReport() {
  const usage = (used: number, cap: number | null) => (cap == null ? `${used} / ∞` : `${used} / ${cap}`);
  const cols: Column<CapRow>[] = [
    { header: 'Offer', cell: (r) => <span className="font-medium">{r.name}</span> },
    { header: 'Status', cell: (r) => <Badge value={r.status} /> },
    { header: 'Conv. today', className: 'text-right', cell: (r) => usage(r.conversions_today, r.daily_conversion_cap) },
    { header: 'Conv. total', className: 'text-right', cell: (r) => usage(r.conversions_total, r.total_conversion_cap) },
    { header: 'Clicks today', className: 'text-right', cell: (r) => usage(r.clicks_today, r.daily_click_cap) },
  ];
  return <SimpleList path="/api/reports/caps" columns={cols} />;
}
interface CapRow { id: string; name: string; status: string; daily_conversion_cap: number | null; total_conversion_cap: number | null; daily_click_cap: number | null; conversions_today: number; conversions_total: number; clicks_today: number }

function SimpleList<T extends object>({ path, columns }: { path: string; columns: Column<T>[] }) {
  const [hasRun, setHasRun] = useState(false);
  const { data, loading, error } = useQuery<T[]>(hasRun ? path : null);
  return (
    <>
      <Toolbar>
        <p className="text-small text-fg-secondary">{data ? `${data.length} rows` : ''}</p>
      </Toolbar>
      <RunReportBar onRun={() => setHasRun(true)} />
      {!hasRun ? <RunReportEmpty />
        : loading ? <StateBlock><Spinner /></StateBlock> : error ? <StateBlock>{error}</StateBlock>
        : !data?.length ? <StateBlock>No rows.</StateBlock>
        : (
          <>
            <div className="mb-3 flex justify-end">
              <button type="button" className="btn-primary" disabled={!data?.length} onClick={() => data && downloadCsv('report.csv', data as unknown as Record<string, unknown>[])}>Download</button>
            </div>
            <Table columns={columns} rows={data} rowKey={(r) => JSON.stringify(r)} />
          </>
        )}
    </>
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
    const res = await exp.run(body);
    if (res && res.rows.length) {
      const name = `${entity}.${format}`;
      if (format === 'csv') downloadCsv(name, res.rows); else await downloadXlsx(name, res.rows);
    }
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
