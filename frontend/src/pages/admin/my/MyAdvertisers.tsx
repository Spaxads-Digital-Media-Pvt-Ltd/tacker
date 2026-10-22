/**
 * My advertisers (/app/my/advertisers[/:id]) — the advertisers assigned to me (account or sales manager):
 * their offers, clicks, conversions and revenue for a date range (this month by default) and one
 * advertiser's offers with their numbers and latest conversions. An Advertiser Manager's whole dashboard;
 * every team member has it for the advertisers they manage.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '../../../lib/useApi';
import { Badge, PageHeader, Spinner, StatCard, StateBlock, Table } from '../../../shared-components/primitives/ui';
import { LatestConversions, RangePicker } from './parts';
import { count, perCurrency, type LatestConversion, type Range, type Stats } from '../../../lib/myPanels';

interface Advertiser { id: string; ref: string; name: string; status: string; contact_email: string | null; default_currency: string | null; offers: number; created_at: string; stats: Stats | null }
interface Offer { id: string; ref: string; name: string; status: string; payout_model: string; currency: string | null; stats: Stats | null }

function AdvertiserList() {
  const [range, setRange] = useState({ from: '', to: '' });
  const q = useQuery<{ range: Range; advertisers: Advertiser[] }>('/api/my/advertisers', range.from ? range : {});
  const shown = q.data?.range ?? null;
  const list = q.data?.advertisers ?? [];
  return (
    <>
      <PageHeader title="My advertisers" subtitle="The advertisers you manage — their offers, traffic and revenue." action={shown ? <RangePicker value={range.from ? range : shown} onChange={setRange} /> : undefined} />
      {q.loading && !q.data ? <StateBlock><Spinner /></StateBlock> : q.error ? <StateBlock>{q.error}</StateBlock> : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Advertisers" value={count(list.length)} hint="You’re their account or sales manager" />
            <StatCard label="Live offers" value={count(list.reduce((n, a) => n + a.offers, 0))} />
            <StatCard label="Conversions" value={count(list.reduce((n, a) => n + (a.stats?.conversions ?? 0), 0))} hint={shown ? `${shown.from} – ${shown.to}` : undefined} />
          </div>
          {!list.length ? <StateBlock>No advertisers are assigned to you yet — an admin sets the account manager on an advertiser’s page.</StateBlock> : (
            <Table rowKey={(a) => a.id} rows={list} columns={[
              { header: 'Advertiser', cell: (a) => <Link className="font-medium text-accent-text hover:underline" to={`/app/my/advertisers/${a.id}`}>{a.name}</Link> },
              { header: 'Status', cell: (a) => <Badge value={a.status} /> },
              { header: 'Offers', cell: (a) => count(a.offers) },
              { header: 'Clicks', cell: (a) => count(a.stats?.clicks) },
              { header: 'Conversions', cell: (a) => count(a.stats?.conversions) },
              { header: 'Revenue', cell: (a) => perCurrency(a.stats, 'revenue') },
              { header: 'Margin', cell: (a) => perCurrency(a.stats, 'margin') },
              { header: 'Email', cell: (a) => <span className="text-fg-secondary">{a.contact_email ?? '—'}</span> },
            ]} />
          )}
        </div>
      )}
    </>
  );
}

function AdvertiserDetail({ id }: { id: string }) {
  const [range, setRange] = useState({ from: '', to: '' });
  const q = useQuery<{ range: Range; advertiser: Advertiser; totals: Stats | null; offers: Offer[]; latestConversions: LatestConversion[] }>(`/api/my/advertisers/${id}`, range.from ? range : {});
  if (q.loading && !q.data) return <StateBlock><Spinner /></StateBlock>;
  if (q.error || !q.data) return <StateBlock>{q.error ?? 'Advertiser not found'}</StateBlock>;
  const { advertiser: a, totals, offers, latestConversions, range: shown } = q.data;
  return (
    <>
      <PageHeader title={a.name} subtitle={[a.contact_email, a.default_currency].filter(Boolean).join(' · ') || 'Advertiser'}
        action={<RangePicker value={range.from ? range : shown} onChange={setRange} />} />
      <div className="space-y-6">
        <Link to="/app/my/advertisers" className="text-small text-accent-text hover:underline">← My advertisers</Link>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Clicks" value={count(totals?.clicks)} />
          <StatCard label="Conversions" value={count(totals?.conversions)} />
          <StatCard label="Revenue" value={perCurrency(totals, 'revenue')} />
          <StatCard label="Margin" value={perCurrency(totals, 'margin')} />
        </div>
        <section className="space-y-2">
          <h2 className="text-h3 font-medium text-fg">Offers ({shown.from} – {shown.to})</h2>
          {!offers.length ? <p className="text-small text-fg-muted">No offers yet.</p> : (
            <Table rowKey={(o) => o.id} rows={offers} columns={[
              { header: 'Offer', cell: (o) => o.name },
              { header: 'Status', cell: (o) => <Badge value={o.status} /> },
              { header: 'Model', cell: (o) => <span className="uppercase">{o.payout_model}</span> },
              { header: 'Clicks', cell: (o) => count(o.stats?.clicks) },
              { header: 'Conversions', cell: (o) => count(o.stats?.conversions) },
              { header: 'Revenue', cell: (o) => perCurrency(o.stats, 'revenue') },
              { header: 'Payout', cell: (o) => perCurrency(o.stats, 'payout') },
            ]} />
          )}
        </section>
        <section className="space-y-2">
          <h2 className="text-h3 font-medium text-fg">Latest conversions</h2>
          <LatestConversions rows={latestConversions} showPartner />
        </section>
      </div>
    </>
  );
}

export default function MyAdvertisers() {
  const { id } = useParams<{ id?: string }>();
  return id ? <AdvertiserDetail key={id} id={id} /> : <AdvertiserList />;
}
