/**
 * Network-wide catalog lists (top-level section pages): Deals — aggregates across offers via
 * /api/catalog/*. Prop-driven, kept single-kind since Creatives moved to its own first-class Manage
 * page (pages/admin/Creatives.tsx), matching the reference. (Postbacks, Offer Applications and
 * Coupon Codes similarly moved to their own first-class Manage pages, not simple aggregation lists.)
 */
import { Link } from 'react-router-dom';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Table, Badge, Spinner, StateBlock, type Column } from '../../components/ui';

type Row = Record<string, unknown>;
type Kind = 'deals';

const off = (r: Row) => <Link to={`/app/offers/${r['offer_id']}`} className="text-brand-600 hover:underline ">{String(r['offer_name'] ?? '—')}</Link>;
const badge = (r: Row, k: string) => <Badge value={String(r[k] ?? '')} />;

const CONFIG: Record<Kind, { title: string; subtitle: string; columns: Column<Row>[] }> = {
  deals: {
    title: 'Deals', subtitle: 'Payout boosts and promotions across your offers.',
    columns: [
      { header: 'Deal', cell: (r) => <span className="font-medium">{String(r['name'])}</span> },
      { header: 'Type', cell: (r) => String(r['deal_type']) },
      { header: 'Value', cell: (r) => String(r['value'] ?? '—') },
      { header: 'Offer', cell: off },
      { header: 'Status', cell: (r) => badge(r, 'status') },
    ],
  },
};

export function NetworkListPage({ kind }: { kind: Kind }) {
  const cfg = CONFIG[kind];
  const { data, loading, error } = useQuery<Row[]>(`/api/catalog/${kind}`);
  return (
    <>
      <PageHeader title={cfg.title} subtitle={cfg.subtitle} />
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>Nothing here yet.</StateBlock>
        : <Table columns={cfg.columns} rows={data} rowKey={(r) => String(r['id'])} />}
    </>
  );
}
