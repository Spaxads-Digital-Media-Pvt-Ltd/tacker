/**
 * Reports hub — Trackog-style UI: right Search Filter drawer, checkbox-driven Group By /
 * Report Options / column fields, per-page defaults from Trackog screenshots, light theme.
 */
import { createContext, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import {
  SearchFilterDrawer, EntitySearchSelect, CheckboxGrid, CompactCheckboxGrid, FieldBlock,
} from '../../components/SearchFilterDrawer';
import { PageHeader, Table, StatusDot, Spinner, StateBlock, Field, type Column } from '../../components/ui';
import type { Offer, Publisher, Advertiser } from '../../types';
import {
  GROUP_BY_ALL, REPORT_OPTIONS, DEFAULT_METRICS, DEFAULT_GROUP_BY, COMPACT_EXTRA_DIMS,
  CLICK_COLUMNS, DEFAULT_CLICK_COLUMNS, CONVERSION_COLUMNS, DEFAULT_CONVERSION_COLUMNS,
  POSTBACK_COLUMNS, DEFAULT_POSTBACK_COLUMNS,
  toApiGroupBy, toApiMetrics, metricLabel, dimLabel,
} from '../../lib/reportFilters';

// ── Option context ────────────────────────────────────────────────────────────
interface Opt { value: string; label: string }
type RefMap = Map<string, { ref?: number; name: string }>;
interface Opts { offers: Opt[]; publishers: Opt[]; advertisers: Opt[]; smartLinks: Opt[]; offerMap: RefMap; pubMap: RefMap; advMap: RefMap }
const emptyMap: RefMap = new Map();
const OptsCtx = createContext<Opts>({ offers: [], publishers: [], advertisers: [], smartLinks: [], offerMap: emptyMap, pubMap: emptyMap, advMap: emptyMap });

const TITLES: Record<string, string> = {
  offer: 'Offer Report', affiliate: 'Affiliate Report', advertiser: 'Advertiser Report',
  daily: 'Daily Report', goals: 'Goals Report', smartlink: 'Smart Link Report', custom: 'Custom Report',
  clicks: 'Clicks Report', conversions: 'Conversions Report', cap: 'Cap Report',
  'postback-logs': 'Postback Logs Report', offline: 'Offline Report', 'import-export': 'Import & Export Logs',
};

export default function Reports() {
  const { type = 'offer' } = useParams();
  const offers = useQuery<Offer[]>('/api/offers');
  const publishers = useQuery<Publisher[]>('/api/publishers');
  const advertisers = useQuery<Advertiser[]>('/api/advertisers');
  const smartLinks = useQuery<{ id: string; name: string }[]>('/api/smart-links');
  const opts: Opts = {
    offers: (offers.data ?? []).map((o) => ({ value: o.id, label: o.ref != null ? `(${o.ref}) ${o.name}` : o.name })),
    publishers: (publishers.data ?? []).map((p) => ({ value: p.id, label: p.ref != null ? `(${p.ref}) ${p.name}` : p.name })),
    advertisers: (advertisers.data ?? []).map((a) => ({ value: a.id, label: a.ref != null ? `(${a.ref}) ${a.name}` : a.name })),
    smartLinks: (smartLinks.data ?? []).map((s) => ({ value: s.id, label: s.name })),
    offerMap: new Map((offers.data ?? []).map((o) => [o.id, { ref: o.ref, name: o.name }])),
    pubMap: new Map((publishers.data ?? []).map((p) => [p.id, { ref: p.ref, name: p.name }])),
    advMap: new Map((advertisers.data ?? []).map((a) => [a.id, { ref: a.ref, name: a.name }])),
  };
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

function FiltersBtn({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button type="button" className="btn-ghost relative" onClick={onClick}>
      <span aria-hidden>⛃</span> Filters
      {count > 0 && (
        <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">
          {count}
        </span>
      )}
    </button>
  );
}

// ── Grouped / aggregate reports ───────────────────────────────────────────────
function GroupedReport({ page }: { page: string }) {
  const ctx = useContext(OptsCtx);
  const [groupByUi, setGroupByUi] = useState<string[]>(DEFAULT_GROUP_BY[page] ?? ['offer_id', 'offer_title']);
  const [metricsUi, setMetricsUi] = useState<string[]>([...DEFAULT_METRICS]);
  const [extraDims, setExtraDims] = useState<string[]>([]);
  const [offerIds, setOfferIds] = useState<string[]>([]);
  const [pubIds, setPubIds] = useState<string[]>([]);
  const [advIds, setAdvIds] = useState<string[]>([]);
  const [slIds, setSlIds] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState(false);

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

  const { data, loading, error } = useQuery<AggResult>(`/api/reports?${q.toString()}`);
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

  return (
    <>
      <Toolbar>
        <p className="text-sm text-fg-secondary">
          Grouped by <b className="text-fg">{apiGb.map(dimLabel).join(' · ') || '—'}</b>
          {data ? ` · ${rows.length} rows` : ''}
        </p>
        <div className="flex gap-2">
          <FiltersBtn count={appliedCount} onClick={() => setOpen(true)} />
          <button type="button" className="btn-primary" onClick={download} disabled={rows.length === 0}>Download</button>
        </div>
      </Toolbar>
      {loading ? <StateBlock><Spinner /></StateBlock> : error ? <StateBlock>{error}</StateBlock>
        : rows.length === 0 ? <StateBlock>No data for this filter.</StateBlock>
        : (
          <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-border bg-page text-[11px] uppercase tracking-wide text-fg-muted">
                  <tr>
                    {apiGb.map((d) => <th key={d} className="px-4 py-3 font-semibold">{dimLabel(d)}</th>)}
                    {apiMs.map((m) => <th key={m} className="px-4 py-3 text-right font-semibold">{metricLabel(m)}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r, i) => (
                    <tr key={i} className="hover:bg-accent-subtle/40">
                      {apiGb.map((d) => (
                        <td key={d} className="px-4 py-3 font-medium text-brand-600">{resolveDim(d, r.dimensions[d] ?? null)}</td>
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
            <div className="border-t border-border px-4 py-2.5 text-xs text-fg-muted">
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
  const { data, loading, error } = useQuery<ClickRow[]>(`/api/reports/clicks${q ? `?${q}` : ''}`);

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
        <p className="text-sm text-fg-secondary">{data ? `${data.length} rows` : ''}</p>
        <div className="flex gap-2">
          <FiltersBtn count={applied} onClick={openDrawer} />
          <button type="button" className="btn-primary" disabled={!data?.length} onClick={() => data && downloadCsv('clicks.csv', data as unknown as Record<string, unknown>[])}>Download</button>
        </div>
      </Toolbar>
      {loading ? <StateBlock><Spinner /></StateBlock> : error ? <StateBlock>{error}</StateBlock>
        : !data?.length ? <StateBlock>No rows for this filter.</StateBlock>
        : <Table columns={shown.length ? shown : allCols.slice(0, 6)} rows={data} rowKey={(r) => r.click_id} />}
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
  const [cols, setCols] = useState<string[]>([...DEFAULT_CONVERSION_COLUMNS]);
  const [f, setF] = useState<FilterState>({});
  const [offerIds, setOfferIds] = useState<string[]>([]);
  const [pubIds, setPubIds] = useState<string[]>([]);
  const [advIds, setAdvIds] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
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
  const { data, loading, error } = useQuery<ConvRow[]>(`/api/reports/conversions${q ? `?${q}` : ''}`);

  const allCols: Column<ConvRow>[] = [
    { header: 'Conversion ID', cell: (r) => <span className="font-mono text-xs text-brand-600">{r.conversion_id.slice(0, 12)}…</span> },
    { header: 'Click ID', cell: (r) => <span className="font-mono text-xs">{(r.click_id ?? '').slice(0, 10) || '—'}…</span> },
    { header: 'Offer ID', cell: (r) => { const m = opts.offerMap.get(r.offer_id); return String(m?.ref ?? short(r.offer_id)); } },
    { header: 'Offer Title', cell: (r) => { const m = opts.offerMap.get(r.offer_id); return <span className="text-brand-600">{m?.name ?? short(r.offer_id)}</span>; } },
    { header: 'Affiliate Company', cell: (r) => { const m = r.publisher_id ? opts.pubMap.get(r.publisher_id) : null; return <span className="text-brand-600">{m?.name ?? '—'}</span>; } },
    { header: 'Goal Title', cell: (r) => r.event_name ?? '—' },
    { header: 'Transaction ID', cell: (r) => r.transaction_id ?? '—' },
    { header: 'Status', cell: (r) => <StatusDot value={r.status} /> },
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
        <p className="text-sm text-fg-secondary">Total: {data?.length ?? 0}</p>
        <div className="flex gap-2">
          <FiltersBtn count={applied} onClick={openDrawer} />
          <button type="button" className="btn-primary" disabled={!data?.length} onClick={() => data && downloadCsv('conversions.csv', data as unknown as Record<string, unknown>[])}>Download</button>
        </div>
      </Toolbar>
      {loading ? <StateBlock><Spinner /></StateBlock> : error ? <StateBlock>{error}</StateBlock>
        : !data?.length ? <StateBlock>No rows for this filter.</StateBlock>
        : <Table columns={shown.length ? shown : allCols.slice(0, 8)} rows={data} rowKey={(r) => r.conversion_id} />}
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
  const { data, loading, error } = useQuery<PbRow[]>(`/api/reports/postback-logs${q ? `?${q}` : ''}`);

  const allCols: Column<PbRow>[] = [
    { header: 'Log ID', cell: (r) => <span className="font-mono text-xs text-brand-600">{(r.id ?? r.created_at).toString().slice(0, 10)}…</span> },
    { header: 'Conversion ID', cell: (r) => short(r.conversion_id) },
    { header: 'Offer Title', cell: () => '—' },
    { header: 'Status', cell: (r) => <StatusDot value={r.success ? 'approved' : 'rejected'} /> },
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
        <p className="text-sm text-fg-secondary">Total: {data?.length ?? 0}</p>
        <div className="flex gap-2">
          <FiltersBtn count={applied} onClick={openDrawer} />
          <button type="button" className="btn-primary" disabled={!data?.length} onClick={() => data && downloadCsv('postback-logs.csv', data as unknown as Record<string, unknown>[])}>Download</button>
        </div>
      </Toolbar>
      {loading ? <StateBlock><Spinner /></StateBlock> : error ? <StateBlock>{error}</StateBlock>
        : !data?.length ? <StateBlock>No rows for this filter.</StateBlock>
        : <Table columns={shown.length ? shown : allCols.slice(0, 6)} rows={data} rowKey={(r) => `${r.created_at}-${r.url}-${r.attempt}`} />}
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
    { header: 'Status', cell: (r) => <StatusDot value={r.status} /> },
    { header: 'Conv. today', className: 'text-right', cell: (r) => usage(r.conversions_today, r.daily_conversion_cap) },
    { header: 'Conv. total', className: 'text-right', cell: (r) => usage(r.conversions_total, r.total_conversion_cap) },
    { header: 'Clicks today', className: 'text-right', cell: (r) => usage(r.clicks_today, r.daily_click_cap) },
  ];
  return <SimpleList path="/api/reports/caps" columns={cols} />;
}
interface CapRow { id: string; name: string; status: string; daily_conversion_cap: number | null; total_conversion_cap: number | null; daily_click_cap: number | null; conversions_today: number; conversions_total: number; clicks_today: number }

function SimpleList<T extends object>({ path, columns }: { path: string; columns: Column<T>[] }) {
  const { data, loading, error } = useQuery<T[]>(path);
  return (
    <>
      <Toolbar>
        <p className="text-sm text-fg-secondary">{data ? `${data.length} rows` : ''}</p>
        <button type="button" className="btn-primary" disabled={!data?.length} onClick={() => data && downloadCsv('report.csv', data as unknown as Record<string, unknown>[])}>Download</button>
      </Toolbar>
      {loading ? <StateBlock><Spinner /></StateBlock> : error ? <StateBlock>{error}</StateBlock>
        : !data?.length ? <StateBlock>No rows.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(r) => JSON.stringify(r)} />}
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
    { header: 'Status', cell: (r) => <StatusDot value={r.status} /> },
    { header: 'Payout', className: 'text-right', cell: (r) => money(r.payout) },
    { header: 'Revenue', className: 'text-right', cell: (r) => money(r.revenue) },
  ];
  const { data, loading, error, refetch } = useQuery<OffRow[]>('/api/offline/conversions');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Toolbar>
        <p className="text-sm text-fg-secondary">{data ? `${data.length} rows` : ''}</p>
        <button type="button" className="btn-primary" onClick={() => setOpen(true)}>Record offline conversion</button>
      </Toolbar>
      {loading ? <StateBlock><Spinner /></StateBlock> : error ? <StateBlock>{error}</StateBlock>
        : !data?.length ? <StateBlock>No offline conversions recorded.</StateBlock>
        : <Table columns={cols} rows={data} rowKey={(r) => r.conversion_id} />}
      {open && <RecordOfflineModal offers={opts.offers} onClose={() => setOpen(false)} onDone={() => { setOpen(false); refetch(); }} />}
    </>
  );
}

function RecordOfflineModal({ offers, onClose, onDone }: { offers: Opt[]; onClose: () => void; onDone: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const [form, setForm] = useState({ offerId: '', event: '', payout: '', revenue: '', currency: 'USD', status: 'approved' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post('/api/offline/conversions', body));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { offerId: form.offerId, currency: form.currency, status: form.status };
    for (const k of ['event', 'payout', 'revenue'] as const) if (form[k]) body[k] = form[k];
    if (await run(body)) onDone();
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-fg/25 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-card border border-border bg-surface p-6 shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-h3 font-semibold text-fg">Record offline conversion</h2>
        <form onSubmit={submit} className="mt-4 space-y-3">
          {error && <p className="text-sm text-danger-text">{error}</p>}
          <Field label="Offer"><select className="input" required value={form.offerId} onChange={set('offerId')}><option value="" disabled>Select…</option>{offers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
          <Field label="Event (optional)"><input className="input" value={form.event} onChange={set('event')} placeholder="purchase" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Payout"><input className="input" value={form.payout} onChange={set('payout')} placeholder="5.00" /></Field>
            <Field label="Revenue"><input className="input" value={form.revenue} onChange={set('revenue')} placeholder="8.00" /></Field>
          </div>
          <Field label="Status"><select className="input" value={form.status} onChange={set('status')}>{['approved', 'pending', 'rejected'].map((s) => <option key={s}>{s}</option>)}</select></Field>
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Record'}</button></div>
        </form>
      </div>
    </div>
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
    { header: 'Kind', cell: (r) => <StatusDot value={r.kind === 'export' ? 'active' : 'pending'} /> },
    { header: 'Entity', cell: (r) => r.entity },
    { header: 'Rows', className: 'text-right', cell: (r) => String(r.row_count) },
    { header: 'Status', cell: (r) => <StatusDot value={r.status === 'completed' ? 'approved' : 'rejected'} /> },
    { header: 'Detail', cell: (r) => r.detail ?? '' },
  ];
  const applied = EXPORT_KEYS.filter((k) => f[k]).length;

  return (
    <>
      <Toolbar>
        <div className="flex flex-wrap gap-2">
          <span className="self-center text-sm text-fg-secondary">Export Conversions:</span>
          <button type="button" className="btn-ghost" disabled={exp.busy} onClick={() => run('conversions', 'csv')}>CSV</button>
          <button type="button" className="btn-ghost" disabled={exp.busy} onClick={() => run('conversions', 'xlsx')}>Excel</button>
          <span className="ml-4 self-center text-sm text-fg-secondary">Clicks:</span>
          <button type="button" className="btn-ghost" disabled={exp.busy} onClick={() => run('clicks', 'csv')}>CSV</button>
          <button type="button" className="btn-ghost" disabled={exp.busy} onClick={() => run('clicks', 'xlsx')}>Excel</button>
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
