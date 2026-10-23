import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Link2, Pencil, RefreshCw } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { recordView } from '../../lib/recentlyViewed';
import { OFFER_STATUS_LABEL, OFFER_STATUS_TONE } from '../../lib/offerStatus';
import { Badge, PageHeader, StateBlock, Tabs, type Column } from '../../shared-components/primitives/ui';
import { CollectionTab, type FieldDef } from '../../shared-components/panels/CollectionTab';
import { GeneralTab } from './offerDetail/GeneralTab';
import { CustomSettingsTab } from './offerDetail/CustomSettingsTab';
import { ForwardingRulesTab, ScheduledActionsTab, HistoryTab, PostbacksTab } from './offerDetail/ShellTabs';
import { TrackingLinksModal } from './offerDetail/TrackingLinksModal';
import { DUPLICATE_MODE_OPTIONS } from './offerForm/settings';
import type { Offer, Publisher, Advertiser, TrackingDomain } from '../../types';

type Row = { id: string; [k: string]: unknown };
const col = (header: string, cell: (r: Row) => ReactNode): Column<Row> => ({ header, cell });

const TABS = ['General', 'Goals', 'Creatives', 'Offer Applications', 'Custom Settings', 'Forwarding Rules', 'Scheduled Actions', 'Postbacks', 'History', 'Coupons & Deals', 'Tags'] as const;

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

  if (loading) return <StateBlock variant="loading" title="Loading offer…" rows={6} />;
  if (error || !offer) return error ? <StateBlock variant="error" title="Couldn’t load this offer" hint={error} onRetry={refetch} />
    : <StateBlock variant="empty" title="Offer not found" />;

  const advName = advertisers?.find((a) => a.id === offer.advertiserId)?.name ?? offer.advertiserId;
  const pubOptions = (publishers ?? []).map((p) => ({ value: p.id, label: p.name }));
  const pubName = (pid: unknown) => (publishers ?? []).find((p) => p.id === pid)?.name ?? String(pid ?? '—');

  return (
    <>
      <PageHeader
        title={`Offer Details: ${offer.name}`}
        subtitle={`${offer.status} · ${offer.payoutModel} · ${offer.currency}`}
      />

      <Link to="/app/offers" className="mb-3 inline-flex items-center gap-1 text-small font-medium text-fg-secondary hover:text-fg">
        <ChevronLeft size={16} aria-hidden /> All offers
      </Link>
      <section className="card mb-5 !p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 className="min-w-0 break-words text-h2 font-bold text-fg">{offer.name}</h2>
              <Badge value={offer.status} label={OFFER_STATUS_LABEL[offer.status] ?? offer.status} tone={OFFER_STATUS_TONE[offer.status]} />
            </div>
            <p className="mt-1 break-words font-mono text-tiny text-fg-muted">
              {[offer.ref != null ? `#${offer.ref}` : null, advName, offer.payoutModel, offer.currency].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" title="Refresh" aria-label="Refresh offer" onClick={() => refetch()} className="btn-ghost h-10 w-10 shrink-0 !px-0 !py-0 text-fg-secondary hover:text-fg">
              <RefreshCw size={16} aria-hidden />
            </button>
            <Link to={`/app/offers/${id}/edit`} className="btn-ghost"><Pencil size={16} aria-hidden /> Edit</Link>
            <button type="button" className="btn-primary" onClick={() => setLinksOpen(true)}><Link2 size={16} aria-hidden /> Offer Tracking Links</button>
          </div>
        </div>
      </section>

      <div className="mb-6 border-b border-border pb-2 [&>[role=tablist]]:mb-0">
        <Tabs tabs={[...TABS]} active={tab} onChange={setTab} />
      </div>

      {tab === 'General' && <GeneralTab offer={offer} advName={advName} domains={domains ?? []} base={base} onSaved={refetch} />}

      {tab === 'Goals' && (
        <div className="space-y-3">
          <p className="text-small text-fg-secondary">
            A postback's <span className="font-mono">event</span> picks the goal with that event name and its payout/revenue. Without a match
            the default goal applies — but a partner's or country's own rate frozen on the click still wins over the default goal.
            Conversions over a goal cap are held as Pending (“Over caps”) for you to approve or reject in Reporting › Conversion; daily
            caps reset at midnight in the offer’s cap time zone. Each event can have its own duplicate rule — blank follows the offer’s
            (Edit Offer › Revenue).
          </p>
          <CollectionTab basePath={`${base}/goals`} addLabel="Add goal" editable emptyText="No goals — every conversion uses the offer's own payout and revenue."
            fields={[
              { key: 'name', label: 'Name', required: true },
              { key: 'eventName', label: 'Event name (matches the postback event)', placeholder: 'e.g. purchase' },
              { key: 'payoutModel', label: 'Payout model', type: 'select', options: ['CPA', 'CPL', 'CPC', 'CPI', 'RevShare'], default: 'CPA' },
              { key: 'payout', label: 'Payout', type: 'money', default: '0' },
              { key: 'revenue', label: 'Revenue', type: 'money', default: '0' },
              { key: 'currency', label: 'Currency', default: offer.currency },
              { key: 'dailyConversionCap', label: 'Daily conversion cap', type: 'number', placeholder: 'Unlimited' },
              { key: 'totalConversionCap', label: 'Total conversion cap', type: 'number', placeholder: 'Unlimited' },
              { key: 'duplicateMode', label: 'Duplicate conversions (blank = the offer’s rule)', type: 'select', options: DUPLICATE_MODE_OPTIONS },
              { key: 'isDefault', label: 'Default goal', type: 'checkbox' },
              { key: 'status', label: 'Status', type: 'select', options: ['active', 'paused'], default: 'active' },
            ] as FieldDef[]}
            columns={[
              col('Name', (r) => String(r.name)),
              col('Event', (r) => (r.eventName ? <span className="font-mono text-tiny">{String(r.eventName)}</span> : '—')),
              col('Payout', (r) => `${r.currency ?? offer.currency} ${r.payout ?? '0'}`),
              col('Revenue', (r) => `${r.currency ?? offer.currency} ${r.revenue ?? '0'}`),
              col('Caps', (r) => [r.dailyConversionCap ? `${r.dailyConversionCap}/day` : null, r.totalConversionCap ? `${r.totalConversionCap} total` : null].filter(Boolean).join(' · ') || '—'),
              col('Duplicates', (r) => DUPLICATE_MODE_OPTIONS.find((o) => o.value === r.duplicateMode)?.label ?? 'Offer’s rule'),
              col('Default', (r) => (r.isDefault ? 'Yes' : '')),
              col('Status', (r) => String(r.status)),
            ]} />
        </div>
      )}

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
          <p className="text-small text-fg-secondary">A partner's payout override replaces the offer payout (and any country rate) for every click that partner sends. Granting access to a partner who already requested it approves that request.</p>
          <CollectionTab basePath={`${base}/publishers`} addLabel="Grant access" editable emptyText="No affiliate access rules."
            fields={[
              { key: 'publisherId', label: 'Affiliate', type: 'select', options: pubOptions, required: true },
              { key: 'access', label: 'Access', type: 'select', options: ['allow', 'deny'], default: 'allow' },
              { key: 'approvalStatus', label: 'Approval', type: 'select', options: ['approved', 'pending', 'rejected'], default: 'approved' },
              { key: 'payoutOverride', label: 'Payout override', type: 'money', placeholder: 'Offer payout' },
            ] as FieldDef[]}
            columns={[col('Affiliate', (r) => pubName(r.publisherId)), col('Access', (r) => String(r.access)), col('Approval', (r) => String(r.approvalStatus)), col('Payout override', (r) => String(r.payoutOverride ?? '—'))]} />
          <BlockedAffiliates base={base} pubName={pubName} />
        </div>
      )}

      {tab === 'Custom Settings' && <CustomSettingsTab base={base} offerId={offer.id} />}
      {tab === 'Forwarding Rules' && <ForwardingRulesTab base={base} pubOptions={pubOptions} />}
      {tab === 'Scheduled Actions' && <ScheduledActionsTab base={base} pubOptions={pubOptions} />}
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
        // data colour — '#3b82f6' is only the Color field's example placeholder (user data, not a theme colour)
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
