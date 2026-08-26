/**
 * Offers › Groups › Offer Group Details — matches the reference's own dedicated page (verified live
 * at /offers/groups/3): General/Offers/History tabs, a "General" card (Edit), a "Stats" card (real,
 * from the same today-aggregate as the list page), a "Caps" card rendering the real Click/
 * Conversion/Payout/Revenue × Daily/Weekly/Monthly/Global matrix, and an "Offers" tab listing the
 * group's real member offers.
 */
import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Tabs, Spinner, StateBlock, type Column, Table } from '../../components/ui';
import { InfoCard, InfoGrid, InfoRow } from './controlCenter/shared';
import { fmtDateTime, fmtMoney, CAP_TYPES, TIME_INTERVALS, TIME_INTERVAL_LABEL, type OfferGroup } from '../../data/offerGroups';
import type { Advertiser, Offer } from '../../types';

function DateTimeValue({ iso }: { iso: string }) {
  const { date, time } = fmtDateTime(iso);
  return <>{date}<span className="mt-0.5 block text-tiny text-fg-secondary">{time}</span></>;
}

interface Stats { revenue: string; payout: string; margin: string; clicks: number; cv: number; cvr: number }

function StatsCard({ id }: { id: string }) {
  const { data } = useQuery<Stats>(`/api/offer-groups/${id}/stats`);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <InfoCard title="Stats" action={
      <div className="flex items-center gap-3 text-tiny text-fg-secondary">
        <span>{today} to {today}</span>
        <Link to="/app/reports/offer" className="font-medium text-accent-text hover:underline">View Report</Link>
      </div>
    }>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-small">
          <thead className="text-tiny uppercase tracking-wide text-fg-secondary">
            <tr><th className="pb-2 pr-4 font-semibold">Revenue</th><th className="pb-2 pr-4 font-semibold">Payout</th><th className="pb-2 pr-4 font-semibold">Margin</th><th className="pb-2 pr-4 font-semibold">Clicks</th><th className="pb-2 pr-4 font-semibold">CV</th><th className="pb-2 font-semibold">CVR</th></tr>
          </thead>
          <tbody>
            <tr>
              <td className="pr-4 pt-1">{fmtMoney(data?.revenue)}</td><td className="pr-4 pt-1">{fmtMoney(data?.payout)}</td><td className="pr-4 pt-1">{fmtMoney(data?.margin)}</td>
              <td className="pr-4 pt-1">{data?.clicks ?? 0}</td><td className="pr-4 pt-1">{data?.cv ?? 0}</td><td className="pt-1">{((data?.cvr ?? 0) * 100).toFixed(2)}%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </InfoCard>
  );
}

const CAP_TYPE_ROW_LABEL: Record<string, string> = { clicks: 'Clicks', conversions: 'Conversions', payout: 'Payout', revenue: 'Revenue' };

function CapsCard({ data, id, nav }: { data: OfferGroup; id: string; nav: (p: string) => void }) {
  return (
    <InfoCard title="Caps" action={<button className="flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={() => nav(`/app/offers-groups/${id}/edit?tab=tracking`)}><Pencil size={12} />Edit</button>}>
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full min-w-[480px] text-left text-small">
          <thead className="border-b border-border bg-page text-tiny font-semibold uppercase text-fg-secondary">
            <tr><th className="px-4 py-2">Type</th>{TIME_INTERVALS.map((i) => <th key={i} className="px-4 py-2">{TIME_INTERVAL_LABEL[i]}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {CAP_TYPES.map((t) => (
              <tr key={t.key}>
                <td className="px-4 py-2 font-medium text-fg">{CAP_TYPE_ROW_LABEL[t.key]}</td>
                {TIME_INTERVALS.map((i) => <td key={i} className="px-4 py-2 text-fg-secondary">{data.caps[t.key]?.[i] ?? '-'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </InfoCard>
  );
}

interface HistoryRow { id: string; operationTime: string; service: string; changes: string; employee: string | null; method: string; portal: string; userIp: string | null }

function HistoryTab({ id }: { id: string }) {
  const { data, loading, error } = useQuery<HistoryRow[]>(`/api/offer-groups/${id}/history`);
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

function OffersTab({ data, offers, advertisers }: { data: OfferGroup; offers: Offer[]; advertisers: Advertiser[] }) {
  const [q, setQ] = useState('');
  const members = offers.filter((o) => data.offerIds.includes(o.id) && (!q.trim() || o.name.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <div className="card !p-0">
      <div className="flex justify-end border-b border-border p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="input !w-56" />
      </div>
      {members.length === 0 ? (
        <p className="p-4 text-small text-fg-muted">No offers in this group.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-small">
            <thead className="border-b border-border bg-page text-tiny font-semibold uppercase text-fg-secondary">
              <tr><th className="px-4 py-2">ID</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Visibility</th><th className="px-4 py-2">Advertiser</th><th className="px-4 py-2">Category</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-2 tabular-nums text-fg-secondary">{o.ref ?? '—'}</td>
                  <td className="px-4 py-2"><Link to={`/app/offers/${o.id}`} className="flex items-center gap-1.5 font-medium text-accent-text hover:underline"><span className={`h-2 w-2 rounded-full ${o.status === 'active' ? 'bg-success' : 'bg-fg-muted'}`} />{o.name}</Link></td>
                  <td className="px-4 py-2 text-fg-secondary capitalize">{o.visibility ?? '—'}</td>
                  <td className="px-4 py-2 text-accent-text">{advertisers.find((a) => a.id === o.advertiserId)?.name ?? '—'}</td>
                  <td className="px-4 py-2 text-fg-secondary">{o.category ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function OfferGroupDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { data, loading, error } = useQuery<OfferGroup>(`/api/offer-groups/${id}`);
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const [tab, setTab] = useState('General');

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error || !data) return <StateBlock>{error ?? 'Offer group not found'}</StateBlock>;

  const advertiser = advertisers?.find((a) => a.id === data.advertiserId);

  return (
    <>
      <PageHeader title={`Offer Group Details: ${data.name}`} subtitle={`Offers › Groups › ${data.name} › Details`} />
      <Tabs tabs={['General', 'Offers', 'History']} active={tab} onChange={setTab} />

      {tab === 'History' ? <HistoryTab id={id} />
        : tab === 'Offers' ? <OffersTab data={data} offers={offers ?? []} advertisers={advertisers ?? []} />
        : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <InfoCard title="General" action={<button className="flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={() => nav(`/app/offers-groups/${id}/edit`)}><Pencil size={12} />Edit</button>}>
              <InfoGrid>
                <InfoRow label="ID" value={data.ref} />
                <InfoRow label="Status" value={data.status === 'active' ? 'Active' : data.status === 'paused' ? 'Paused' : 'Deleted'} />
                <InfoRow label="Name" value={data.name} />
                <InfoRow label="Modified" value={<DateTimeValue iso={data.updatedAt} />} />
                <InfoRow label="Advertiser" value={advertiser ? <Link to={`/app/advertisers/${advertiser.id}`} className="text-accent-text hover:underline">{advertiser.name}</Link> : undefined} />
                <InfoRow label="Created" value={<DateTimeValue iso={data.createdAt} />} />
                <InfoRow label="Labels" value={data.labels} />
              </InfoGrid>
            </InfoCard>
            <StatsCard id={id} />
            <CapsCard data={data} id={id} nav={nav} />
          </div>
        )}
    </>
  );
}
