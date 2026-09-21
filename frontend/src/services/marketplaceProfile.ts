/** Real vocabularies for Marketplace › Your Profile(s), mirroring the backend whitelist
 * (api-backend/src/surfaces/dashboard/marketplace-profile/routes.ts) confirmed against the live
 * reference's Edit form. */
export const PAYOUT_TYPES = [
  'Commission Per Sale', 'Revenue Share', 'Cost Per Install', 'Cost Per Action',
  'Cost Per Lead', 'Cost Per Click', 'Flat Fee', '% of Media Spend',
] as const;
export const PROMOTIONAL_METHODS = [
  'Email', 'Coupon', 'Deal Site', 'Search', 'Social Media', 'Display', 'Native Ads', 'SMS', 'Incentive',
] as const;
export const DEVICE_TYPES = ['PC', 'Mobile', 'Tablet'] as const;
export const MARKETPLACE_CATEGORIES = [
  'Adult & Dating', 'Airlines & Hotels', 'Assistive Care', 'Beauty & Personal Care',
  'Education & Career', 'Electronics', 'Entertainment & Gaming', 'Fashion, Apparel, & Accessories',
  'Financial Growth & Investments', 'Health & Wellness (General)', 'Tourist Attractions & Activities',
  'Travel Gear & Accessories',
] as const;
export const CONVERSION_FUNNEL_EXPERTISE = [
  'Single Step', 'Multi-Step / Upsell', 'Subscription', 'Free Trial',
] as const;
