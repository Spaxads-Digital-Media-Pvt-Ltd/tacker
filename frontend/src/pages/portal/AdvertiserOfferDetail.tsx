import { useParams, Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock, StatCard } from '../../components/ui';
import type { AdvertiserOffer } from '../../types';

export default function AdvertiserOfferDetail() {
 const { id } = useParams<{ id: string }>();
 const path = id ? `/api/portal/offers/${id}` : null;
 const { data, loading, error } = useQuery<AdvertiserOffer>(path);

 if (!id) return <StateBlock>Invalid offer id.</StateBlock>;
 if (loading) return <StateBlock><Spinner /></StateBlock>;
 if (error) return <StateBlock>{error}</StateBlock>;
 if (!data) return <StateBlock>Offer not found.</StateBlock>;

 const offer = data;

 return (
 <>
 <PageHeader title={offer.name} subtitle={`Offer ${offer.id.slice(0, 8)}…`} action={
 <Link to="/advertiser/offers" className="btn-ghost inline-flex items-center gap-1.5"><ChevronLeft size={14} /> Back</Link>
 } />

 <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
 <StatCard label="Revenue" value={`${offer.currency} ${offer.revenue}`} hint={offer.payoutModel} />
 <StatCard label="Visibility" value={offer.visibility} hint={offer.category ?? 'Uncategorized'} />
 <StatCard label="Status" value={offer.status} />
 </div>

 <div className="card">
 <h3 className="mb-3 text-body font-semibold text-fg">Offer details</h3>
 <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
 <div><dt className="text-tiny text-fg-muted">Objective</dt><dd className="text-small capitalize">{offer.objective ?? '—'}</dd></div>
 <div><dt className="text-tiny text-fg-muted">Payout model</dt><dd className="text-small">{offer.payoutModel}</dd></div>
 <div><dt className="text-tiny text-fg-muted">Destination URL</dt><dd className="text-small truncate max-w-[300px]"><a href={offer.destinationUrl} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">{offer.destinationUrl}</a></dd></div>
 <div><dt className="text-tiny text-fg-muted">Fallback URL</dt><dd className="text-small">{offer.fallbackUrl ? <a href={offer.fallbackUrl} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">{offer.fallbackUrl}</a> : '—'}</dd></div>
 <div><dt className="text-tiny text-fg-muted">Attribution window</dt><dd className="text-small">{offer.attributionWindowS ? `${offer.attributionWindowS}s` : '—'}</dd></div>
 <div><dt className="text-tiny text-fg-muted">Dedup window</dt><dd className="text-small">{offer.dedupWindowS ? `${offer.dedupWindowS}s` : '—'}</dd></div>
 <div><dt className="text-tiny text-fg-muted">Daily click cap</dt><dd className="text-small">{offer.dailyClickCap ?? 'None'}</dd></div>
 <div><dt className="text-tiny text-fg-muted">Daily conversion cap</dt><dd className="text-small">{offer.dailyConversionCap ?? 'None'}</dd></div>
 <div><dt className="text-tiny text-fg-muted">Total conversion cap</dt><dd className="text-small">{offer.totalConversionCap ?? 'None'}</dd></div>
 <div><dt className="text-tiny text-fg-muted">Category</dt><dd className="text-small">{offer.category ?? '—'}</dd></div>
 <div><dt className="text-tiny text-fg-muted">Preview URL</dt><dd className="text-small">{offer.previewUrl ? <a href={offer.previewUrl} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">{offer.previewUrl}</a> : '—'}</dd></div>
 <div className="sm:col-span-2"><dt className="text-tiny text-fg-muted">Allowed traffic types</dt><dd className="text-small">{offer.allowedTrafficTypes.length > 0 ? offer.allowedTrafficTypes.join(', ') : 'All types'}</dd></div>
 <div className="sm:col-span-2"><dt className="text-tiny text-fg-muted">Tracking URL</dt><dd className="text-small">{offer.trackingUrl ? <a href={offer.trackingUrl} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">{offer.trackingUrl}</a> : '—'}</dd></div>
 <div className="sm:col-span-2"><dt className="text-tiny text-fg-muted">Created</dt><dd className="text-small">{new Date(offer.createdAt).toLocaleString()}</dd></div>
 <div className="sm:col-span-2"><dt className="text-tiny text-fg-muted">Updated</dt><dd className="text-small">{new Date(offer.updatedAt).toLocaleString()}</dd></div>
 </dl>
 </div>
 </>
 );
}
