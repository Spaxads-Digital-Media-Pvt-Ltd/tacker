import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowDownRight, ExternalLink, SlidersHorizontal, Link2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS, type Role } from '../auth/roles';
import { useQuery } from '../lib/useApi';
import { useClickOutside } from '../lib/useClickOutside';
import { PageHeader, StatCard, Spinner, StateBlock } from '../components/ui';
import { Sparkline } from '../components/Sparkline';
import { PerformanceChart } from '../components/PerformanceChart';
import { TrackingLinkGeneratorModal } from '../components/TrackingLinkGeneratorModal';
import { MOCK_DASHBOARD, mockNameMap, mockTopRows, mockHourlySeries } from './dashboardMock';
import type { Offer, Publisher, Advertiser } from '../types';

/**
 * Role-aware overview. Admins get the full Everflow-style "Today's Stats" board (KPI cards +
 * performance chart + Offers/Partners panels with a per-entity mini chart). Other roles get their
 * own live 24h tiles (audience metric policy enforced server-side — publishers never see
 * revenue/margin, advertisers never see payout).
 */
export default function DashboardHome() {
  const { session } = useAuth();
  if (!session) return null;
  if (session.role === 'admin') return <AdminDashboard name={session.displayName} />;
  return <RoleTiles role={session.role} name={session.displayName} />;
}

// ── Admin: Today's Stats ──────────────────────────────────────────────────────
interface Period { today: number; yesterday: number; month: number; lastMonth: number }
interface MoneyPeriod { today: string; yesterday: string; month: string; lastMonth: string }
interface Dashboard {
  clicks: Period; conversions: Period; cr: Period;
  revenue: MoneyPeriod; payout: MoneyPeriod; margin: MoneyPeriod;
  series: { clicks: number[]; conversions: number[]; revenue: number[]; payout: number[] };
}

const nfmt = new Intl.NumberFormat('en-US');
const money = (v: string | number) => `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))}`;
const compact = (n: number) => (n >= 1000 ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : nfmt.format(n));

function delta(today: number, yesterday: number): { pct: number; up: boolean } | null {
  if (yesterday === 0) return today > 0 ? { pct: 100, up: true } : null;
  const pct = ((today - yesterday) / yesterday) * 100;
  return { pct: Math.round(pct), up: pct >= 0 };
}

interface AggRow { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }
interface AggResult { rows: AggRow[] }
type RefMap = Map<string, string>;

/** Dev-only: swap in sample data when a request errors, so the dashboard is previewable without
 * a live api-backend. No-op in production and a no-op once the real API responds. */
function withMock<T>(q: { data: T | null; loading: boolean; error: string | null }, mock: T): { data: T | null; loading: boolean; error: string | null } {
  if (import.meta.env.DEV && q.error) return { data: mock, loading: false, error: null };
  return q;
}

// Which dashboard sections are shown — persisted so "Customize Cards" sticks across reloads.
const SECTIONS = [
  { id: 'kpi', label: 'KPI cards' },
  { id: 'performance', label: 'Performance' },
  { id: 'offers', label: 'Top offers' },
  { id: 'publishers', label: 'Top publishers' },
  { id: 'advertisers', label: 'Top advertisers' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];
const DEFAULT_VISIBLE: Record<SectionId, boolean> = { kpi: true, performance: true, offers: true, publishers: true, advertisers: true };
const STORAGE_KEY = 'dashboard-visible-sections';

function loadVisible(): Record<SectionId, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_VISIBLE, ...(JSON.parse(raw) as Partial<Record<SectionId, boolean>>) } : { ...DEFAULT_VISIBLE };
  } catch {
    return { ...DEFAULT_VISIBLE };
  }
}

function CustomizeCards({ visible, onChange }: { visible: Record<SectionId, boolean>; onChange: (v: Record<SectionId, boolean>) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Customize cards"
        className={`grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border transition-colors ${open ? 'bg-accent-subtle text-accent-text' : 'bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg'}`}
      >
        <SlidersHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-56 rounded-card border border-border bg-elevated p-3 shadow-elevated">
          <p className="mb-2 text-small font-semibold text-fg">Customize Cards</p>
          <div className="space-y-1.5">
            {SECTIONS.map((s) => (
              <label key={s.id} className="flex cursor-pointer items-center gap-2 text-small text-fg-secondary">
                <input
                  type="checkbox"
                  className="chk"
                  checked={visible[s.id]}
                  onChange={(e) => onChange({ ...visible, [s.id]: e.target.checked })}
                />
                {s.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AdminDashboard({ name }: { name: string }) {
  const { data, loading, error } = withMock(useQuery<Dashboard>('/api/reports/dashboard'), MOCK_DASHBOARD);
  const topOffers = withMock(useQuery<AggResult>('/api/reports?groupBy=offer&metrics=clicks,conversions,revenue'), mockTopRows('offer'));
  const topPubs = withMock(useQuery<AggResult>('/api/reports?groupBy=publisher&metrics=clicks,conversions,revenue'), mockTopRows('publisher'));
  const topAdvs = withMock(useQuery<AggResult>('/api/reports?groupBy=advertiser&metrics=clicks,conversions,revenue'), mockTopRows('advertiser'));
  const offers = useQuery<Offer[]>('/api/offers');
  const pubs = useQuery<Publisher[]>('/api/publishers');
  const advs = useQuery<Advertiser[]>('/api/advertisers');

  const offerMap: RefMap = import.meta.env.DEV && offers.error
    ? mockNameMap('offer') : new Map((offers.data ?? []).map((o) => [o.id, o.ref != null ? `(${o.ref}) ${o.name}` : o.name]));
  const pubMap: RefMap = import.meta.env.DEV && pubs.error
    ? mockNameMap('publisher') : new Map((pubs.data ?? []).map((p) => [p.id, p.ref != null ? `(${p.ref}) ${p.name}` : p.name]));
  const advMap: RefMap = import.meta.env.DEV && advs.error
    ? mockNameMap('advertiser') : new Map((advs.data ?? []).map((a) => [a.id, a.ref != null ? `(${a.ref}) ${a.name}` : a.name]));

  const [visible, setVisible] = useState<Record<SectionId, boolean>>(loadVisible);
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(visible)); }, [visible]);
  const [linkGenOpen, setLinkGenOpen] = useState(false);

  return (
    <>
      <div className="mb-2 flex items-start justify-between gap-3">
        <PageHeader title="Dashboard" subtitle={`Welcome back, ${name}`} />
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={() => setLinkGenOpen(true)}><Link2 size={15} /> Tracking Link Generator</button>
          <CustomizeCards visible={visible} onChange={setVisible} />
        </div>
      </div>
      {linkGenOpen && <TrackingLinkGeneratorModal onClose={() => setLinkGenOpen(false)} />}

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error || !data ? <StateBlock>{error ?? 'Failed to load'}</StateBlock>
        : (
          <>
            {(visible.kpi || visible.performance) && (
              <div className={`grid grid-cols-1 gap-4 ${visible.kpi ? 'xl:grid-cols-[minmax(0,260px)_1fr_minmax(0,260px)]' : ''}`}>
                {visible.kpi && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:flex xl:flex-col">
                    <Kpi label="Revenue" value={money(data.revenue.today)} series={data.series.revenue}
                      d={delta(Number(data.revenue.today), Number(data.revenue.yesterday))}
                      rows={[['Yesterday', money(data.revenue.yesterday)], ['This month', money(data.revenue.month)], ['Last month', money(data.revenue.lastMonth)]]} />
                    <Kpi label="Clicks" value={compact(data.clicks.today)} series={data.series.clicks}
                      d={delta(data.clicks.today, data.clicks.yesterday)}
                      rows={[['Yesterday', compact(data.clicks.yesterday)], ['This month', compact(data.clicks.month)], ['Last month', compact(data.clicks.lastMonth)]]} />
                    <Kpi label="Conv. rate" value={`${data.cr.today}%`} series={data.series.conversions}
                      d={delta(data.cr.today, data.cr.yesterday)}
                      rows={[['Yesterday', `${data.cr.yesterday}%`], ['This month', `${data.cr.month}%`], ['Last month', `${data.cr.lastMonth}%`]]} />
                  </div>
                )}

                {visible.performance && (
                  <PerformanceChart
                    revenue={data.series.revenue} clicks={data.series.clicks}
                    revenueLabel={money(data.revenue.today)} clicksLabel={compact(data.clicks.today)}
                  />
                )}

                {visible.kpi && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:flex xl:flex-col">
                    <Kpi label="Payout" value={money(data.payout.today)} series={data.series.payout}
                      d={delta(Number(data.payout.today), Number(data.payout.yesterday))}
                      rows={[['Yesterday', money(data.payout.yesterday)], ['This month', money(data.payout.month)], ['Last month', money(data.payout.lastMonth)]]} />
                    <Kpi label="Margin" value={money(data.margin.today)} series={data.series.revenue}
                      d={delta(Number(data.margin.today), Number(data.margin.yesterday))}
                      rows={[['Yesterday', money(data.margin.yesterday)], ['This month', money(data.margin.month)], ['Last month', money(data.margin.lastMonth)]]} />
                    <Kpi label="Conversions" value={compact(data.conversions.today)} series={data.series.conversions}
                      d={delta(data.conversions.today, data.conversions.yesterday)}
                      rows={[['Yesterday', compact(data.conversions.yesterday)], ['This month', compact(data.conversions.month)], ['Last month', compact(data.conversions.lastMonth)]]} />
                  </div>
                )}
              </div>
            )}

            {/* Top rankings + per-entity mini chart */}
            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
              {visible.offers && <EntityPanel title="Top offers" dimKey="offer" filterKey="offerId" q={topOffers} nameMap={offerMap} viewAll="/app/reports/offer" />}
              {visible.publishers && <EntityPanel title="Top publishers" dimKey="publisher" filterKey="publisherId" q={topPubs} nameMap={pubMap} viewAll="/app/reports/partner" />}
              {visible.advertisers && <EntityPanel title="Top advertisers" dimKey="advertiser" filterKey="advertiserId" q={topAdvs} nameMap={advMap} viewAll="/app/reports/advertiser" />}
            </div>
          </>
        )}
    </>
  );
}

function Kpi({ label, value, series, d, rows }: {
  label: string; value: string; series: number[];
  d: { pct: number; up: boolean } | null; rows: [string, string][];
}) {
  return (
    <div className="card !p-4">
      <div className="flex items-start justify-between">
        <p className="text-small font-medium text-fg-secondary">{label}</p>
        {d && (
          <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-tiny font-semibold ${d.up ? 'bg-success-bg text-success-text' : 'bg-danger-bg text-danger-text'}`}>
            {d.up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />} {Math.abs(d.pct)}%
          </span>
        )}
      </div>
      <p className="mt-1 text-h1 font-semibold tracking-tight text-fg">{value}</p>
      <div className="mt-2"><Sparkline data={series} color="rgb(var(--accent))" /></div>
      <dl className="mt-3 space-y-1 border-t border-border pt-2 text-tiny">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between"><dt className="text-fg-muted">{k}</dt><dd className="font-medium tabular-nums text-fg-secondary">{v}</dd></div>
        ))}
      </dl>
    </div>
  );
}

const METRICS = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'clicks', label: 'Clicks' },
  { key: 'conversions', label: 'Conversions' },
] as const;
type MetricKey = (typeof METRICS)[number]['key'];

function todayRangeISO(): { from: string; to: string } {
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  return { from: from.toISOString(), to: new Date().toISOString() };
}

/** Ranking card with an entity picker + live per-entity hourly mini chart (top-5 by revenue). */
function EntityPanel({ title, dimKey, filterKey, q, nameMap, viewAll }: {
  title: string; dimKey: string; filterKey: string;
  q: { data: AggResult | null; loading: boolean; error: string | null };
  nameMap: RefMap; viewAll: string;
}) {
  const rows = [...(q.data?.rows ?? [])]
    .sort((a, b) => Number(b.metrics['revenue'] ?? 0) - Number(a.metrics['revenue'] ?? 0))
    .slice(0, 5);
  const [selectedId, setSelectedId] = useState('');
  const [metric, setMetric] = useState<MetricKey>('revenue');
  const id = selectedId || rows[0]?.dimensions[dimKey] || '';

  const { from, to } = useMemo(todayRangeISO, []);
  const seriesPath = id
    ? `/api/reports?groupBy=hour&metrics=clicks,conversions,revenue&${filterKey}=${encodeURIComponent(id)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    : null;
  const series = withMock(useQuery<AggResult>(seriesPath), mockHourlySeries());
  const points = [...(series.data?.rows ?? [])]
    .sort((a, b) => new Date(a.dimensions.hour ?? 0).getTime() - new Date(b.dimensions.hour ?? 0).getTime())
    .map((r) => Number(r.metrics[metric] ?? 0));

  return (
    <div className="card !p-0">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-h3 font-medium text-fg">{title}</h2>
        <Link to={viewAll} title="View all" className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius)] text-fg-secondary transition-colors hover:bg-accent-subtle hover:text-fg">
          <ExternalLink size={15} />
        </Link>
      </div>

      {q.loading ? <div className="grid place-items-center py-10"><Spinner /></div>
        : rows.length === 0 ? <p className="px-4 py-8 text-center text-small text-fg-muted">No data yet.</p>
        : (
          <>
            <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
              <select
                value={id}
                onChange={(e) => setSelectedId(e.target.value)}
                className="input !w-auto !rounded-[var(--radius)] !py-1.5 text-tiny"
              >
                {rows.map((r, i) => {
                  const rid = r.dimensions[dimKey] ?? '';
                  const label = (rid && nameMap.get(rid)) || (rid ? rid.slice(0, 8) + '…' : '—');
                  return <option key={rid || i} value={rid}>{label}</option>;
                })}
              </select>
              <div className="ml-auto flex gap-1">
                {METRICS.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setMetric(m.key)}
                    className={`rounded-[var(--radius)] px-2.5 py-1 text-tiny font-medium transition-colors ${metric === m.key ? 'bg-accent-subtle text-accent-text' : 'text-fg-secondary hover:bg-accent-subtle hover:text-fg'}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="px-4 pb-1 pt-3">
              {series.loading
                ? <div className="grid h-16 place-items-center"><Spinner /></div>
                : <Sparkline data={points.length ? points : [0]} color="rgb(var(--accent))" height={64} />}
            </div>

            <ul className="divide-y divide-border border-t border-border">
              {rows.map((r, i) => {
                const rid = r.dimensions[dimKey] ?? '';
                const label = (rid && nameMap.get(rid)) || (rid ? rid.slice(0, 8) + '…' : '—');
                return (
                  <li key={rid || i} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-subtle text-tiny font-semibold text-accent-text">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-small font-medium text-fg">{label}</span>
                    <span className="shrink-0 text-tiny text-fg-secondary">{Number(r.metrics['conversions'] ?? 0)} conv</span>
                    <span className="shrink-0 text-small font-semibold tabular-nums text-fg">{money(r.metrics['revenue'] ?? 0)}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
    </div>
  );
}

// ── Non-admin roles: live 24h tiles ────────────────────────────────────────
type Summary = Record<string, unknown>;
interface Tile { label: string; hint: string; val: (s: Summary) => string }
const int = (v: unknown) => (v == null ? '—' : String(v));
const pct = (v: unknown) => (v == null ? '—' : `${(Number(v) * 100).toFixed(1)}%`);
const CONFIG: Record<Exclude<Role, 'admin'>, { endpoint?: string; tiles: Tile[] }> = {
  super_admin: {
    endpoint: '/platform/summary',
    tiles: [
      { label: 'Networks', hint: 'Active / total', val: (s) => `${int(s['activeNetworks'])} / ${int(s['networks'])}` },
      { label: 'MRR', hint: 'Active subscriptions', val: (s) => money(String(s['mrr'] ?? 0)) },
      { label: 'Clicks (24h)', hint: 'Platform-wide', val: (s) => int(s['clicks24h']) },
      { label: 'Conversions (24h)', hint: 'Platform-wide', val: (s) => int(s['conversions24h']) },
    ],
  },
  publisher: {
    endpoint: '/api/portal/publisher/summary',
    tiles: [
      { label: 'Clicks (24h)', hint: 'Your traffic', val: (s) => int(s['clicks']) },
      { label: 'Conversions (24h)', hint: 'Attributed to you', val: (s) => int(s['conversions']) },
      { label: 'EPC', hint: 'Earnings per click', val: (s) => money(String(s['epc'] ?? 0)) },
      { label: 'Payable balance', hint: 'Approved', val: (s) => money(String(s['balance'] ?? 0)) },
    ],
  },
  advertiser: {
    endpoint: '/api/portal/advertiser/summary',
    tiles: [
      { label: 'Clicks (24h)', hint: 'Your offers', val: (s) => int(s['clicks']) },
      { label: 'Conversions (24h)', hint: 'Recorded', val: (s) => int(s['conversions']) },
      { label: 'Conv. rate', hint: 'Last 24h', val: (s) => pct(s['cr']) },
      { label: 'Spend (24h)', hint: 'Billed', val: (s) => money(String(s['revenue'] ?? 0)) },
    ],
  },
};

function RoleTiles({ role, name }: { role: Exclude<Role, 'admin'>; name: string }) {
  const cfg = CONFIG[role];
  const { data, loading } = useQuery<Summary>(cfg.endpoint ?? '/api/me');
  return (
    <>
      <PageHeader title={`Welcome, ${name}`} subtitle={`${ROLE_LABELS[role]} · last 24 hours`} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cfg.tiles.map((t) => (
          <StatCard key={t.label} label={t.label} hint={t.hint} value={loading ? '…' : data ? t.val(data) : '—'} />
        ))}
      </div>
    </>
  );
}
