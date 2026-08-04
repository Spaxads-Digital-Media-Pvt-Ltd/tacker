import type { Role } from '../auth/roles';
import { Icon } from './icons';

export interface NavLeaf { to: string; label: string; icon?: keyof typeof Icon }
export interface NavEntry {
  label: string;
  icon: keyof typeof Icon;
  to?: string;              // leaf link
  children?: NavLeaf[];     // expandable group
}

/**
 * Per-surface navigation (spec §0), Everflow-style with expandable section groups for admins.
 * Publishers never see revenue/margin views; advertisers see only their own offers/stats — UX
 * shaping only; the backend still enforces every read.
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
      label: 'Offers', icon: 'offers', children: [
        { to: '/app/offers', label: 'Offers' },
        { to: '/app/offers/new', label: 'Create Offer' },
        { to: '/app/offers-access', label: 'Affiliate Access' },
        { to: '/app/offers-tags', label: 'Tags' },
        { to: '/app/offers-creatives', label: 'Creatives' },
        { to: '/app/offers-coupons', label: 'Coupon Codes' },
        { to: '/app/offers-deals', label: 'Deals' },
      ],
    },
    { to: '/app/smart-links', label: 'Smart Offers', icon: 'spark' },
    {
      label: 'Reports', icon: 'chart', children: [
        { to: '/app/reports/offer', label: 'Offer Report' },
        { to: '/app/reports/affiliate', label: 'Affiliate Report' },
        { to: '/app/reports/advertiser', label: 'Advertiser Report' },
        { to: '/app/reports/daily', label: 'Daily Report' },
        { to: '/app/reports/goals', label: 'Goals Report' },
        { to: '/app/reports/smartlink', label: 'Smart Link Report' },
        { to: '/app/reports/custom', label: 'Custom Report' },
        { to: '/app/reports/clicks', label: 'Clicks Report' },
        { to: '/app/reports/conversions', label: 'Conversions Report' },
        { to: '/app/reports/cap', label: 'Cap Report' },
        { to: '/app/reports/postback-logs', label: 'Postback Logs Report' },
        { to: '/app/reports/offline', label: 'Offline Report' },
        { to: '/app/reports/import-export', label: 'Import & Export Logs' },
      ],
    },
    {
      label: 'Affiliates', icon: 'users', children: [
        { to: '/app/publishers', label: 'All Affiliates' },
        { to: '/app/publishers/new', label: 'Create Affiliate' },
        { to: '/app/aff-postbacks', label: 'Postbacks' },
        { to: '/app/aff-postback-test', label: 'Postbacks Test' },
        { to: '/app/aff-custom-fields', label: 'Custom Fields' },
        { to: '/app/aff-tags', label: 'Tags' },
      ],
    },
    {
      label: 'Advertisers', icon: 'building', children: [
        { to: '/app/advertisers', label: 'All Advertisers' },
        { to: '/app/advertisers/new', label: 'Create Advertiser' },
        { to: '/app/adv-custom-fields', label: 'Custom Fields' },
        { to: '/app/adv-tags', label: 'Tags' },
        { to: '/app/adv-debug-postback', label: 'Debug Postback' },
      ],
    },
    { to: '/app/domains', label: 'Domains', icon: 'key' },
    { to: '/app/payouts', label: 'Payouts', icon: 'wallet' },
    { to: '/app/invoices', label: 'Invoices', icon: 'wallet' },
    { to: '/app/integrations', label: 'Integrations', icon: 'spark' },
    { to: '/app/alerts', label: 'Alerts', icon: 'alert' },
    { to: '/app/ai', label: 'AI Chat', icon: 'spark' },
    { to: '/app/settings', label: 'Settings', icon: 'key' },
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
