/**
 * Super Admin › Sales › Quotes — every quote (newest first), by status: drafts, sent and waiting, accepted,
 * declined, expired. Open one to send it, copy the prospect's link or mark the answer; new quotes start on
 * a lead (QuoteParts.tsx).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { money } from '../../../lib/platformBilling';
import { relTime } from '../../../lib/relativeTime';
import { intervalSuffix, type Quote } from '../../../lib/platformSales';
import { PageHeader, Table, Spinner, StateBlock, type Column } from '../../../shared-components/primitives/ui';
import { QuoteChip, QuoteModal } from './QuoteParts';

const FILTERS = [
  { value: '', label: 'All' }, { value: 'draft', label: 'Drafts' }, { value: 'sent', label: 'Waiting' },
  { value: 'accepted', label: 'Accepted' }, { value: 'declined', label: 'Declined' }, { value: 'expired', label: 'Expired' },
];

export default function Quotes() {
  const { can } = usePlatformMe();
  const [status, setStatus] = useState('');
  const quotes = useQuery<Quote[]>('/platform/sales/quotes', { status: status || undefined });
  const [open, setOpen] = useState<string | null>(null);
  const columns: Column<Quote>[] = [
    { header: 'Quote', cell: (q) => <button className="text-left font-medium text-accent-text hover:underline" onClick={() => setOpen(q.id)}>Q-{q.number}<span className="block text-tiny font-normal text-fg-secondary">{q.title}</span></button> },
    { header: 'Lead', cell: (q) => <Link to={`/admin/sales/leads/${q.lead_id}`} className="hover:underline">{q.company}</Link> },
    { header: 'Total', cell: (q) => <span className="whitespace-nowrap">{money(q.total, q.currency)} <span className="text-tiny text-fg-muted">{intervalSuffix(q.billing_interval)}</span></span> },
    { header: 'Status', cell: (q) => <QuoteChip status={q.status} /> },
    { header: 'Activity', cell: (q) => <span className="text-fg-secondary">{q.responded_at ? `Answered ${relTime(q.responded_at)}` : q.viewed_at ? `Opened ${relTime(q.viewed_at)}` : q.sent_at ? `Sent ${relTime(q.sent_at)}` : `Created ${relTime(q.created_at)}`}</span> },
    { header: 'Valid until', cell: (q) => <span className="text-fg-secondary">{q.valid_until}</span> },
    { header: 'Owner', cell: (q) => <span className="text-fg-secondary">{q.owner_name ?? '—'}</span> },
  ];
  return (
    <>
      <PageHeader title="Quotes" subtitle="Priced proposals sent to leads — and what they said. Start a new one from a lead." />
      <div className="mb-4">
        <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>
      {quotes.loading && !quotes.data ? <StateBlock><Spinner /></StateBlock>
        : quotes.error ? <StateBlock>{quotes.error}</StateBlock>
        : (quotes.data ?? []).length === 0 ? <StateBlock>{status ? 'No quote has this status.' : 'No quotes yet — open a lead and choose “New quote”.'}</StateBlock>
        : <Table columns={columns} rows={quotes.data ?? []} rowKey={(q) => q.id} />}
      {open && <QuoteModal key={open} id={open} canEdit={can('sales', 'full')} onClose={() => setOpen(null)} onChanged={(next) => { quotes.refetch(); if (next) setOpen(next); }} />}
    </>
  );
}
