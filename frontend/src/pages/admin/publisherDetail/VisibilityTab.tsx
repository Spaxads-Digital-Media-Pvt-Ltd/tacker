import { Link } from 'react-router-dom';
import { Image as ImageIcon } from 'lucide-react';
import { useQuery } from '../../../lib/useApi';
import { Table, Spinner, StateBlock, type Column } from '../../../components/ui';
import type { Offer, Advertiser } from '../../../types';

/** No bulk "offers visible to publisher X" endpoint exists — this shows all offers with an
 * honest "Can Run Offer?" derived from the offer's own visibility (public = yes; private/ask =
 * unknown, since checking real per-publisher access would mean an N+1 fetch per offer). */
export function VisibilityTab() {
  const { data: offers, loading, error } = useQuery<Offer[]>('/api/offers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const advName = (id: string) => {
    const a = advertisers?.find((x) => x.id === id);
    return a ? (a.ref != null ? `(${a.ref}) ${a.name}` : a.name) : id.slice(0, 8) + '…';
  };

  const columns: Column<Offer>[] = [
    { header: 'Thumbnail', cell: () => <div className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-page text-fg-muted"><ImageIcon size={15} /></div> },
    { header: 'Name', cell: (o) => <Link to={`/app/offers/${o.id}`} className="font-medium text-accent-text hover:underline">{o.name}</Link> },
    { header: 'Visibility', cell: (o) => <span className="capitalize text-fg-secondary">{o.visibility ?? 'public'}</span> },
    { header: 'Can Run Offer?', cell: (o) => (o.visibility ?? 'public') === 'public' ? <span className="text-success-text">YES</span> : <span className="text-fg-muted">—</span> },
    { header: 'Advertiser', cell: (o) => <span className="text-accent-text">{advName(o.advertiserId)}</span> },
    { header: 'Category', cell: (o) => o.category ?? '—' },
    { header: 'Countries', cell: () => 'All' },
    { header: 'Revenue', className: 'text-right', cell: (o) => `${o.currency} ${o.defaultRevenue}` },
    { header: 'Payout', className: 'text-right', cell: (o) => `${o.currency} ${o.defaultPayout}` },
  ];

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error) return <StateBlock>{error}</StateBlock>;
  if (!offers || offers.length === 0) return <StateBlock>No offers yet.</StateBlock>;
  return <Table columns={columns} rows={offers} rowKey={(o) => o.id} />;
}
