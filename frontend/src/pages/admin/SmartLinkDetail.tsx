/**
 * Offers › Smart Links › Smart Link Details — matches the reference's own dedicated page (verified
 * live at /offers/campaigns/3): General/History tabs (+ a Run Record tab, only for KPI-mechanism
 * links), a "General" card (Edit + Copy), a "Stats" card (real, from the same reporting engine as
 * the Smart Link Report), a mechanism-specific config card, an "Offers" card, and a top-right
 * "Smart Link Tracking Links" button.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Link2, Pencil, Copy } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Tabs, Spinner, StateBlock, type Column, Table } from '../../components/ui';
import { EmptyShellTable } from '../../components/EmptyShellTable';
import { METRICS_PARAM, deriveRow, money, pct, toIso, todayStr, type AggResult } from '../../components/ReportPageKit';
import { InfoCard, InfoGrid, InfoRow } from './controlCenter/shared';
import { fmtDateTime, REDIRECT_MECHANISMS, type SmartLink, type SmartLinkItem } from '../../data/smartLinks';
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

function RunRecordTab() {
  return (
    <div className="card">
      <EmptyShellTable columns={['Run Time', 'Metric', 'Winning Offer', 'Clicks Evaluated']} />
    </div>
  );
}

function StatsCard({ id }: { id: string }) {
  const today = todayStr();
  const { data } = useQuery<AggResult>(`/api/reports?groupBy=smartLink&metrics=${METRICS_PARAM}&smartLinkId=${id}&from=${toIso(today)}&to=${toIso(today, true)}`);
  const row = data?.rows[0];
  const d = deriveRow(row?.metrics ?? {});
  return (
    <InfoCard title="Stats" action={
      <div className="flex items-center gap-3 text-tiny text-fg-secondary">
        <span>{today} to {today}</span>
        <a href={`/app/reports/smartlink?smartLinkId=${id}`} className="flex items-center gap-1 font-medium text-accent-text hover:underline">View Report</a>
      </div>
    }>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-small">
          <thead className="text-tiny uppercase tracking-wide text-fg-secondary">
            <tr><th className="pb-2 pr-4 font-semibold">Revenue</th><th className="pb-2 pr-4 font-semibold">Payout</th><th className="pb-2 pr-4 font-semibold">Margin</th><th className="pb-2 pr-4 font-semibold">Clicks</th><th className="pb-2 pr-4 font-semibold">CV</th><th className="pb-2 font-semibold">CVR</th></tr>
          </thead>
          <tbody>
            <tr>
              <td className="pr-4 pt-1">{money(d.revenue)}</td><td className="pr-4 pt-1">{money(d.payout)}</td><td className="pr-4 pt-1">{pct(d.marginPct)}</td>
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
          <table className="w-full min-w-[720px] text-left text-small">
            <thead className="border-b border-border bg-page text-tiny font-semibold uppercase text-fg-secondary">
              <tr>
                <th className="px-4 py-2">ID</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">URL</th>
                <th className="px-4 py-2">Advertiser</th><th className="px-4 py-2">Category</th>
                {mechanism === 'weight' && <th className="px-4 py-2">Weight</th>}
                {mechanism === 'priority' && <th className="px-4 py-2">Position</th>}
                <th className="px-4 py-2">Geo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
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

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error || !data) return <StateBlock>{error ?? 'Smart link not found'}</StateBlock>;

  const tabs = ['General', ...(data.redirectMechanism === 'kpi' ? ['Run Record'] : []), 'History'];
  const mechanismLabel = REDIRECT_MECHANISMS.find((m) => m.value === data.redirectMechanism)?.label ?? data.redirectMechanism;

  return (
    <>
      <PageHeader title={`Smart Link Details: ${data.name}`} subtitle={`Offers › Smart Links › ${data.name} › Details`}
        action={<button className="btn-primary" onClick={() => setLinksOpen(true)}><Link2 size={14} /> Smart Link Tracking Links</button>} />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'History' ? <HistoryTab id={id} />
        : tab === 'Run Record' ? <RunRecordTab />
        : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
              <InfoCard title="General" action={
                <div className="flex items-center gap-3">
                  <button className="flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={() => nav(`/app/smart-links/${id}/edit`)}><Pencil size={12} />Edit</button>
                  <button className="flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={async () => { const res = await copy.run(id); if (res) nav(`/app/smart-links/${res.id}`); }}><Copy size={12} />Copy</button>
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
                  <InfoRow label="Run Frequency" value={data.kpiRunFrequencyHours ? `${data.kpiRunFrequencyHours} Hours` : undefined} />
                  <InfoRow label="Data Lookback Window" value={data.kpiLookbackHours ? `${data.kpiLookbackHours} Hours` : undefined} />
                  <InfoRow label="Metric" value={data.kpiMetric} />
                  <InfoRow label="Data Collection Period Threshold" value={data.kpiMinClicks ? `${data.kpiMinClicks} Clicks` : undefined} />
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
