import { useState } from 'react';
import { Tabs } from '../../../components/ui';
import { EmptyShellTable } from '../../../components/EmptyShellTable';
import { InfoCard, InfoGrid, InfoRow, NotificationRow, type NotifyDef } from './shared';

const SUB_TABS = ['General', 'Default Notifications'] as const;

function GeneralSub() {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <InfoCard title="General">
        <InfoGrid>
          <InfoRow label="HTML Custom Header (Left menu)" />
          <InfoRow label="HTML Custom Footer (Left menu)" />
          <InfoRow label="Hide Total Click" />
        </InfoGrid>
      </InfoCard>
      <InfoCard title="Advertiser Sign Up Form Customization">
        <InfoGrid>
          <InfoRow label="Custom Sign Up Header" />
          <InfoRow label="Custom Sign Up Confirmation" />
        </InfoGrid>
        <p className="mb-2 mt-4 text-small font-semibold text-fg">Custom Fields Summary</p>
        <EmptyShellTable search={false} columns={['Order', 'Label', 'Field Type', 'Required']} />
      </InfoCard>
    </div>
  );
}

const NETWORK_NOTIFS: NotifyDef[] = [
  { name: 'Communication Hub Email (from network)', desc: 'When a Communication Hub Email is sent to you', email: true },
];

function NotificationsSub() {
  return (
    <InfoCard title="Network" action={<span />}>
      <div>{NETWORK_NOTIFS.map((n) => <NotificationRow key={n.name} n={n} />)}</div>
    </InfoCard>
  );
}

export default function AdvertisersTab() {
  const [sub, setSub] = useState<string>('General');
  return (
    <>
      <Tabs tabs={[...SUB_TABS]} active={sub} onChange={setSub} />
      {sub === 'General' && <GeneralSub />}
      {sub === 'Default Notifications' && <NotificationsSub />}
    </>
  );
}
