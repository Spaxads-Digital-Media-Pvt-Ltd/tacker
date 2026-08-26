import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { recordView } from '../../lib/recentlyViewed';
import { PageHeader, Tabs, Spinner, StateBlock } from '../../components/ui';
import { GeneralTab } from './advertiserDetail/GeneralTab';
import { OffersTab } from './advertiserDetail/OffersTab';
import {
  EventsTab, UsersTab, ApiKeysTab, ApiIpsTab, WhitelistTab, DocumentsTab, OptizmoTab, ProductFeedsTab, DealsTab, HistoryTab,
} from './advertiserDetail/ShellTabs';
import type { Advertiser } from '../../types';

const TABS = [
  'General', 'Events', 'Users', 'Offers', 'API Keys', 'API IPs', 'Whitelist', 'Documents', 'Optizmo', 'Product Feeds', 'Deals', 'History',
] as const;

export default function AdvertiserDetail() {
  const { id = '' } = useParams();
  const base = `/api/advertisers/${id}`;
  const { data: adv, loading, error } = useQuery<Advertiser>(base);
  const [tab, setTab] = useState<string>('General');

  useEffect(() => {
    if (adv) recordView('advertiser', adv.id, adv.name, adv.ref);
  }, [adv]);

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error || !adv) return <StateBlock>{error ?? 'Advertiser not found'}</StateBlock>;

  return (
    <>
      <PageHeader
        title={`Advertiser Details: ${adv.name}`}
        subtitle={`Advertiser · ${adv.status} · ${adv.defaultCurrency}`}
        action={
          <div className="flex items-center gap-2">
            <Link to="/app/advertisers" className="btn-ghost">← All advertisers</Link>
            <Link to={`/app/advertisers/${id}/edit`} className="btn-ghost"><Pencil size={14} /> Edit</Link>
          </div>
        }
      />

      <Tabs tabs={[...TABS]} active={tab} onChange={setTab} />

      {tab === 'General' && <GeneralTab adv={adv} base={base} />}
      {tab === 'Events' && <EventsTab />}
      {tab === 'Users' && <UsersTab />}
      {tab === 'Offers' && <OffersTab advertiserId={adv.id} />}
      {tab === 'API Keys' && <ApiKeysTab />}
      {tab === 'API IPs' && <ApiIpsTab />}
      {tab === 'Whitelist' && <WhitelistTab />}
      {tab === 'Documents' && <DocumentsTab />}
      {tab === 'Optizmo' && <OptizmoTab />}
      {tab === 'Product Feeds' && <ProductFeedsTab />}
      {tab === 'Deals' && <DealsTab />}
      {tab === 'History' && <HistoryTab />}
    </>
  );
}
