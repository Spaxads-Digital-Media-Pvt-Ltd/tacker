import { useState } from 'react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Table, StatusDot, Spinner, StateBlock, type Column } from '../../components/ui';

/** Publisher portal offer DTO — payout only. Revenue/margin never reach a publisher (spec §3A). */
interface PublisherOffer {
  id: string;
  name: string;
  status: string;
  payoutModel: string;
  payout: string;
  currency: string;
  trackingUrl: string | null;
}

function CopyLink({ url }: { url: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!url) return <span className="text-fg-muted">—</span>;
  return (
    <button
      className="inline-flex max-w-[280px] items-center gap-2"
      onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      title={url}
    >
      <span className="truncate font-mono tabular-nums text-tiny text-fg-muted">{url.replace(/^https?:\/\//, '')}</span>
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-tiny font-medium ${copied ? 'bg-success-bg text-success-text' : 'bg-brand-100 text-brand-700'}`}>
        {copied ? 'Copied' : 'Copy'}
      </span>
    </button>
  );
}

const columns: Column<PublisherOffer>[] = [
  { header: 'Offer', cell: (o) => <span className="font-medium text-fg">{o.name}</span> },
  { header: 'Status', cell: (o) => <StatusDot value={o.status} /> },
  { header: 'Model', cell: (o) => <span className="text-fg-secondary">{o.payoutModel}</span> },
  { header: 'Your payout', cell: (o) => <span className="font-semibold tabular-nums text-success-text">{o.currency} {o.payout}</span> },
  { header: 'Tracking link', cell: (o) => <CopyLink url={o.trackingUrl} /> },
];

export default function PublisherOffers() {
  const { data, loading, error } = useQuery<PublisherOffer[]>('/api/portal/offers');
  return (
    <>
      <PageHeader title="Offers" subtitle="Offers available to you, with your effective payout and ready-to-use tracking link." />
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No offers assigned to you yet.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(o) => o.id} />}
    </>
  );
}
