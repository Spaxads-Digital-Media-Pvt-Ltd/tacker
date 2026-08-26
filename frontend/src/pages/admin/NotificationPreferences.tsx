/**
 * My Account › My Notification Preferences — this user's own overrides of the same catalog Control
 * Center › Platform Configurations › Default Notifications edits network-wide. Reached from the
 * sidebar's Account popover (SidebarUtilityMenu.tsx), verified live against the reference's own
 * `/me/notifications` page.
 */
import { PageHeader } from '../../components/ui';
import { NotificationCard, HeadsUpBanner } from './controlCenter/shared';
import {
  PARTNER_NOTIFS, OFFER_NOTIFS_PLATFORM, OFFER_GROUP_NOTIFS, ADVERTISER_NOTIFS,
  ACTION_NOTIFS, BILLING_NOTIFS, NETWORK_NOTIFS, SECURITY_NOTIFS, TRAFFIC_HEALTH_NOTIFS,
} from '../../data/defaultNotifications';

export default function NotificationPreferences() {
  return (
    <>
      <PageHeader title="My Notification Preferences" subtitle="My Account › Notification Preferences" />
      <div className="space-y-4">
        <HeadsUpBanner>These preferences override the network default for your account only — they don't affect anyone else's notifications.</HeadsUpBanner>
        <NotificationCard title="Actions" notifs={ACTION_NOTIFS} />
        <NotificationCard title="Advertisers" notifs={ADVERTISER_NOTIFS} />
        <NotificationCard title="Billing" notifs={BILLING_NOTIFS} />
        <NotificationCard title="Network" notifs={NETWORK_NOTIFS} />
        <NotificationCard title="Offer Groups" notifs={OFFER_GROUP_NOTIFS} />
        <NotificationCard title="Offers" notifs={OFFER_NOTIFS_PLATFORM} />
        <NotificationCard title="Partners" notifs={PARTNER_NOTIFS} />
        <NotificationCard title="Security" notifs={SECURITY_NOTIFS} />
        <NotificationCard title="Traffic Health" notifs={TRAFFIC_HEALTH_NOTIFS} />
      </div>
    </>
  );
}
