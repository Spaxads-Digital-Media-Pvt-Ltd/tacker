import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Link2, Pencil } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { recordView } from '../../lib/recentlyViewed';
import { PageHeader, Tabs, Spinner, StateBlock } from '../../components/ui';
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
  const { data: pub, loading, error } = useQuery<Publisher>(base);
  const { data: domains } = useQuery<TrackingDomain[]>('/api/tracking-domains');
  const [tab, setTab] = useState<string>('General');
  const [linksOpen, setLinksOpen] = useState(false);

  useEffect(() => {
    if (pub) recordView('partner', pub.id, pub.name, pub.ref);
  }, [pub]);

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error || !pub) return <StateBlock>{error ?? 'Publisher not found'}</StateBlock>;

  return (
    <>
      <PageHeader
        title={`Partner Details: ${pub.name}`}
        subtitle={`Publisher · ${pub.status}`}
        action={
          <div className="flex items-center gap-2">
            <Link to="/app/publishers" className="btn-ghost">← All partners</Link>
            <Link to={`/app/publishers/${id}/edit`} className="btn-ghost"><Pencil size={14} /> Edit</Link>
            <button className="btn-primary" onClick={() => setLinksOpen(true)}><Link2 size={15} /> Partner Tracking Links</button>
          </div>
        }
      />

      <Tabs tabs={[...TABS]} active={tab} onChange={setTab} />

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
