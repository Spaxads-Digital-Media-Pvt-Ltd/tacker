/**
 * Control Center (Everflow-style): network-wide configuration hub — Accounts, Platform, Partners,
 * Advertisers, Security, Usage, Documents, Segmentations. Most of this app has no backend concept
 * for network-level config, so each section is either real data reused from elsewhere (tracking
 * domains, API keys, tags, offer categories, partner traffic sources) or an honest static/shell
 * replica of the reference's structure — see each tab file for specifics.
 *
 * Each section is its own real route (/app/control-center/<slug>), matching the reference's own
 * distinct URLs per flyout item (/controls/accounts, /controls/platform, etc. — confirmed live).
 * The reference has no top-level tab strip switching between these 8 sections on the page itself —
 * navigation between them happens only through the sidebar flyout (confirmed live: each page's own
 * content starts directly with that section's real sub-tabs, e.g. Accounts/History Log), so this
 * page doesn't render one either — it was a leftover from the pre-routing single-page-with-tabs
 * version.
 */
import { useParams } from 'react-router-dom';
import { PageHeader } from '../../components/ui';
import AccountsTab from './controlCenter/AccountsTab';
import PlatformTab from './controlCenter/PlatformTab';
import PartnersTab from './controlCenter/PartnersTab';
import AdvertisersTab from './controlCenter/AdvertisersTab';
import SecurityTab from './controlCenter/SecurityTab';
import UsageTab from './controlCenter/UsageTab';
import DocumentsTab from './controlCenter/DocumentsTab';
import SegmentationsTab from './controlCenter/SegmentationsTab';

type Tab = 'Accounts' | 'Platform' | 'Partners' | 'Advertisers' | 'Security' | 'Usage' | 'Documents' | 'Segmentations';

const SLUG_TO_TAB: Record<string, Tab> = {
  accounts: 'Accounts', platform: 'Platform', partners: 'Partners', advertisers: 'Advertisers',
  security: 'Security', usage: 'Usage', documents: 'Documents', segmentations: 'Segmentations',
};

const TITLES: Record<Tab, string> = {
  Accounts: 'Manage Accounts',
  Platform: 'Manage Platform Configurations',
  Partners: 'Manage Partner Configurations',
  Advertisers: 'Manage Advertiser Configurations',
  Security: 'Manage Security',
  Usage: 'Manage Usage',
  Documents: 'Manage Documents',
  Segmentations: 'Segmentation Options',
};

export default function ControlCenter() {
  const { tab: slug } = useParams();
  const tab: Tab = (slug && SLUG_TO_TAB[slug]) || 'Accounts';

  return (
    <>
      <PageHeader title={TITLES[tab]} subtitle={`Control Center › ${tab}`} />
      {tab === 'Accounts' && <AccountsTab />}
      {tab === 'Platform' && <PlatformTab />}
      {tab === 'Partners' && <PartnersTab />}
      {tab === 'Advertisers' && <AdvertisersTab />}
      {tab === 'Security' && <SecurityTab />}
      {tab === 'Usage' && <UsageTab />}
      {tab === 'Documents' && <DocumentsTab />}
      {tab === 'Segmentations' && <SegmentationsTab />}
    </>
  );
}
