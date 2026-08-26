import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Link2, Pencil, RefreshCw } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { recordView } from '../../lib/recentlyViewed';
import { PageHeader, Spinner, StateBlock, Tabs, type Column } from '../../components/ui';
import { CollectionTab, type FieldDef } from '../../components/CollectionTab';
import { GeneralTab } from './offerDetail/GeneralTab';
import { CustomSettingsTab } from './offerDetail/CustomSettingsTab';
import { ForwardingRulesTab, ScheduledActionsTab, HistoryTab, PostbacksTab } from './offerDetail/ShellTabs';
import { TrackingLinksModal } from './offerDetail/TrackingLinksModal';
import type { Offer, Publisher, Advertiser, TrackingDomain } from '../../types';

type Row = { id: string; [k: string]: unknown };
const col = (header: string, cell: (r: Row) => ReactNode): Column<Row> => ({ header, cell });

const TABS = ['General', 'Creatives', 'Offer Applications', 'Custom Settings', 'Forwarding Rules', 'Scheduled Actions', 'Postbacks', 'History', 'Coupons & Deals', 'Tags'] as const;

export default function OfferDetail() {
  const { id = '' } = useParams();
  const base = `/api/offers/${id}`;
  const { data: offer, loading, error, refetch } = useQuery<Offer>(base);
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: domains } = useQuery<TrackingDomain[]>('/api/tracking-domains');
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<string>(() => {
    const fromUrl = searchParams.get('tab');
    return fromUrl && (TABS as readonly string[]).includes(fromUrl) ? fromUrl : 'General';
  });
  const [linksOpen, setLinksOpen] = useState(false);

  useEffect(() => {
    if (offer) recordView('offer', offer.id, offer.name, offer.ref);
  }, [offer]);

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error || !offer) return <StateBlock>{error ?? 'Offer not found'}</StateBlock>;

  const advName = advertisers?.find((a) => a.id === offer.advertiserId)?.name ?? offer.advertiserId;
  const pubOptions = (publishers ?? []).map((p) => ({ value: p.id, label: p.name }));
  const pubName = (pid: unknown) => (publishers ?? []).find((p) => p.id === pid)?.name ?? String(pid ?? '—');

  return (
    <>
      <PageHeader
        title={`Offer Details: ${offer.name}`}
        subtitle={`${offer.status} · ${offer.payoutModel} · ${offer.currency}`}
        action={
          <div className="flex items-center gap-2">
            <Link to="/app/offers" className="btn-ghost">← All offers</Link>
            <Link to={`/app/offers/${id}/edit`} className="btn-ghost"><Pencil size={14} /> Edit</Link>
            <button className="btn-primary" onClick={() => setLinksOpen(true)}><Link2 size={15} /> Offer Tracking Links</button>
            <button title="Refresh" onClick={() => refetch()} className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary transition-colors hover:bg-accent-subtle hover:text-fg">
              <RefreshCw size={15} />
            </button>
          </div>
        }
      />

      <Tabs tabs={[...TABS]} active={tab} onChange={setTab} />

      {tab === 'General' && <GeneralTab offer={offer} advName={advName} domains={domains ?? []} base={base} onSaved={refetch} />}

      {tab === 'Creatives' && (
        <CollectionTab basePath={`${base}/creatives`} addLabel="Creative" editable emptyText="No creatives."
          fields={[
            { key: 'name', label: 'Name', required: true },
            { key: 'type', label: 'Type', type: 'select', options: ['image', 'html', 'link', 'email', 'video'], default: 'image' },
            { key: 'url', label: 'Asset URL', type: 'url' },
            { key: 'html', label: 'HTML / snippet', type: 'textarea' },
            { key: 'width', label: 'Width', type: 'number' },
            { key: 'height', label: 'Height', type: 'number' },
          ] as FieldDef[]}
          columns={[col('Name', (r) => String(r.name)), col('Type', (r) => String(r.type)), col('Size', (r) => (r.width ? `${r.width}×${r.height}` : '—'))]} />
      )}

      {tab === 'Offer Applications' && (
        <div className="space-y-6">
          <CollectionTab basePath={`${base}/publishers`} addLabel="Grant access" emptyText="No affiliate access rules."
            fields={[
              { key: 'publisherId', label: 'Affiliate', type: 'select', options: pubOptions, required: true },
              { key: 'access', label: 'Access', type: 'select', options: ['allow', 'deny'], default: 'allow' },
              { key: 'approvalStatus', label: 'Approval', type: 'select', options: ['approved', 'pending', 'rejected'], default: 'approved' },
              { key: 'payoutOverride', label: 'Payout override', type: 'money' },
            ] as FieldDef[]}
            columns={[col('Affiliate', (r) => pubName(r.publisherId)), col('Access', (r) => String(r.access)), col('Approval', (r) => String(r.approvalStatus)), col('Payout override', (r) => String(r.payoutOverride ?? '—'))]} />
          <BlockedAffiliates base={base} pubName={pubName} />
        </div>
      )}

      {tab === 'Custom Settings' && <CustomSettingsTab base={base} offerId={offer.id} />}
      {tab === 'Forwarding Rules' && <ForwardingRulesTab base={base} />}
      {tab === 'Scheduled Actions' && <ScheduledActionsTab base={base} />}
      {tab === 'Postbacks' && <PostbacksTab base={base} pubOptions={pubOptions} />}
      {tab === 'History' && <HistoryTab base={base} />}

      {tab === 'Coupons & Deals' && (
        <div className="space-y-6">
          <CollectionTab basePath={`${base}/coupons`} addLabel="Add coupon" editable emptyText="No coupon codes."
            fields={[
              { key: 'code', label: 'Code', required: true, placeholder: 'SAVE20' },
              { key: 'discount', label: 'Discount', placeholder: '20% off' },
              { key: 'publisherId', label: 'Assign to affiliate (optional)', type: 'select', options: pubOptions },
              { key: 'status', label: 'Status', type: 'select', options: ['active', 'expired', 'disabled'], default: 'active' },
            ] as FieldDef[]}
            columns={[col('Code', (r) => String(r.code)), col('Discount', (r) => String(r.discount ?? '—')), col('Status', (r) => String(r.status))]} />
          <CollectionTab basePath={`${base}/deals`} addLabel="Add deal" editable emptyText="No deals."
            fields={[
              { key: 'name', label: 'Name', required: true },
              { key: 'dealType', label: 'Type', type: 'select', options: ['payout_boost', 'flat_bonus', 'custom'], default: 'payout_boost' },
              { key: 'value', label: 'Value', type: 'money' },
              { key: 'status', label: 'Status', type: 'select', options: ['active', 'scheduled', 'ended'], default: 'active' },
            ] as FieldDef[]}
            columns={[col('Deal', (r) => String(r.name)), col('Type', (r) => String(r.dealType)), col('Value', (r) => String(r.value ?? '—')), col('Status', (r) => String(r.status))]} />
        </div>
      )}

      {tab === 'Tags' && (
        <CollectionTab basePath={`${base}/tags`} addLabel="Add tag" emptyText="No tags."
          fields={[{ key: 'name', label: 'Tag name', required: true }, { key: 'color', label: 'Color', placeholder: '#3b82f6' }] as FieldDef[]}
          columns={[col('Tag', (r) => String(r.name)), col('Color', (r) => String(r.color ?? '—'))]} />
      )}

      {linksOpen && <TrackingLinksModal offer={offer} publishers={publishers ?? []} domains={domains ?? []} onClose={() => setLinksOpen(false)} />}
    </>
  );
}

/** Read-only summary of blocked affiliates, pulled from the same access rules shown above. */
function BlockedAffiliates({ base, pubName }: { base: string; pubName: (id: unknown) => string }) {
  const { data } = useQuery<Row[]>(`${base}/publishers`);
  const blocked = (data ?? []).filter((a) => a.access === 'deny');
  return (
    <div className="card">
      <h3 className="mb-2 text-h3 font-medium text-fg">Blocked Affiliates ({blocked.length})</h3>
      {blocked.length === 0
        ? <p className="text-small text-fg-muted">No affiliates are currently blocked from this offer.</p>
        : <ul className="space-y-1 text-small text-fg">{blocked.map((a) => <li key={a.id}>{pubName(a.publisherId)}</li>)}</ul>}
      <p className="mt-3 rounded-[var(--radius)] bg-danger-bg px-3 py-2 text-tiny text-danger-text">Blocked affiliates cannot access this offer. Traffic from their tracking links is rejected.</p>
    </div>
  );
}
