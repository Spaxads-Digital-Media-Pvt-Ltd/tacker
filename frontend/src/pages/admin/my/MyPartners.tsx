/**
 * My partners (/app/my/partners[/:id]) — the partners assigned to me (their partner manager): their clicks,
 * conversions, payout, revenue and margin for a date range (this month by default), the requests they made
 * for gated offers (approve / reject), and one partner's offers and latest conversions. An Affiliate
 * Manager's whole dashboard; every team member has it for the partners they manage.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../../lib/api';
import { useQuery } from '../../../lib/useApi';
import { Badge, PageHeader, Spinner, StatCard, StateBlock, Table } from '../../../shared-components/primitives/ui';
import { LatestConversions, RangePicker } from './parts';
import { count, perCurrency, type LatestConversion, type Range, type Stats } from '../../../lib/myPanels';

interface Partner { id: string; ref: string; name: string; status: string; contact_email: string | null; country: string | null; created_at: string; stats: Stats | null }
interface Application { id: string; status: string; publisherId: string; publisherName: string; offerId: string; offerName: string; requestDate: string }
interface ReportRow { dimensions: Record<string, string | null>; metrics: Stats; labels?: Record<string, { name: string } | null> }

function Applications({ rows, onDone }: { rows: Application[]; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (a: Application, status: 'approved' | 'rejected') => {
    setError(null); setBusy(a.id);
    try { await api.post(`/api/my/offer-applications/${a.id}`, { status }); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(null); }
  };
  if (!rows.length) return <p className="text-small text-fg-muted">No requests waiting.</p>;
  return (
    <div className="space-y-2">
      {error && <p className="text-small text-danger-text">{error}</p>}
      <Table rowKey={(a) => a.id} rows={rows} columns={[
        { header: 'Partner', cell: (a) => <Link className="text-accent-text hover:underline" to={`/app/my/partners/${a.publisherId}`}>{a.publisherName}</Link> },
        { header: 'Offer', cell: (a) => a.offerName },
        { header: 'Asked', cell: (a) => new Date(a.requestDate).toLocaleDateString() },
        {
          header: '', className: 'text-right', cell: (a) => (
            <span className="flex justify-end gap-3">
              <button className="text-tiny font-medium text-success-text hover:underline" disabled={busy === a.id} onClick={() => void decide(a, 'approved')}>Approve</button>
              <button className="text-tiny font-medium text-danger-text hover:underline" disabled={busy === a.id} onClick={() => void decide(a, 'rejected')}>Reject</button>
            </span>
          ),
        },
      ]} />
    </div>
  );
}

function PartnerList() {
  const [range, setRange] = useState({ from: '', to: '' });
  const q = useQuery<{ range: Range; partners: Partner[] }>('/api/my/partners', range.from ? range : {});
  const apps = useQuery<Application[]>('/api/my/offer-applications');
  const shown = q.data?.range ?? null;
  const totals = (q.data?.partners ?? []).reduce((t, p) => ({ clicks: t.clicks + (p.stats?.clicks ?? 0), conversions: t.conversions + (p.stats?.conversions ?? 0) }), { clicks: 0, conversions: 0 });
  return (
    <>
      <PageHeader title="My partners" subtitle="The partners you manage — their traffic, earnings and requests." action={shown ? <RangePicker value={range.from ? range : shown} onChange={setRange} /> : undefined} />
      {q.loading && !q.data ? <StateBlock><Spinner /></StateBlock> : q.error ? <StateBlock>{q.error}</StateBlock> : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Partners" value={count(q.data?.partners.length)} hint="Assigned to you as their partner manager" />
            <StatCard label="Clicks" value={count(totals.clicks)} hint={shown ? `${shown.from} – ${shown.to}` : undefined} />
            <StatCard label="Conversions" value={count(totals.conversions)} hint={shown ? `${shown.from} – ${shown.to}` : undefined} />
          </div>
          <section className="space-y-2">
            <h2 className="text-h3 font-medium text-fg">Requests for gated offers{apps.data?.length ? ` (${apps.data.length})` : ''}</h2>
            <Applications rows={apps.data ?? []} onDone={() => { apps.refetch(); q.refetch(); }} />
          </section>
          <section className="space-y-2">
            <h2 className="text-h3 font-medium text-fg">Partners</h2>
            {!q.data?.partners.length ? <StateBlock>No partners are assigned to you yet — an admin sets the partner manager on a partner’s page.</StateBlock> : (
              <Table rowKey={(p) => p.id} rows={q.data.partners} columns={[
                { header: 'Partner', cell: (p) => <Link className="font-medium text-accent-text hover:underline" to={`/app/my/partners/${p.id}`}>{p.name}</Link> },
                { header: 'Status', cell: (p) => <Badge value={p.status} /> },
                { header: 'Clicks', cell: (p) => count(p.stats?.clicks) },
                { header: 'Conversions', cell: (p) => count(p.stats?.conversions) },
                { header: 'Payout', cell: (p) => perCurrency(p.stats, 'payout') },
                { header: 'Revenue', cell: (p) => perCurrency(p.stats, 'revenue') },
                { header: 'Margin', cell: (p) => perCurrency(p.stats, 'margin') },
                { header: 'Email', cell: (p) => <span className="text-fg-secondary">{p.contact_email ?? '—'}</span> },
              ]} />
            )}
          </section>
        </div>
      )}
    </>
  );
}

function PartnerDetail({ id }: { id: string }) {
  const [range, setRange] = useState({ from: '', to: '' });
  const q = useQuery<{ range: Range; partner: Partner & { contact_name: string | null; website: string | null }; totals: Stats | null; offers: ReportRow[]; latestConversions: LatestConversion[]; applications: Application[] }>(
    `/api/my/partners/${id}`, range.from ? range : {});
  if (q.loading && !q.data) return <StateBlock><Spinner /></StateBlock>;
  if (q.error || !q.data) return <StateBlock>{q.error ?? 'Partner not found'}</StateBlock>;
  const { partner: p, totals, offers, latestConversions, applications, range: shown } = q.data;
  return (
    <>
      <PageHeader title={p.name} subtitle={[p.contact_name, p.contact_email, p.country].filter(Boolean).join(' · ') || 'Partner'}
        action={<RangePicker value={range.from ? range : shown} onChange={setRange} />} />
      <div className="space-y-6">
        <Link to="/app/my/partners" className="text-small text-accent-text hover:underline">← My partners</Link>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatCard label="Clicks" value={count(totals?.clicks)} />
          <StatCard label="Conversions" value={count(totals?.conversions)} />
          <StatCard label="Payout" value={perCurrency(totals, 'payout')} />
          <StatCard label="Revenue" value={perCurrency(totals, 'revenue')} />
          <StatCard label="Margin" value={perCurrency(totals, 'margin')} />
        </div>
        {applications.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-h3 font-medium text-fg">Waiting for an answer</h2>
            <Applications rows={applications} onDone={q.refetch} />
          </section>
        )}
        <section className="space-y-2">
          <h2 className="text-h3 font-medium text-fg">Offers they ran ({shown.from} – {shown.to})</h2>
          {!offers.length ? <p className="text-small text-fg-muted">No traffic in this range.</p> : (
            <Table rowKey={(r) => r.dimensions['offer'] ?? ''} rows={offers} columns={[
              { header: 'Offer', cell: (r) => r.labels?.['offer']?.name ?? r.dimensions['offer'] },
              { header: 'Clicks', cell: (r) => count(r.metrics.clicks) },
              { header: 'Conversions', cell: (r) => count(r.metrics.conversions) },
              { header: 'Payout', cell: (r) => perCurrency(r.metrics, 'payout') },
              { header: 'Revenue', cell: (r) => perCurrency(r.metrics, 'revenue') },
            ]} />
          )}
        </section>
        <section className="space-y-2">
          <h2 className="text-h3 font-medium text-fg">Latest conversions</h2>
          <LatestConversions rows={latestConversions} />
        </section>
      </div>
    </>
  );
}

export default function MyPartners() {
  const { id } = useParams<{ id?: string }>();
  return id ? <PartnerDetail key={id} id={id} /> : <PartnerList />;
}
