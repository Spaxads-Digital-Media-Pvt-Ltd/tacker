/**
 * Offers › Smart Links › Smart Link Details — matches the reference's own dedicated page (verified
 * live at /offers/campaigns/3): General/History tabs (+ a Run Record tab, only for KPI-mechanism
 * links), a "General" card (Edit + Copy), a "Stats" card (real, from the same reporting engine as
 * the Smart Link Report), a mechanism-specific config card, an "Offers" card, and a top-right
 * "Smart Link Tracking Links" button.
 */
import { Fragment, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Link2, Pencil, Copy } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Tabs, Spinner, StateBlock, type Column, Table } from '../../shared-components/primitives/ui';
import { METRICS_PARAM, deriveRow, pct, type AggResult } from '../../shared-components/primitives/ReportPageKit';
import { useReportZone } from '../../lib/useReportZone';
import { combineCurrencies, currenciesOf, moneyByCurrencyOf, withBreakdownMetrics } from '../../lib/reportCurrency';
import { Money, MoneyPct } from '../../shared-components/primitives/ReportMoney';
import { InfoCard, InfoGrid, InfoRow } from './controlCenter/shared';
import { fmtDateTime, REDIRECT_MECHANISMS, KPI_DEFAULTS, type KpiRun, type SmartLink, type SmartLinkItem } from '../../data/smartLinks';
import { formatMdyDateTime } from '../../lib/datetime';
import { conversionMoney } from '../../lib/conversionReport';
import { SmartLinkTrackingLinksModal } from './SmartLinkTrackingLinksModal';
import type { Advertiser, Offer, TrackingDomain } from '../../types';

function DateTimeValue({ iso }: { iso: string }) {
  const { date, time } = fmtDateTime(iso);
  return <>{date}<span className="mt-0.5 block text-tiny text-fg-secondary">{time}</span></>;
}

interface HistoryRow { id: string; operationTime: string; service: string; changes: string; employee: string | null; method: string; portal: string; userIp: string | null }

function HistoryTab({ id }: { id: string }) {
  const { data, loading, error } = useQuery<HistoryRow[]>(`/api/smart-links/${id}/history`);
  const columns: Column<HistoryRow>[] = [
    { header: 'Operation Time', cell: (r) => new Date(r.operationTime).toLocaleString() },
    { header: 'Changes', cell: (r) => r.changes },
    { header: 'Employee', cell: (r) => r.employee ?? 'System' },
    { header: 'Method', cell: (r) => r.method },
    { header: 'Portal', cell: (r) => r.portal },
    { header: 'User IP', cell: (r) => r.userIp ?? '—' },
  ];
  return loading ? <StateBlock><Spinner /></StateBlock>
    : error ? <StateBlock>{error}</StateBlock>
    : !data || data.length === 0 ? <StateBlock>No changes recorded yet.</StateBlock>
    : <div className="card"><Table columns={columns} rows={data} rowKey={(r) => r.id} /></div>;
}

const RUNS_PAGE = 25;

/** An item's score as the metric reads: CVR as a percentage, EPC / Revenue per click. */
function scoreText(score: string | null, metric: KpiRun['metric']): string {
  if (score == null) return '—';
  const n = Number(score);
  return metric === 'CVR' ? `${(n * 100).toFixed(2)}%` : n.toFixed(4);
}

/** Run Record — every KPI scoring run of the link (newest first): who won, and what each offer scored. */
function RunRecordTab({ id }: { id: string }) {
  const zone = useReportZone();
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const { data, loading, error } = useQuery<KpiRun[] & { pagination?: { total?: number } }>(`/api/smart-links/${id}/kpi-runs?limit=${RUNS_PAGE}&offset=${page * RUNS_PAGE}`);
  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error) return <StateBlock>{error}</StateBlock>;
  if (!data || data.length === 0) {
    return <StateBlock>No runs yet. The KPI worker scores this link every Run Frequency once it is active — each run is listed here.</StateBlock>;
  }
  const total = data.pagination?.total ?? data.length; // api.ts keeps the envelope's pagination on the array
  return (
    <div className="card overflow-x-auto">
      <table className="premium-table">
        <thead className="border-b border-border bg-page text-tiny font-semibold uppercase text-fg-secondary">
          <tr>
            <th className="px-4 py-2" title={zone.tz}>Run Time ({zone.short})</th><th className="px-4 py-2">Metric</th>
            <th className="px-4 py-2">Lookback</th><th className="px-4 py-2">Winning Offer</th><th className="px-4 py-2 text-right">Clicks Evaluated</th><th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {data.map((run) => {
            const top = Math.max(0, ...run.items.map((i) => i.weight ?? 0));
            const winners = run.weighted ? run.items.filter((i) => i.weight === top) : [];
            const clicks = run.items.reduce((t, i) => t + i.clicks, 0);
            const expanded = open === run.id;
            return (
              <Fragment key={run.id}>
                <tr>
                  <td className="px-4 py-2 tabular-nums">{formatMdyDateTime(run.ranAt, zone.tz)}</td>
                  <td className="px-4 py-2">{run.metric}</td>
                  <td className="px-4 py-2 text-fg-secondary">{run.lookbackHours} Hours</td>
                  <td className="px-4 py-2">
                    {winners.length ? winners.map((w) => w.offerName ?? w.offerId.slice(0, 8)).join(', ')
                      : <span className="text-fg-muted">Even rotation — no offer has {run.minClicks} clicks and a score yet</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{clicks}</td>
                  <td className="px-4 py-2 text-right">
                    <button className="text-tiny font-medium text-accent-text" onClick={() => setOpen(expanded ? null : run.id)}>{expanded ? 'Hide' : 'Details'}</button>
                  </td>
                </tr>
                {expanded && (
                  <tr>
                    <td colSpan={6} className="bg-page px-4 py-3">
                      <table className="w-full text-small">
                        <thead className="text-tiny uppercase text-fg-secondary">
                          <tr><th className="py-1 text-left">Offer</th><th className="py-1 text-right">Clicks</th><th className="py-1 text-right">Conversions</th>
                            <th className="py-1 text-right">Payout</th><th className="py-1 text-right">Revenue</th><th className="py-1 text-right">Score ({run.metric})</th><th className="py-1 text-right">Traffic share</th></tr>
                        </thead>
                        <tbody>
                          {run.items.map((i) => (
                            <tr key={i.itemId}>
                              <td className="py-1">{i.offerName ?? i.offerId}</td>
                              <td className="py-1 text-right tabular-nums">{i.clicks}</td>
                              <td className="py-1 text-right tabular-nums">{i.conversions}</td>
                              <td className="py-1 text-right tabular-nums">{conversionMoney(i.payout, null).text}</td>
                              <td className="py-1 text-right tabular-nums">{conversionMoney(i.revenue, null).text}</td>
                              <td className="py-1 text-right tabular-nums">{scoreText(i.score, run.metric)}</td>
                              <td className="py-1 text-right tabular-nums">{run.weighted && i.weight != null ? `${i.weight}%` : 'Even'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center justify-between px-4 py-2 text-tiny text-fg-secondary">
        <span>{page * RUNS_PAGE + 1}–{page * RUNS_PAGE + data.length} of {total}</span>
        <span className="flex gap-2">
          <button className="btn-secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <button className="btn-secondary" disabled={(page + 1) * RUNS_PAGE >= total} onClick={() => setPage((p) => p + 1)}>Next</button>
        </span>
      </div>
    </div>
  );
}

function StatsCard({ id }: { id: string }) {
  // "Today" is the report zone's day (D7 — the network's unless the viewer picked another).
  const zone = useReportZone();
  const today = zone.today();
  const { data } = useQuery<AggResult>(`/api/reports?groupBy=smartLink&metrics=${withBreakdownMetrics(METRICS_PARAM)}&smartLinkId=${id}&${new URLSearchParams(zone.range(today, today)).toString()}`);
  const { data: settings } = useQuery<{ general?: { defaultCurrency?: string } }>('/api/settings');
  const row = data?.rows[0];
  const d = deriveRow(row?.metrics ?? {});
  // Money in its conversions' currency; mixed → per-currency amounts (newer API), never a summed total.
  const rc = combineCurrencies([currenciesOf(row?.metrics)], settings?.general?.defaultCurrency ?? 'USD');
  const breakdown = moneyByCurrencyOf(row?.metrics);
  return (
    <InfoCard title="Stats" action={
      <div className="flex items-center gap-3 text-tiny text-fg-secondary">
        <span>{today} to {today}</span>
        <a href={`/app/reports/smartlink?smartLinkId=${id}`} className="flex items-center gap-1 font-medium text-accent-text hover:underline">View Report</a>
      </div>
    }>
      <div className="overflow-x-auto">
        <table className="premium-table">
          <thead className="text-tiny uppercase tracking-wide text-fg-secondary">
            <tr><th className="pb-2 pr-4 font-semibold">Revenue</th><th className="pb-2 pr-4 font-semibold">Payout</th><th className="pb-2 pr-4 font-semibold">Margin</th><th className="pb-2 pr-4 font-semibold">Clicks</th><th className="pb-2 pr-4 font-semibold">CV</th><th className="pb-2 font-semibold">CVR</th></tr>
          </thead>
          <tbody>
            <tr>
              <td className="pr-4 pt-1"><Money value={d.revenue} rc={rc} breakdown={breakdown} field="revenue" roomy /></td>
              <td className="pr-4 pt-1"><Money value={d.payout} rc={rc} breakdown={breakdown} field="payout" roomy /></td>
              <td className="pr-4 pt-1"><MoneyPct value={d.marginPct} rc={rc} /></td>
              <td className="pr-4 pt-1"><a href={`/app/reports/smartlink?smartLinkId=${id}`} className="text-accent-text hover:underline">{d.clicks}</a></td>
              <td className="pr-4 pt-1"><a href={`/app/reports/smartlink?smartLinkId=${id}`} className="text-accent-text hover:underline">{d.cv}</a></td>
              <td className="pt-1">{pct(d.cvr)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </InfoCard>
  );
}

function OffersCard({ id, mechanism, items, offers, advertisers, nav }: { id: string; mechanism: string; items: SmartLinkItem[]; offers: Offer[]; advertisers: Advertiser[]; nav: (p: string) => void }) {
  const [q, setQ] = useState('');
  const rows = items.filter((it) => {
    const o = offers.find((x) => x.id === it.offerId);
    return !q.trim() || (o?.name ?? '').toLowerCase().includes(q.trim().toLowerCase());
  });
  return (
    <InfoCard title="Offers" action={<button className="flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={() => nav(`/app/smart-links/${id}/edit`)}><Pencil size={12} />Edit</button>}>
      <div className="mb-3 flex justify-end">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="input !w-56" />
      </div>
      {rows.length === 0 ? <p className="text-small text-fg-muted">No offers configured.</p> : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="premium-table">
            <thead className="border-b border-border bg-page text-tiny font-semibold uppercase text-fg-secondary">
              <tr>
                <th className="px-4 py-2">ID</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">URL</th>
                <th className="px-4 py-2">Advertiser</th><th className="px-4 py-2">Category</th>
                {mechanism === 'weight' && <th className="px-4 py-2">Weight</th>}
                {mechanism === 'priority' && <th className="px-4 py-2">Position</th>}
                <th className="px-4 py-2">Geo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => {
                const o = offers.find((x) => x.id === it.offerId);
                return (
                  <tr key={it.id}>
                    <td className="px-4 py-2 tabular-nums text-fg-secondary">{o?.ref ?? '—'}</td>
                    <td className="px-4 py-2"><span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${o?.status === 'active' ? 'bg-success' : 'bg-fg-muted'}`} />{o?.name ?? it.offerId.slice(0, 8) + '…'}</span></td>
                    <td className="px-4 py-2 text-fg-secondary">{it.offerUrl || 'Default'}</td>
                    <td className="px-4 py-2 text-accent-text">{advertisers.find((a) => a.id === o?.advertiserId)?.name ?? '—'}</td>
                    <td className="px-4 py-2 text-fg-secondary">{o?.category ?? '—'}</td>
                    {mechanism === 'weight' && <td className="px-4 py-2 tabular-nums text-fg-secondary">{it.weight}</td>}
                    {mechanism === 'priority' && <td className="px-4 py-2 tabular-nums text-fg-secondary">{it.position ?? '—'}</td>}
                    <td className="px-4 py-2 text-fg-secondary">{it.country || 'All'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </InfoCard>
  );
}

export default function SmartLinkDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { data, loading, error } = useQuery<SmartLink & { items: SmartLinkItem[] }>(`/api/smart-links/${id}`);
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: domains } = useQuery<TrackingDomain[]>('/api/tracking-domains');
  const [tab, setTab] = useState('General');
  const [linksOpen, setLinksOpen] = useState(false);
  const copy = useMutation((lid: string) => api.post<SmartLink>(`/api/smart-links/${lid}/copy`, {}));
  const [copyErr, setCopyErr] = useState<string | null>(null);

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error || !data) return <StateBlock>{error ?? 'Smart link not found'}</StateBlock>;

  const tabs = ['General', ...(data.redirectMechanism === 'kpi' ? ['Run Record'] : []), 'History'];
  const mechanismLabel = REDIRECT_MECHANISMS.find((m) => m.value === data.redirectMechanism)?.label ?? data.redirectMechanism;

  return (
    <>
      <PageHeader title={`Smart Link Details: ${data.name}`} subtitle={`Offers › Smart Links › ${data.name} › Details`}
        action={<button className="btn-primary" onClick={() => setLinksOpen(true)}><Link2 size={14} /> Smart Link Tracking Links</button>} />
      {copyErr && <p className="mb-3 text-small text-danger-text">{copyErr}</p>}
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'History' ? <HistoryTab id={id} />
        : tab === 'Run Record' ? <RunRecordTab id={id} />
        : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
              <InfoCard title="General" action={
                <div className="flex items-center gap-3">
                  <button className="flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={() => nav(`/app/smart-links/${id}/edit`)}><Pencil size={12} />Edit</button>
                  <button className="flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={async () => { setCopyErr(null); try { const res = await copy.run(id); if (res) nav(`/app/smart-links/${res.id}`); } catch { setCopyErr(copy.error ?? 'Failed to copy smart link.'); } }}><Copy size={12} />Copy</button>
                </div>
              }>
                <InfoGrid>
                  <InfoRow label="ID" value={<span className="tabular-nums">{data.ref}</span>} />
                  <InfoRow label="Status" value={data.status === 'active' ? 'Active' : data.status === 'paused' ? 'Paused' : 'Deleted'} />
                  <InfoRow label="Name" value={data.name} />
                  <InfoRow label="Modified" value={<DateTimeValue iso={data.updatedAt} />} />
                  <InfoRow label="SSL" value={data.forceSsl ? 'YES' : 'NO'} />
                  <InfoRow label="Created" value={<DateTimeValue iso={data.createdAt} />} />
                  <InfoRow label="Show to Partners" value={data.showToPartners ? 'YES' : 'NO'} />
                  <InfoRow label="Labels" value={data.labels} />
                  <InfoRow label="Redirect Mechanism" value={mechanismLabel} />
                </InfoGrid>
              </InfoCard>
              <StatsCard id={id} />
            </div>

            {data.redirectMechanism === 'kpi' && (
              <InfoCard title="KPI-based Smart Link Configuration" action={<span />}>
                <InfoGrid>
                  <InfoRow label="Run Frequency" value={`${data.kpiRunFrequencyHours ?? KPI_DEFAULTS.runFrequencyHours} Hours${data.kpiRunFrequencyHours ? '' : ' (default)'}`} />
                  <InfoRow label="Data Lookback Window" value={`${data.kpiLookbackHours ?? KPI_DEFAULTS.lookbackHours} Hours${data.kpiLookbackHours ? '' : ' (default)'}`} />
                  <InfoRow label="Metric" value={data.kpiMetric ?? 'CVR (default)'} />
                  <InfoRow label="Data Collection Period Threshold" value={`${data.kpiMinClicks ?? KPI_DEFAULTS.minClicks} Clicks${data.kpiMinClicks ? '' : ' (default)'}`} />
                </InfoGrid>
              </InfoCard>
            )}

            <OffersCard id={id} mechanism={data.redirectMechanism} items={data.items} offers={offers ?? []} advertisers={advertisers ?? []} nav={nav} />
          </div>
        )}

      {linksOpen && <SmartLinkTrackingLinksModal smartLink={data} domains={domains ?? []} onClose={() => setLinksOpen(false)} />}
    </>
  );
}
