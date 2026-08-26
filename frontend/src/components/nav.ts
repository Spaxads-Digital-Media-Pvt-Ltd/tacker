import type { Role } from '../auth/roles';
import { Icon } from './icons';

export interface NavLeaf { to: string; label: string; icon?: keyof typeof Icon }
export interface FlyoutItem { label: string; description: string; to?: string }
export interface NavEntry {
  label: string;
  icon: keyof typeof Icon;
  to?: string;              // leaf link
  children?: NavLeaf[];     // expandable group (drives the in-page SectionTabs bar)
  flyout?: FlyoutItem[];    // Everflow-style rail flyout — opens on click instead of navigating directly
  group?: string;           // section header shown above this item in the expanded rail (undefined = ungrouped)
}

/**
 * Per-surface navigation (spec §0), Everflow-style with expandable section groups for admins.
 * Publishers never see revenue/margin views; advertisers see only their own offers/stats — UX
 * shaping only; the backend still enforces every read.
 *
 * `flyout` entries mirror the live reference's own rail flyouts field-for-field (title + one-line
 * description per item). Where this app has a real page for an item, `to` points at it; where it
 * doesn't, `to` is omitted and the item renders inert-but-interactive (title="Not available yet"),
 * same convention used everywhere else in this app for backend-less features.
 */
export const NAV: Record<Role, NavEntry[]> = {
  super_admin: [
    { to: '/admin', label: 'Overview', icon: 'dashboard' },
    { to: '/admin/networks', label: 'Networks', icon: 'building' },
    { to: '/admin/subscriptions', label: 'Subscriptions', icon: 'wallet' },
    { to: '/admin/usage', label: 'Usage', icon: 'chart' },
  ],
  admin: [
    { to: '/app', label: 'Dashboard', icon: 'dashboard' },
    {
      group: 'Manage', label: 'Offers', icon: 'offers', flyout: [
        { label: 'Manage', description: 'View and manage Offers', to: '/app/offers' },
        { label: 'Add', description: 'Create a new Offer', to: '/app/offers/new' },
        { label: 'Templates', description: 'Pre-filled offer templates', to: '/app/offers-templates' },
        { label: 'Smart Links', description: 'Route traffic across Offers', to: '/app/smart-links' },
        { label: 'Groups', description: 'Offer groups with shared caps', to: '/app/offers-groups' },
        { label: 'Creatives', description: 'Manage creative assets', to: '/app/offers-creatives' },
        { label: 'Traffic Controls', description: 'Block or redirect specific clicks', to: '/app/offers-traffic-controls' },
        { label: 'Custom Settings', description: 'Per-offer payout, caps & pages', to: '/app/offers-custom-settings' },
        { label: 'SmartSwitch', description: 'Auto-optimization & fraud protection', to: '/app/offers-smartswitch' },
      ],
    },
    {
      group: 'Manage', label: 'Partners', icon: 'manager', flyout: [
        { label: 'Manage', description: 'View and approve Partners', to: '/app/publishers' },
        { label: 'Add', description: 'Set up a new Partner', to: '/app/publishers/new' },
        { label: 'Postbacks', description: 'Fire conversion data to Partners', to: '/app/aff-postbacks' },
        { label: 'Tiers', description: 'Payout & visibility by tier', to: '/app/aff-tiers' },
        { label: 'Offer Applications', description: 'Approval forms for Offers', to: '/app/aff-applications' },
        { label: 'Traffic Blocking', description: 'Restrict traffic sub-placements', to: '/app/aff-traffic-blocking' },
        { label: 'Traffic Sources', description: 'Presets for tracking links', to: '/app/aff-traffic-sources' },
        { label: 'Adjustments', description: 'Amend clicks, revenue or payout', to: '/app/aff-adjustments' },
        { label: 'Coupon Codes', description: 'Clickless tracking via coupons', to: '/app/aff-coupons' },
        { label: 'Invoices', description: 'Accounts Payable invoices', to: '/app/aff-invoices' },
      ],
    },
    {
      group: 'Manage', label: 'Advertisers', icon: 'building', flyout: [
        { label: 'Manage', description: 'View and manage Advertisers', to: '/app/advertisers' },
        { label: 'Add', description: 'Set up a new Advertiser', to: '/app/advertisers/new' },
        { label: 'Link Templates', description: 'Default landing page templates', to: '/app/adv-link-templates' },
        { label: 'Postback Controls', description: 'Auto-approve or reject conversions', to: '/app/adv-postback-controls' },
        { label: 'Invoices', description: 'Accounts Receivable invoices', to: '/app/adv-invoices' },
        { label: 'Tiered Commissions', description: 'Payout by performance tier', to: '/app/adv-tiered-commissions' },
      ],
    },
    {
      group: 'Analyze', label: 'Reporting', icon: 'chart', flyout: [
        { label: 'Offer', description: 'Performance by Offer', to: '/app/reports/offer' },
        { label: 'Partner', description: 'Performance by Partner', to: '/app/reports/partner' },
        { label: 'Advertiser', description: 'Performance by Advertiser', to: '/app/reports/advertiser' },
        { label: 'Smart Link', description: 'Performance by Smart Link', to: '/app/reports/smartlink' },
        { label: 'Daily', description: 'Broken down by day', to: '/app/reports/daily' },
        { label: 'Hourly', description: 'Broken down by hour', to: '/app/reports/hourly' },
        { label: 'Impression', description: 'Detailed impression data', to: '/app/reports/impression' },
        { label: 'Click', description: 'Detailed click data', to: '/app/reports/click' },
        { label: 'Conversion', description: 'Detailed conversion data', to: '/app/reports/conversion' },
        { label: 'Event', description: 'Event performance by Offer', to: '/app/reports/event' },
        { label: 'Pacing', description: 'Cap fulfillment over time', to: '/app/reports/pacing' },
        { label: 'Click To Conversion Time', description: 'Click-to-conversion timeline', to: '/app/reports/click-to-conversion-time' },
        { label: 'Partner Postback', description: 'Postbacks fired to Partners', to: '/app/reports/partner-postback' },
        { label: 'Advertiser Postback', description: 'Postbacks from Advertisers', to: '/app/reports/advertiser-postback' },
        { label: 'Partner Referrals', description: 'Referral commission by Partner', to: '/app/reports/partner-referrals' },
        { label: 'Custom Reporting Metrics', description: 'Define custom metrics' , to: '/app/reports/custom-metrics' },
        { label: 'Products', description: 'Performance by SKU', to: '/app/reports/products' },
        { label: 'Refunds', description: 'Refunds from connected stores', to: '/app/reports/refunds' },
        { label: 'Conversion Imports', description: 'Bulk-add conversion data', to: '/app/reports/conversion-imports' },
        { label: 'Saved & Scheduled', description: 'Your saved reports', to: '/app/reports/saved-scheduled' },
      ],
    },
    {
      group: 'Analyze', label: 'Analytics', icon: 'analytics', flyout: [
        { label: 'Dimensional', description: 'Pivot across metrics & dimensions', to: '/app/analytics' },
        { label: 'Flex', description: 'Build a custom report', to: '/app/analytics?tab=flex' },
        { label: 'Dynamic Nested', description: 'Two nested layers of data', to: '/app/analytics?tab=nested' },
        { label: 'Cohort', description: 'Aged view over time', to: '/app/analytics?tab=cohort' },
        { label: 'Redirect', description: 'Fail Traffic by Offer', to: '/app/analytics?tab=redirect' },
        { label: 'Variance', description: 'Compare two time periods', to: '/app/analytics?tab=variance' },
        { label: 'Funnel', description: 'Events leading to conversions', to: '/app/analytics?tab=funnel' },
      ],
    },
    {
      group: 'Connect', label: 'Marketplace', icon: 'marketplace', flyout: [
        { label: 'Discover Advertisers', description: 'Connect with Partners that drive revenue', to: '/app/marketplace' },
        { label: 'Your Profile(s)', description: 'Edit your public profile', to: '/app/marketplace/profile' },
        { label: 'Manage Connections', description: 'View, manage and edit your connections, invitations or pending connections', to: '/app/marketplace/connections' },
      ],
    },
    { group: 'Connect', to: '/app/integrations', label: 'Integrations', icon: 'spark' },
    { group: 'Tools', to: '/app/communication-hub', label: 'Communication Hub', icon: 'send' },
    {
      group: 'Tools', label: 'Customer Value', icon: 'gem', flyout: [
        { label: 'Payout & Revenue Rules', description: 'Auto-adjust by customer event', to: '/app/customer-value' },
        { label: 'Custom Data Points', description: 'Custom parameters for reports', to: '/app/customer-value/data-points' },
        { label: 'Conversion Events Report', description: 'Events by customer ID', to: '/app/customer-value/conversion-events' },
      ],
    },
    { group: 'Tools', to: '/app/traffic-health', label: 'Traffic Health', icon: 'pulse' },
    { group: 'More', to: '/app/investigator', label: 'Investigator', icon: 'investigator' },
    {
      group: 'More', label: 'Automation', icon: 'automation', flyout: [
        { label: 'Scheduled Actions', description: 'Schedule status, caps & payout', to: '/app/automation' },
        { label: 'Alerts', description: 'Notify on KPI thresholds', to: '/app/alerts' },
        { label: 'Webhooks', description: 'Send data to 3rd parties' },
      ],
    },
    {
      group: 'More', label: 'Control Center', icon: 'controlCenter', flyout: [
        { label: 'Accounts', description: 'Employee accounts & roles', to: '/app/control-center/accounts' },
        { label: 'Platform Configurations', description: 'Program-level settings', to: '/app/control-center/platform' },
        { label: 'Partner Configurations', description: 'Sign up, notices & terms', to: '/app/control-center/partners' },
        { label: 'Advertiser Configurations', description: 'Sign up & dashboard setup', to: '/app/control-center/advertisers' },
        { label: 'Security', description: 'API keys & IP whitelist', to: '/app/control-center/security' },
        { label: 'Usage', description: 'Account usage per month', to: '/app/control-center/usage' },
        { label: 'Documents', description: 'Contracts & resources', to: '/app/control-center/documents' },
        { label: 'Segmentation Options', description: 'Categories, labels & channels', to: '/app/control-center/segmentations' },
      ],
    },
  ],
  publisher: [
    { to: '/publisher', label: 'Overview', icon: 'dashboard' },
    { to: '/publisher/offers', label: 'Offers', icon: 'offers' },
    { to: '/publisher/stats', label: 'Stats', icon: 'chart' },
    { to: '/publisher/earnings', label: 'Earnings', icon: 'wallet' },
    { to: '/publisher/api-keys', label: 'API Keys', icon: 'key' },
  ],
  advertiser: [
    { to: '/advertiser', label: 'Overview', icon: 'dashboard' },
    { to: '/advertiser/offers', label: 'My Offers', icon: 'offers' },
    { to: '/advertiser/stats', label: 'Stats', icon: 'chart' },
    { to: '/advertiser/api-keys', label: 'API Keys', icon: 'key' },
  ],
};
