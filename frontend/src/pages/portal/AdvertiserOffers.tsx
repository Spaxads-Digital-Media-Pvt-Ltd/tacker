import { useQuery } from '../../lib/useApi';
import { PageHeader, Table, Badge, Spinner, StateBlock, type Column } from '../../components/ui';

/** Advertiser portal offer DTO — revenue (their cost). Publisher payout is never exposed here. */
interface AdvertiserOffer {
  id: string;
  name: string;
  status: string;
  destinationUrl: string;
  payoutModel: string;
  revenue: string;
  currency: string;
  createdAt: string;
}

const columns: Column<AdvertiserOffer>[] = [
  { header: 'Offer', cell: (o) => <span className="font-medium">{o.name}</span> },
  { header: 'Status', cell: (o) => <Badge value={o.status} /> },
  { header: 'Model', cell: (o) => o.payoutModel },
  { header: 'Revenue', cell: (o) => `${o.currency} ${o.revenue}` },
  { header: 'Destination', cell: (o) => <span className="font-mono text-tiny text-fg-secondary">{o.destinationUrl.slice(0, 40)}…</span> },
];

export default function AdvertiserOffers() {
  const { data, loading, error } = useQuery<AdvertiserOffer[]>('/api/portal/offers');
  return (
    <>
      <PageHeader title="My offers" subtitle="Your offers and their destination URLs." />
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>You have no offers yet.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(o) => o.id} />}
    </>
  );
}
