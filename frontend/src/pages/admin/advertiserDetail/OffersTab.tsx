import { Link } from 'react-router-dom';
import { Image as ImageIcon } from 'lucide-react';
import { useQuery } from '../../../lib/useApi';
import { Table, Spinner, StateBlock, type Column } from '../../../components/ui';
import type { Offer } from '../../../types';

/** Real data — offers that belong to this advertiser. */
export function OffersTab({ advertiserId }: { advertiserId: string }) {
  const { data: offers, loading, error } = useQuery<Offer[]>('/api/offers');
  const rows = (offers ?? []).filter((o) => o.advertiserId === advertiserId);

  const columns: Column<Offer>[] = [
    { header: 'Thumbnail', cell: () => <div className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-page text-fg-muted"><ImageIcon size={15} /></div> },
    { header: 'Name', cell: (o) => <Link to={`/app/offers/${o.id}`} className="font-medium text-accent-text hover:underline">{o.name}</Link> },
    { header: 'Visibility', cell: (o) => <span className="capitalize text-fg-secondary">{o.visibility ?? 'public'}</span> },
    { header: 'Category', cell: (o) => o.category ?? '—' },
    { header: 'Revenue', className: 'text-right', cell: (o) => `${o.currency} ${o.defaultRevenue}` },
    { header: 'Payout', className: 'text-right', cell: (o) => `${o.currency} ${o.defaultPayout}` },
    { header: 'Created', cell: (o) => new Date(o.createdAt).toLocaleDateString() },
  ];

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error) return <StateBlock>{error}</StateBlock>;
  if (rows.length === 0) return <StateBlock>No offers yet.</StateBlock>;
  return <Table columns={columns} rows={rows} rowKey={(o) => o.id} />;
}
