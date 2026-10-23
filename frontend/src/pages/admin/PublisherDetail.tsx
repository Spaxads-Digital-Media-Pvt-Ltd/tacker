import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Link2, Pencil } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { recordView } from '../../lib/recentlyViewed';
import { Badge, PageHeader, Tabs, StateBlock } from '../../shared-components/primitives/ui';
import { GeneralTab } from './publisherDetail/GeneralTab';
import { VisibilityTab } from './publisherDetail/VisibilityTab';
import { PostbacksTab } from './publisherDetail/PostbacksTab';
import { PlatformUsageTab } from './publisherDetail/PlatformUsageTab';
import { PartnerTrackingLinksModal } from './publisherDetail/PartnerTrackingLinksModal';
import {
  UsersTab, OfferApplicationsTab, TCsTab, CustomSettingsTab, CouponCodesTab,
  ScheduledActionsTab, ApiTab, DocumentsTab, TrackingDomainsTab, HistoryTab,
} from './publisherDetail/ShellTabs';
import type { Publisher, TrackingDomain } from '../../types';

const TABS = [
  'General', 'Visibility', 'Users', 'Postbacks', 'Offer Applications', 'T&Cs', 'Custom Settings',
  'Coupon Codes', 'Scheduled Actions', 'API', 'Documents', 'Tracking Domains', 'Platform Usage', 'History',
] as const;

export default function PublisherDetail() {
  const { id = '' } = useParams();
  const base = `/api/publishers/${id}`;
  const { data: pub, loading, error, refetch } = useQuery<Publisher>(base);
  const { data: domains } = useQuery<TrackingDomain[]>('/api/tracking-domains');
  const [tab, setTab] = useState<string>('General');
  const [linksOpen, setLinksOpen] = useState(false);

  useEffect(() => {
    if (pub) recordView('partner', pub.id, pub.name, pub.ref);
  }, [pub]);

  if (loading) return <StateBlock variant="loading" title="Loading partner…" rows={6} />;
  if (error || !pub) return error ? <StateBlock variant="error" title="Couldn’t load this partner" hint={error} onRetry={refetch} />
    : <StateBlock variant="empty" title="Publisher not found" />;

  return (
    <>
      <PageHeader
        title={`Partner Details: ${pub.name}`}
        subtitle={`Publisher · ${pub.status}`}
      />

      <Link to="/app/publishers" className="mb-3 inline-flex items-center gap-1 text-small font-medium text-fg-secondary hover:text-fg">
        <ChevronLeft size={16} aria-hidden /> All partners
      </Link>
      <section className="card mb-5 !p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 className="min-w-0 break-words text-h2 font-bold text-fg">{pub.name}</h2>
              <Badge value={pub.status} />
            </div>
            {pub.ref != null && <p className="mt-1 font-mono text-tiny text-fg-muted">#{pub.ref}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/app/publishers/${id}/edit`} className="btn-ghost"><Pencil size={16} aria-hidden /> Edit</Link>
            <button type="button" className="btn-primary" onClick={() => setLinksOpen(true)}><Link2 size={16} aria-hidden /> Partner Tracking Links</button>
          </div>
        </div>
      </section>

      <div className="mb-6 border-b border-border pb-2 [&>[role=tablist]]:mb-0">
        <Tabs tabs={[...TABS]} active={tab} onChange={setTab} />
      </div>

      {tab === 'General' && <GeneralTab pub={pub} />}
      {tab === 'Visibility' && <VisibilityTab />}
      {tab === 'Users' && <UsersTab />}
      {tab === 'Postbacks' && <PostbacksTab base={base} />}
      {tab === 'Offer Applications' && <OfferApplicationsTab />}
      {tab === "T&Cs" && <TCsTab />}
      {tab === 'Custom Settings' && <CustomSettingsTab />}
      {tab === 'Coupon Codes' && <CouponCodesTab />}
      {tab === 'Scheduled Actions' && <ScheduledActionsTab />}
      {tab === 'API' && <ApiTab />}
      {tab === 'Documents' && <DocumentsTab />}
      {tab === 'Tracking Domains' && <TrackingDomainsTab />}
      {tab === 'Platform Usage' && <PlatformUsageTab publisherId={pub.id} />}
      {tab === 'History' && <HistoryTab />}

      {linksOpen && <PartnerTrackingLinksModal publisher={pub} domains={domains ?? []} onClose={() => setLinksOpen(false)} />}
    </>
  );
}
