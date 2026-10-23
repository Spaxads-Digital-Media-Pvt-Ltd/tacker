import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Pencil } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { recordView } from '../../lib/recentlyViewed';
import { Badge, PageHeader, Tabs, StateBlock } from '../../shared-components/primitives/ui';
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
  const { data: adv, loading, error, refetch } = useQuery<Advertiser>(base);
  const [tab, setTab] = useState<string>('General');

  useEffect(() => {
    if (adv) recordView('advertiser', adv.id, adv.name, adv.ref);
  }, [adv]);

  if (loading) return <StateBlock variant="loading" title="Loading advertiser…" rows={6} />;
  if (error || !adv) return error ? <StateBlock variant="error" title="Couldn’t load this advertiser" hint={error} onRetry={refetch} />
    : <StateBlock variant="empty" title="Advertiser not found" />;

  return (
    <>
      <PageHeader
        title={`Advertiser Details: ${adv.name}`}
        subtitle={`Advertiser · ${adv.status} · ${adv.defaultCurrency}`}
      />

      <Link to="/app/advertisers" className="mb-3 inline-flex items-center gap-1 text-small font-medium text-fg-secondary hover:text-fg">
        <ChevronLeft size={16} aria-hidden /> All advertisers
      </Link>
      <section className="card mb-5 !p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 className="min-w-0 break-words text-h2 font-bold text-fg">{adv.name}</h2>
              <Badge value={adv.status} />
            </div>
            <p className="mt-1 font-mono text-tiny text-fg-muted">{[adv.ref != null ? `#${adv.ref}` : null, adv.defaultCurrency].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/app/advertisers/${id}/edit`} className="btn-ghost"><Pencil size={16} aria-hidden /> Edit</Link>
          </div>
        </div>
      </section>

      <div className="mb-6 border-b border-border pb-2 [&>[role=tablist]]:mb-0">
        <Tabs tabs={[...TABS]} active={tab} onChange={setTab} />
      </div>

      {tab === 'General' && <GeneralTab adv={adv} base={base} />}
      {tab === 'Events' && <EventsTab advertiserId={id} />}
      {tab === 'Users' && <UsersTab />}
      {tab === 'Offers' && <OffersTab advertiserId={adv.id} />}
      {tab === 'API Keys' && <ApiKeysTab advertiserId={id} />}
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
