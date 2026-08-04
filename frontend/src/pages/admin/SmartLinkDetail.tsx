import { Link, useParams } from 'react-router-dom';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Badge, Spinner, StateBlock, type Column } from '../../components/ui';
import { CollectionTab } from '../../components/CollectionTab';
import type { Offer } from '../../types';

interface SmartLink { id: string; name: string; rotation: string; status: string; fallbackUrl: string | null }
type Row = { id: string; [k: string]: unknown };

export default function SmartLinkDetail() {
  const { id = '' } = useParams();
  const base = `/api/smart-links/${id}`;
  const { data: link, loading, error } = useQuery<SmartLink>(base);
  const { data: offers } = useQuery<Offer[]>('/api/offers');

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error || !link) return <StateBlock>{error ?? 'Smart link not found'}</StateBlock>;

  const offerOptions = (offers ?? []).map((o) => ({ value: o.id, label: o.name }));
  const offerName = (oid: unknown) => offers?.find((o) => o.id === oid)?.name ?? String(oid ?? '—');

  return (
    <>
      <PageHeader title={link.name} subtitle={`Smart link · ${link.rotation}`}
        action={<Link to="/app/smart-links" className="btn-ghost">← All smart links</Link>} />

      <div className="card mb-6 max-w-2xl">
        <p className="label">Smart link URL (append &pub_id=…)</p>
        <p className="mt-1 break-all font-mono text-sm">/sl?id={link.id}</p>
        <div className="mt-2 flex items-center gap-2 text-sm"><span className="text-fg-secondary">Status</span> <Badge value={link.status} /></div>
        {link.fallbackUrl && <p className="mt-2 text-sm text-fg-secondary">Fallback: <span className="font-mono text-xs text-fg-muted">{link.fallbackUrl}</span></p>}
      </div>

      <h2 className="mb-3 eyebrow">Rotation offers</h2>
      <CollectionTab
        basePath={`${base}/items`}
        addLabel="Add offer"
        emptyText="No offers in this rotation yet. Add offers with weights (and optional geo)."
        fields={[
          { key: 'offerId', label: 'Offer', type: 'select', options: offerOptions, required: true },
          { key: 'weight', label: 'Weight', type: 'number', default: '1' },
          { key: 'country', label: 'Country target (optional, ISO-2)', placeholder: 'US' },
        ]}
        columns={[
          { header: 'Offer', cell: (r) => <span className="font-medium">{offerName(r.offerId)}</span> },
          { header: 'Weight', className: 'text-right', cell: (r) => String(r.weight) },
          { header: 'Geo', cell: (r) => String(r.country ?? 'any') },
        ] as Column<Row>[]}
      />
    </>
  );
}
