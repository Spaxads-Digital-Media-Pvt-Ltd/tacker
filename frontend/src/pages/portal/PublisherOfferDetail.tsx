import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronLeft, Check } from 'lucide-react';
import { useQuery, useMutation } from '../../lib/useApi';
import { api } from '../../lib/api';
import { PageHeader, Spinner, StateBlock, StatCard } from '../../components/ui';
import type { PublisherOffer } from '../../types';

function CopyButton({ url, label = 'Copy link' }: { url: string | null; label?: string }) {
 const [copied, setCopied] = useState(false);
 if (!url) return <span className="text-fg-muted">—</span>;
 return (
 <button type="button" className="inline-flex items-center gap-2" onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }} title={url}>
 <span className="truncate font-mono text-tiny text-fg-secondary max-w-[400px] inline-block">{url.replace(/^https?:\/\//, '')}</span>
 <span className={`shrink-0 rounded px-1.5 py-0.5 text-tiny font-medium ${copied ? 'bg-success-bg text-success-text' : 'bg-accent-subtle text-accent-text'}`}>
 {copied ? <span className="inline-flex items-center gap-1"><Check size={10} /> Copied</span> : label}
 </span>
 </button>
 );
}

export default function PublisherOfferDetail() {
 const { id } = useParams<{ id: string }>();
 const path = id ? `/api/portal/offers/${id}` : null;
 const { data, loading, error, refetch } = useQuery<PublisherOffer>(path);

 const requestMut = useMutation( async (offerId: string) => {
 await api.post(`/api/portal/offers/${offerId}/request`, { access: 'allow' });
 });
 const withdrawMut = useMutation( async (offerId: string) => {
 await api.del(`/api/portal/offers/${offerId}/request`);
 });

 const handleRequest = async () => { if (id) { await requestMut.run(id); refetch(); } };
 const handleWithdraw = async () => { if (id) { await withdrawMut.run(id); refetch(); } };

 if (!id) return <StateBlock>Invalid offer id.</StateBlock>;
 if (loading) return <StateBlock><Spinner /></StateBlock>;
 if (error) return <StateBlock>{error}</StateBlock>;
 if (!data) return <StateBlock>Offer not found.</StateBlock>;

 const offer = data;
 const isPending = offer.approvalStatus === 'pending';
 const isApproved = offer.approvalStatus === 'approved';
 const isRejected = offer.approvalStatus === 'rejected';
 const canRequest = !offer.access && !offer.approvalStatus && offer.visibility === 'ask';

 return (
 <>
 <PageHeader title={offer.name} subtitle={`Offer ${offer.id.slice(0, 8)}…`} action={
 <Link to="/publisher/offers" className="btn-ghost inline-flex items-center gap-1.5"><ChevronLeft size={14} /> Back</Link>
 } />

 <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
 <StatCard label="Your payout" value={`${offer.currency} ${offer.payout}`} hint={offer.payoutModel} />
 <StatCard label="Visibility" value={offer.visibility} hint={offer.category ?? 'Uncategorized'} />
 <StatCard label="Status" value={offer.status} />
 </div>

 <div className="card mb-4">
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
 <div className="sm:col-span-2"><dt className="text-tiny text-fg-muted">Description</dt><dd className="text-small whitespace-pre-wrap">{offer.description ?? 'No description.'}</dd></div>
 </dl>
 </div>

 <div className="card mb-4">
 <h3 className="mb-3 text-body font-semibold text-fg">Tracking link</h3>
 <CopyButton url={offer.trackingUrl} label="Copy tracking link" />
 {offer.trackingUrl && <p className="mt-2 text-tiny text-fg-secondary">Use this URL for all traffic to this offer. Publisher ID is pre-attached.</p>}
 </div>

 <div className="card">
 <h3 className="mb-3 text-body font-semibold text-fg">Access status</h3>
 <div className="flex flex-wrap items-center gap-3">
 <span className="text-small">Visibility: <span className="capitalize">{offer.visibility}</span></span>
 {isApproved && <span className="text-small text-success-text font-medium">Approved — you can run this offer.</span>}
 {isPending && <span className="text-small text-warning-text font-medium">Request pending review.</span>}
 {isRejected && <span className="text-small text-danger-text font-medium">Access was rejected.</span>}
 {canRequest && <span className="text-small text-fg-secondary">This offer is open for requests.</span>}
 {!canRequest && !isPending && !isApproved && !isRejected && offer.visibility === 'private' && <span className="text-small text-fg-muted">Private offer — no open request path.</span>}
 </div>
 <div className="mt-3 flex flex-wrap gap-2">
 {canRequest && (
 <button type="button" className="btn-primary" onClick={handleRequest} disabled={requestMut.busy}>
 {requestMut.busy ? 'Requesting…' : 'Request access'}
 </button>
 )}
 {isPending && (
 <button type="button" className="btn-ghost border border-border text-danger-text" onClick={handleWithdraw} disabled={withdrawMut.busy}>
 {withdrawMut.busy ? 'Withdrawing…' : 'Withdraw request'}
 </button>
 )}
 {(requestMut.error || withdrawMut.error) && <span className="text-small text-danger-text">{requestMut.error || withdrawMut.error}</span>}
 </div>
 </div>
 </>
 );
}
