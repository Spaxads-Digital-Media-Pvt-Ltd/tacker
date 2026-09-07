/**
 * My Account › My Notification Preferences — this user's own overrides of the same catalog Control
 * Center › Platform Configurations › Default Notifications edits network-wide. Reached from the
 * sidebar Account / Profile menu.
 */
import { PageHeader, Spinner, StateBlock } from '../../components/ui';
import { NotificationCard, HeadsUpBanner, type NotifySaved } from './controlCenter/shared';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/useApi';
import {
  PARTNER_NOTIFS, OFFER_NOTIFS_PLATFORM, OFFER_GROUP_NOTIFS, ADVERTISER_NOTIFS,
  ACTION_NOTIFS, BILLING_NOTIFS, NETWORK_NOTIFS, SECURITY_NOTIFS, TRAFFIC_HEALTH_NOTIFS,
} from '../../data/defaultNotifications';

type Prefs = Record<string, NotifySaved>;

const SECTIONS: { key: string; title: string; notifs: typeof ACTION_NOTIFS }[] = [
  { key: 'actions', title: 'Actions', notifs: ACTION_NOTIFS },
  { key: 'advertisers', title: 'Advertisers', notifs: ADVERTISER_NOTIFS },
  { key: 'billing', title: 'Billing', notifs: BILLING_NOTIFS },
  { key: 'network', title: 'Network', notifs: NETWORK_NOTIFS },
  { key: 'offerGroups', title: 'Offer Groups', notifs: OFFER_GROUP_NOTIFS },
  { key: 'offers', title: 'Offers', notifs: OFFER_NOTIFS_PLATFORM },
  { key: 'partners', title: 'Partners', notifs: PARTNER_NOTIFS },
  { key: 'security', title: 'Security', notifs: SECURITY_NOTIFS },
  { key: 'trafficHealth', title: 'Traffic Health', notifs: TRAFFIC_HEALTH_NOTIFS },
];

export default function NotificationPreferences() {
  const { data, loading, error, refetch } = useQuery<{ preferences: Prefs }>('/api/me/notifications');
  const prefs = data?.preferences ?? {};

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error) return <StateBlock>{error}</StateBlock>;

  return (
    <>
      <PageHeader title="My Notification Preferences" subtitle="My Account › Notification Preferences" />
      <div className="space-y-4">
        <HeadsUpBanner>These preferences override the network default for your account only — they don't affect anyone else's notifications.</HeadsUpBanner>
        {SECTIONS.map((s) => (
          <NotificationCard
            key={s.key}
            title={s.title}
            notifs={s.notifs}
            saved={prefs[s.key]}
            onSave={async (values) => {
              await api.put('/api/me/notifications', { preferences: { [s.key]: values } });
              refetch();
              return true;
            }}
          />
        ))}
      </div>
    </>
  );
}
