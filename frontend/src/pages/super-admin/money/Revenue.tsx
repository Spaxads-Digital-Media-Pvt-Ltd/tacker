/**
 * Super Admin › Money › Revenue — the finance team's home: MRR / ARR / paying customers / ARPA, this month's
 * MRR movements (new, expansion, reactivation, contraction, churn → net new), logo churn and LTV, trial → paid,
 * the 12-month MRR trend, cash collected against invoiced, outstanding and overdue, MRR by plan, the top
 * customers and the renewals of the next 30 days. One currency at a time — never summed across currencies.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CircleDollarSign, Repeat, Sparkles, TrendingDown, TrendingUp, Users, Wallet } from 'lucide-react';
import { useQuery } from '../../../lib/useApi';
import { money, day } from '../../../lib/platformBilling';
import { relTime } from '../../../lib/relativeTime';
import type { Movement, RevenueSummary } from '../../../lib/platformRevenue';
import { PageHeader, Segmented, Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { BarList, Empty, KpiTile, Panel, TrendChart } from '../kit';

const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });
const last12 = (): string[] => {
  const out: string[] = []; const d = new Date();
  for (let i = 11; i >= 0; i--) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); out.push(x.toISOString().slice(0, 7)); }
  return out;
};
/** Decimal text → a number for chart heights only (amounts shown are always the text). */
const n = (t: string | null | undefined) => Number(t ?? 0);

function MovementRows({ m, currency }: { m: Movement | undefined; currency: string }) {
  const rows: [string, string, string][] = [
    ['New', m?.new ?? '0', 'text-success-text'], ['Expansion', m?.expansion ?? '0', 'text-success-text'], ['Reactivation', m?.reactivation ?? '0', 'text-success-text'],
    ['Contraction', m?.contraction ?? '0', 'text-danger-text'], ['Churn', m?.churn ?? '0', 'text-danger-text'],
  ];
  return (
    <div className="space-y-1.5 px-4 py-3 text-small">
      {rows.map(([label, v, cls]) => (
        <div key={label} className="flex justify-between"><span className="text-fg-secondary">{label}</span><span className={n(v) === 0 ? 'text-fg-muted' : cls}>{n(v) > 0 ? '+' : ''}{money(v, currency)}</span></div>
      ))}
      <div className="flex justify-between border-t border-border pt-1.5 font-semibold"><span className="text-fg">Net new MRR</span>
        <span className={n(m?.net) > 0 ? 'text-success-text' : n(m?.net) < 0 ? 'text-danger-text' : 'text-fg'}>{n(m?.net) > 0 ? '+' : ''}{money(m?.net ?? '0', currency)}</span></div>
      <p className="pt-1 text-tiny text-fg-muted">{m?.new_count ?? 0} new customer(s) · {m?.churn_count ?? 0} churned</p>
    </div>
  );
}

export default function Revenue() {
  const { data: s, loading, error } = useQuery<RevenueSummary>('/platform/revenue/summary');
  const currencies = useMemo(() => {
    if (!s) return [];
    const set = new Set<string>([...s.mrr.map((m) => m.currency), ...s.collected.map((c) => c.currency), ...s.invoiced.map((c) => c.currency), ...s.outstanding.map((o) => o.currency)]);
    return [...set].sort((a, b) => n(s.mrr.find((m) => m.currency === b)?.amount) - n(s.mrr.find((m) => m.currency === a)?.amount));
  }, [s]);
  const [picked, setPicked] = useState<string | null>(null);
  if (loading && !s) return <StateBlock><Spinner /></StateBlock>;
  if (error || !s) return <StateBlock>{error ?? 'Could not load revenue'}</StateBlock>;
  const cur = picked && currencies.includes(picked) ? picked : currencies[0] ?? 'USD';
  const mrr = s.mrr.find((m) => m.currency === cur);
  const thisM = s.movements.thisMonth.find((m) => m.currency === cur);
  const lastM = s.movements.lastMonth.find((m) => m.currency === cur);
  const months = last12();
  const churnNow = s.churn.at(-1);
  const out = s.outstanding.find((o) => o.currency === cur);
  const ltv = s.ltv?.find((l) => l.currency === cur);

  return (
    <>
      <PageHeader title="Revenue" subtitle="Recurring revenue, how it moves, and the cash behind it."
        action={currencies.length > 1 ? <Segmented className="sm:w-72" options={currencies} value={cur} onChange={setPicked} /> : undefined} />
      {s.historySince && <p className="mb-3 text-tiny text-fg-muted">MRR history since {day(s.historySince)} — the trend and movements fill in day by day.</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="MRR" icon={CircleDollarSign} tone="success" hint={`ARR ${money(mrr?.arr ?? '0', cur)}`}>{money(mrr?.amount ?? '0', cur)}</KpiTile>
        <KpiTile label="Net new MRR · this month" icon={n(thisM?.net) < 0 ? TrendingDown : TrendingUp} tone={n(thisM?.net) < 0 ? 'danger' : 'success'}
          hint={`Last month ${n(lastM?.net) > 0 ? '+' : ''}${money(lastM?.net ?? '0', cur)}`}>{n(thisM?.net) > 0 ? '+' : ''}{money(thisM?.net ?? '0', cur)}</KpiTile>
        <KpiTile label="Paying customers" icon={Users} tone="info" hint={`ARPA ${money(mrr?.arpa ?? '0', cur)} a month`}>{mrr?.customers ?? 0}</KpiTile>
        <KpiTile label="Logo churn · this month" icon={Repeat} tone={churnNow?.rate ? 'warning' : 'success'}
          hint={churnNow ? `${churnNow.churned} of ${churnNow.at_start} paying at the start` : 'No history yet'}>{churnNow?.rate == null ? '—' : `${churnNow.rate}%`}</KpiTile>
        <KpiTile label="Lifetime value" icon={Sparkles} tone="info" hint={ltv ? `ARPA ÷ ${ltv.avgMonthlyChurnPct}% monthly churn (3 months)` : 'Needs churn history'}>{ltv ? money(ltv.amount, cur) : '—'}</KpiTile>
        <KpiTile label="Trial → paid · 90 days" icon={TrendingUp} tone="info" hint={`${s.trialConversion.converted} of ${s.trialConversion.ended} trials that ended`}>
          {s.trialConversion.rate === null ? '—' : `${s.trialConversion.rate}%`}
        </KpiTile>
        <KpiTile label="Outstanding" icon={Wallet} to="/admin/billing" hint={`${out?.open_count ?? 0} open invoice(s)`}>{money(out?.open ?? '0', cur)}</KpiTile>
        <KpiTile label="Overdue" icon={AlertTriangle} tone={n(out?.overdue) > 0 ? 'danger' : 'success'} to="/admin/billing">{money(out?.overdue ?? '0', cur)}</KpiTile>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title={`MRR · 12 months · ${cur}`} className="xl:col-span-2">
          {!s.trend.some((t) => t.currency === cur) && <Empty>The history builds up from today: the billing worker records each network’s MRR every day.</Empty>}
          <TrendChart format={(v) => money(v.toFixed(2), cur)} series={[{ name: 'MRR', className: 'bg-success' }]}
            points={months.map((m) => ({ label: monthLabel(m), values: [n(s.trend.find((t) => t.month === m && t.currency === cur)?.mrr)] }))} />
        </Panel>
        <Panel title="MRR movements · this month"><MovementRows m={thisM} currency={cur} /></Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title={`Cash collected vs invoiced · ${cur}`} className="xl:col-span-2">
          <TrendChart format={(v) => money(v.toFixed(2), cur)} series={[{ name: 'Invoiced', className: 'bg-info' }, { name: 'Collected (net of refunds)', className: 'bg-success' }]}
            points={months.map((m) => ({
              label: monthLabel(m),
              values: [n(s.invoiced.find((x) => x.month === m && x.currency === cur)?.amount), Math.max(0, n(s.collected.find((x) => x.month === m && x.currency === cur)?.amount))],
            }))} />
        </Panel>
        <Panel title="MRR by plan">
          {s.byPlan.filter((p) => p.currency === cur).length === 0 ? <Empty>No paying customers yet.</Empty>
            : <BarList format={(v) => money(v.toFixed(2), cur)} color="bg-success"
              rows={s.byPlan.filter((p) => p.currency === cur).map((p) => ({ key: p.plan_id, label: p.plan_name, value: n(p.mrr), hint: `${p.customers} customer(s)` }))} />}
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Top customers by MRR">
          {s.topCustomers.length === 0 ? <Empty>No paying customers yet.</Empty> : s.topCustomers.map((t, i) => (
            <div key={t.network_id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-small">
              <span className="flex min-w-0 items-center gap-3"><span className="w-4 text-tiny text-fg-muted">{i + 1}</span>
                <Link to={`/admin/networks/${t.network_id}?tab=Billing`} className="truncate font-medium text-fg hover:underline">{t.name}</Link>
                <span className="truncate text-tiny text-fg-muted">{t.plan_name}</span></span>
              <span className="shrink-0 font-medium text-fg">{money(t.mrr, t.currency)}</span>
            </div>
          ))}
        </Panel>
        <Panel title="Renewals · next 30 days">
          {s.renewals.length === 0 ? <Empty>No renewal in the next 30 days.</Empty> : s.renewals.map((r) => (
            <div key={r.network_id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-small">
              <div className="min-w-0"><Link to={`/admin/networks/${r.network_id}?tab=Billing`} className="font-medium text-fg hover:underline">{r.name}</Link>
                <p className="text-tiny text-fg-muted">{r.plan_name} · {relTime(r.renews_at)}{r.cancel_at_period_end ? ' · ends instead' : ''}</p></div>
              <span className={`shrink-0 ${r.cancel_at_period_end ? 'text-danger-text line-through' : 'font-medium text-fg'}`}>{money(r.amount, r.currency)}</span>
            </div>
          ))}
        </Panel>
      </div>
    </>
  );
}
