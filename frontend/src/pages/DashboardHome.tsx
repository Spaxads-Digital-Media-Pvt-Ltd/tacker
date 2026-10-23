import { useEffect, useMemo, useState } from 'react';
import { Link2, MousePointerClick, Percent, Target, Wallet } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS, type Role } from '../auth/roles';
import { useQuery } from '../lib/useApi';
import { useReportZone } from '../lib/useReportZone';
import { balanceText } from '../lib/balanceCurrency';
import { moneyDisplay, moneyExact, moneyIn } from '../lib/moneyFormat';
import {
  comparePeriods, currenciesOf, moneyByCurrencyOf, moneyText, parseMoneyByCurrency, resolveCurrency,
  type MoneyField, type MoneyText, type RowCurrency,
} from '../lib/reportCurrency';
import { PageHeader, StatCard, StateBlock } from '../shared-components/primitives/ui';
import { TrackingLinkGeneratorModal } from '../shared-components/panels/TrackingLinkGeneratorModal';
import { buildRange } from './dashboard/range';
import { useDefaultCurrency, useGraph, usePeriods, useSummary, type PeriodKey, type PeriodTotals } from './dashboard/data';
import { alignSeries, changeOf, durSlowMs, formatCount, KPIS, num, reportHref, rowsCurrency, type KpiDef } from './dashboard/metrics';
import { useRangePref, useVisiblePref } from './dashboard/prefs';
import { MixedNote } from './dashboard/parts';
import { CustomizeCards, DateRangeButton } from './dashboard/controls';
import { KpiCard, type KpiCardProps } from './dashboard/KpiCard';
import { PerformanceCard } from './dashboard/PerformanceCard';
import { ConversionRateCard } from './dashboard/ConversionRateCard';
import { TopEntityPanel } from './dashboard/TopEntityPanel';
import { RecentActivityCard } from './dashboard/RecentActivityCard';

/**
 * Role-aware overview. Admins get the dashboard (pages/dashboard/*): KPI cards, performance and
 * conversion-rate charts, leaderboards and recent changes — every window in the report zone, every
 * section loading / failing on its own. Other roles get their own live 24h tiles (audience metric
 * policy enforced server-side — publishers never see revenue/margin, advertisers never see payout).
 */
export default function DashboardHome() {
  const { session } = useAuth();
  if (!session) return null;
  if (session.role === 'admin') return <AdminDashboard name={session.displayName} />;
  if (session.role === 'super_admin') return null; // the Super Admin's own Overview (pages/super-admin/Overview.tsx)
  return <RoleTiles role={session.role} name={session.displayName} />;
}

// ── Admin ────────────────────────────────────────────────────────────────────────────────────────

const PERIOD_ROWS: readonly [label: string, key: Exclude<PeriodKey, 'today'>][] = [
  ['Yesterday', 'yesterday'], ['This month', 'month'], ['Last month', 'lastMonth'],
];

function AdminDashboard({ name }: { name: string }) {
  const zone = useReportZone();
  const [preset, setPreset] = useRangePref();
  const [visible, setVisible] = useVisiblePref();
  // Built once per preset / zone: `to` is "now" at that moment (rebuilding each render would refetch forever).
  const range = useMemo(() => buildRange(preset, zone.tz), [preset, zone.tz]);
  const currency = useDefaultCurrency();
  const current = useSummary(range.current, zone.tz);
  const previous = useSummary(range.previous, zone.tz);
  const graph = useGraph(range);
  const periods = usePeriods(zone.tz);
  const [linkGenOpen, setLinkGenOpen] = useState(false);

  // KPI values count up once, on the first load — a later range change just swaps the figures.
  const [countUp, setCountUp] = useState(true);
  const firstLoaded = current.data !== null;
  useEffect(() => {
    if (!firstLoaded || !countUp) return;
    const t = window.setTimeout(() => setCountUp(false), durSlowMs() + 100);
    return () => window.clearTimeout(t);
  }, [firstLoaded, countUp]);

  const kpiProps = (def: KpiDef): Omit<KpiCardProps, 'className'> => {
    const cur = current.data?.rows[0]?.metrics ?? {};
    const prev = previous.data?.rows[0]?.metrics;
    const graphRows = graph.data?.rows ?? [];
    const base = {
      def, href: reportHref(def.report, range), animate: countUp, compareLabel: range.compareLabel,
      loading: current.loading && !current.data, error: current.data ? null : current.error,
      onRetry: () => { current.refetch(); previous.refetch(); graph.refetch(); periods.refetch(); },
    };
    const breakdown = (fmt: (p: PeriodTotals, k: Exclude<PeriodKey, 'today'>) => MoneyText): KpiCardProps['breakdown'] =>
      PERIOD_ROWS.map(([label, k]) => {
        if (!periods.data) return [label, periods.error ? '—' : '…', periods.error ?? undefined];
        const t = fmt(periods.data, k);
        return [label, t.text, t.title];
      });

    if (def.money) {
      const field: MoneyField = def.money;
      const rc = resolveCurrency(currenciesOf(cur), currency);
      const prevRc = prev ? resolveCurrency(currenciesOf(prev), currency) : null;
      const cmp = prevRc ? comparePeriods(rc, prevRc) : null;
      const seriesRc = rowsCurrency(graphRows, currency);
      const moneyCur = (x: RowCurrency) => (x.kind === 'mixed' ? currency : x.currency);
      return {
        ...base,
        value: moneyDisplay(String(cur[field] ?? '0'), rc, { breakdown: moneyByCurrencyOf(cur), field, roomy: true }),
        amount: rc.kind === 'mixed' ? null : num(cur[field]),
        format: (v) => moneyExact(v, moneyCur(rc)),
        change: cmp?.ok ? changeOf(num(cur[field]), num(prev?.[field])) : null,
        changeNote: cmp && !cmp.ok ? cmp.reason : previous.error ? `Comparison unavailable: ${previous.error}` : undefined,
        previous: prev && prevRc ? moneyDisplay(String(prev[field] ?? '0'), prevRc, { breakdown: moneyByCurrencyOf(prev), field, roomy: true }).text : undefined,
        series: !graph.data || seriesRc.kind === 'mixed' ? null : alignSeries(graphRows, range, field),
        seriesNote: seriesRc.kind === 'mixed'
          ? <MixedNote what={def.label} currencies={seriesRc.currencies} className="h-10 text-tiny" />
          : graph.error ? <p className="text-tiny text-fg-muted">Trend unavailable</p> : null,
        breakdown: breakdown((p, k) => moneyText(Number(p[field][k]), resolveCurrency(p.currencies?.[k], currency),
          { breakdown: parseMoneyByCurrency(p.moneyByCurrency?.[k]), field, roomy: true })),
      };
    }
    const key = def.key as 'clicks' | 'conversions';
    const n = num(cur[key]);
    return {
      ...base,
      value: { text: formatCount(n), muted: false },
      amount: n,
      format: (v) => formatCount(Math.round(v)),
      change: prev ? changeOf(n, num(prev[key])) : null,
      changeNote: previous.error ? `Comparison unavailable: ${previous.error}` : undefined,
      previous: prev ? formatCount(num(prev[key])) : undefined,
      series: graph.data ? alignSeries(graphRows, range, key) : null,
      seriesNote: graph.error ? <p className="text-tiny text-fg-muted">Trend unavailable</p> : null,
      breakdown: breakdown((p, k) => ({ text: formatCount(num(p[key][k])), muted: false })),
    };
  };

  const lower = [visible.offers, visible.publishers, visible.advertisers, visible.recent].some(Boolean);
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Welcome back, ${name}`}
        action={<>
          <CustomizeCards visible={visible} onChange={setVisible} />
          <button type="button" className="btn-primary" onClick={() => setLinkGenOpen(true)}>
            <Link2 size={15} aria-hidden /> Tracking Link Generator
          </button>
          <DateRangeButton range={range} onChange={setPreset} zoneShort={zone.short} />
        </>}
      />
      {linkGenOpen && <TrackingLinkGeneratorModal onClose={() => setLinkGenOpen(false)} />}

      {visible.kpi && (
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6 2xl:grid-cols-5">
          {KPIS.map((def, i) => (
            <KpiCard key={def.key} {...kpiProps(def)} className={i < 3 ? 'lg:col-span-2 2xl:col-span-1' : 'lg:col-span-3 2xl:col-span-1'} />
          ))}
        </div>
      )}

      {(visible.performance || visible.cr) && (
        <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-5">
          {visible.performance && (
            <div className={visible.cr ? 'xl:col-span-3' : 'xl:col-span-5'}>
              <PerformanceCard pageRange={range} pageGraph={graph} currency={currency} zoneShort={zone.short} zoneLabel={zone.label} />
            </div>
          )}
          {visible.cr && (
            <div className={visible.performance ? 'xl:col-span-2' : 'xl:col-span-5'}>
              <ConversionRateCard range={range} current={current} previous={previous} graph={graph} periods={periods} zoneShort={zone.short} />
            </div>
          )}
        </div>
      )}

      {lower && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {visible.offers && <TopEntityPanel dim="offer" title="Top offers" viewAll="/app/reports/offer" currency={currency} tz={zone.tz} />}
          {visible.publishers && <TopEntityPanel dim="publisher" title="Top partners" viewAll="/app/reports/partner" currency={currency} tz={zone.tz} />}
          {visible.advertisers && <TopEntityPanel dim="advertiser" title="Top advertisers" viewAll="/app/reports/advertiser" currency={currency} tz={zone.tz} />}
          {visible.recent && <RecentActivityCard />}
        </div>
      )}

      {!visible.kpi && !visible.performance && !visible.cr && !lower && (
        <StateBlock variant="empty" title="Every card is hidden" hint="Use Customize to choose which cards the dashboard shows." />
      )}
    </>
  );
}

// ── Non-admin roles: live 24h tiles ──────────────────────────────────────────────────────────────

type Summary = Record<string, unknown>;
interface Tile { label: string; hint: string; icon: typeof Wallet; val: (s: Summary) => MoneyText }
const plain = (text: string): MoneyText => ({ text, muted: text === '—' });
const int = (v: unknown) => plain(v == null ? '—' : formatCount(Number(v)));
const pct = (v: unknown) => plain(v == null ? '—' : `${(Number(v) * 100).toFixed(1)}%`);
/**
 * A portal summary's money (`currencies` / `moneyByCurrency`, newer API): in its conversions' one
 * currency, per-currency amounts when they mix (`field`), or "Mixed" for a ratio like EPC. Without
 * currencies (older API, no conversions) it stays the existing USD display.
 */
const portalMoney = (s: Summary, key: string, field?: MoneyField): MoneyText =>
  moneyText(Number(s[key] ?? 0), resolveCurrency(s['currencies'], 'USD'), { breakdown: parseMoneyByCurrency(s['moneyByCurrency']), field, roomy: true });
/**
 * The publisher's payable balance (lib/balanceCurrency): in its one currency, or per currency
 * ("€30.25 · $13.00") when it spans several — never summed. An older API (no currency info) keeps
 * the existing USD display.
 */
const portalBalance = (s: Summary): MoneyText =>
  balanceText({ balance: s['balance'], balances: s['balances'], currency: s['balanceCurrency'] ?? s['currency'] })
  ?? moneyIn(String(s['balance'] ?? 0), 'USD');
const CONFIG: Record<Exclude<Role, 'admin' | 'super_admin'>, { endpoint: string; tiles: Tile[] }> = {
  publisher: {
    endpoint: '/api/portal/publisher/summary',
    tiles: [
      { label: 'Clicks (24h)', hint: 'Your traffic', icon: MousePointerClick, val: (s) => int(s['clicks']) },
      { label: 'Conversions (24h)', hint: 'Attributed to you', icon: Target, val: (s) => int(s['conversions']) },
      { label: 'EPC', hint: 'Earnings per click', icon: Percent, val: (s) => portalMoney(s, 'epc') },
      { label: 'Payable balance', hint: 'Approved', icon: Wallet, val: portalBalance },
    ],
  },
  advertiser: {
    endpoint: '/api/portal/advertiser/summary',
    tiles: [
      { label: 'Clicks (24h)', hint: 'Your offers', icon: MousePointerClick, val: (s) => int(s['clicks']) },
      { label: 'Conversions (24h)', hint: 'Recorded', icon: Target, val: (s) => int(s['conversions']) },
      { label: 'Conversion Rate', hint: 'Last 24h', icon: Percent, val: (s) => pct(s['cr']) },
      { label: 'Spend (24h)', hint: 'Billed', icon: Wallet, val: (s) => portalMoney(s, 'revenue', 'revenue') },
    ],
  },
};
const TILE_TONE = ['clicks', 'conversions', 'margin', 'revenue'] as const;

function RoleTiles({ role, name }: { role: Exclude<Role, 'admin' | 'super_admin'>; name: string }) {
  const cfg = CONFIG[role];
  const { data, loading, error, refetch } = useQuery<Summary>(cfg.endpoint);
  return (
    <>
      <PageHeader title={`Welcome, ${name}`} subtitle={`${ROLE_LABELS[role]} · last 24 hours`} />
      {error && !data ? (
        <StateBlock variant="error" title="Couldn’t load your summary" hint={error} onRetry={refetch} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy={loading || undefined}>
          {cfg.tiles.map((t, i) => {
            const v = data ? t.val(data) : null;
            return (
              <StatCard key={t.label} label={t.label} hint={t.hint} icon={<t.icon size={16} />} tone={TILE_TONE[i]}
                value={loading && !data ? '…' : v ? v.text : '—'} muted={!v || v.muted} valueTitle={v?.title} />
            );
          })}
        </div>
      )}
    </>
  );
}
