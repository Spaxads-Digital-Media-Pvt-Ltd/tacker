import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowDownRight, ChevronRight } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS, type Role } from '../auth/roles';
import { useQuery } from '../lib/useApi';
import { PageHeader, StatCard, Spinner, StateBlock } from '../components/ui';
import { AreaChart, type ChartSeries } from '../components/AreaChart';
import type { Offer, Publisher, Advertiser } from '../types';

/**
 * Role-aware overview. Admins get a statement-style "Today's Stats" board: a lean KPI strip, one
 * combined performance chart (toggleable series, hover crosshair), a period-comparison table, and
 * top-rankings panels. Other roles get their own live 24h tiles (audience metric policy enforced
 * server-side — publishers never see revenue/margin, advertisers never see payout).
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

function AdminDashboard({ name }: { name: string }) {
  const { data, loading, error } = useQuery<Dashboard>('/api/reports/dashboard');
  const topOffers = useQuery<AggResult>('/api/reports?groupBy=offer&metrics=clicks,conversions,revenue');
  const topPubs = useQuery<AggResult>('/api/reports?groupBy=publisher&metrics=clicks,conversions,revenue');
  const topAdvs = useQuery<AggResult>('/api/reports?groupBy=advertiser&metrics=clicks,conversions,revenue');
  const offers = useQuery<Offer[]>('/api/offers');
  const pubs = useQuery<Publisher[]>('/api/publishers');
  const advs = useQuery<Advertiser[]>('/api/advertisers');

  const offerMap: RefMap = new Map((offers.data ?? []).map((o) => [o.id, o.ref != null ? `(${o.ref}) ${o.name}` : o.name]));
  const pubMap: RefMap = new Map((pubs.data ?? []).map((p) => [p.id, p.ref != null ? `(${p.ref}) ${p.name}` : p.name]));
  const advMap: RefMap = new Map((advs.data ?? []).map((a) => [a.id, a.ref != null ? `(${a.ref}) ${a.name}` : a.name]));

  const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
  const chartSeries: ChartSeries[] = data ? [
    { key: 'clicks', label: 'Clicks', color: '#0284c7', data: data.series.clicks, format: compact },
    { key: 'conversions', label: 'Conversions', color: '#7c3aed', data: data.series.conversions, format: compact },
    { key: 'revenue', label: 'Revenue', color: '#0d9488', data: data.series.revenue, format: money },
    { key: 'payout', label: 'Payout', color: '#d97706', data: data.series.payout, format: money },
  ] : [];

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`Welcome back, ${name}`} />

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error || !data ? <StateBlock>{error ?? 'Failed to load'}</StateBlock>
        : (
          <>
            {/* Lean KPI strip */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
              <Kpi label="Clicks" value={compact(data.clicks.today)} d={delta(data.clicks.today, data.clicks.yesterday)} />
              <Kpi label="Conversions" value={compact(data.conversions.today)} d={delta(data.conversions.today, data.conversions.yesterday)} />
              <Kpi label="Conv. rate" value={`${data.cr.today}%`} d={delta(data.cr.today, data.cr.yesterday)} />
              <Kpi label="Revenue" value={money(data.revenue.today)} d={delta(Number(data.revenue.today), Number(data.revenue.yesterday))} />
              <Kpi label="Payout" value={money(data.payout.today)} d={delta(Number(data.payout.today), Number(data.payout.yesterday))} />
              <Kpi label="Margin" value={money(data.margin.today)} d={delta(Number(data.margin.today), Number(data.margin.yesterday))} />
            </div>

            {/* Combined performance chart */}
            <div className="card mt-6">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="font-display text-h3 font-semibold text-fg">Performance · today by hour</h2>
              </div>
              <AreaChart series={chartSeries} xLabels={hours} />
            </div>

            {/* Period comparison — a small statement-style table */}
            <div className="card mt-6 !p-0">
              <h2 className="border-b border-border px-5 py-3 font-display text-h3 font-semibold text-fg">Period comparison</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-small">
                  <thead>
                    <tr className="border-b border-border text-tiny uppercase tracking-wide text-fg-muted">
                      <th className="px-5 py-2.5 font-semibold">Metric</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Today</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Yesterday</th>
                      <th className="px-5 py-2.5 text-right font-semibold">This month</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Last month</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <PeriodRow label="Clicks" p={data.clicks} fmt={compact} />
                    <PeriodRow label="Conversions" p={data.conversions} fmt={compact} />
                    <PeriodRow label="Conv. rate" p={data.cr} fmt={(v) => `${v}%`} />
                    <PeriodRow label="Revenue" p={data.revenue} fmt={money} />
                    <PeriodRow label="Payout" p={data.payout} fmt={money} />
                    <PeriodRow label="Margin" p={data.margin} fmt={money} />
                  </tbody>
                </table>
              </div>
            </div>

            {/* Top rankings */}
            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
              <TopCard title="Top offers" dimKey="offer" q={topOffers} nameMap={offerMap} viewAll="/app/reports/offer" />
              <TopCard title="Top publishers" dimKey="publisher" q={topPubs} nameMap={pubMap} viewAll="/app/reports/affiliate" />
              <TopCard title="Top advertisers" dimKey="advertiser" q={topAdvs} nameMap={advMap} viewAll="/app/reports/advertiser" />
            </div>
          </>
        )}
    </>
  );
}

function Kpi({ label, value, d }: { label: string; value: string; d: { pct: number; up: boolean } | null }) {
  return (
    <div className="card !p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="eyebrow">{label}</p>
        {d && (
          <span className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-tiny font-semibold ${d.up ? 'bg-success-bg text-success-text' : 'bg-danger-bg text-danger-text'}`}>
            {d.up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />} {Math.abs(d.pct)}%
          </span>
        )}
      </div>
      <p className="mt-1.5 font-display text-h1 font-bold tracking-tight text-fg">{value}</p>
    </div>
  );
}

function PeriodRow<K extends string | number>({ label, p, fmt }: {
  label: string; p: { today: K; yesterday: K; month: K; lastMonth: K }; fmt: (v: K) => string;
}) {
  return (
    <tr>
      <td className="px-5 py-2.5 font-medium text-fg">{label}</td>
      <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-fg">{fmt(p.today)}</td>
      <td className="px-5 py-2.5 text-right tabular-nums text-fg-secondary">{fmt(p.yesterday)}</td>
      <td className="px-5 py-2.5 text-right tabular-nums text-fg-secondary">{fmt(p.month)}</td>
      <td className="px-5 py-2.5 text-right tabular-nums text-fg-secondary">{fmt(p.lastMonth)}</td>
    </tr>
  );
}

/** Top-5 ranking card: bordered list rows, name resolved to (ref) name, sorted by revenue. */
function TopCard({ title, dimKey, q, nameMap, viewAll }: {
  title: string; dimKey: string; q: { data: AggResult | null; loading: boolean; error: string | null };
  nameMap: RefMap; viewAll: string;
}) {
  const rows = [...(q.data?.rows ?? [])]
    .sort((a, b) => Number(b.metrics['revenue'] ?? 0) - Number(a.metrics['revenue'] ?? 0))
    .slice(0, 5);
  return (
    <div className="card !p-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-h3 font-medium text-fg">{title}</h2>
        <Link to={viewAll} className="inline-flex items-center gap-0.5 text-tiny font-medium text-accent hover:underline">
          View all <ChevronRight size={13} />
        </Link>
      </div>
      {q.loading ? <div className="grid place-items-center py-10"><Spinner /></div>
        : rows.length === 0 ? <p className="px-4 py-8 text-center text-small text-fg-muted">No data yet.</p>
        : (
          <ul className="divide-y divide-border">
            {rows.map((r, i) => {
              const id = r.dimensions[dimKey] ?? '';
              const label = (id && nameMap.get(id)) || (id ? id.slice(0, 8) + '…' : '—');
              return (
                <li key={id || i} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-subtle text-tiny font-semibold text-accent-text">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-small font-medium text-fg">{label}</span>
                  <span className="shrink-0 text-tiny text-fg-secondary">{Number(r.metrics['conversions'] ?? 0)} conv</span>
                  <span className="shrink-0 text-small font-semibold tabular-nums text-fg">{money(r.metrics['revenue'] ?? 0)}</span>
                </li>
              );
            })}
          </ul>
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
