/**
 * Integration catalog — Everflow-style card definitions per category.
 * Each card resolves `connected` from real backend state (native features or stored credentials).
 */
import { query } from '../db/pool.js';
import { getFraudConfig } from '../fraud/rules.js';
import { loadIntegrations, type IntegrationSettings } from './settings.js';

export type IntegrationCategory =
  | 'fraud' | 'suppression' | 'billing' | 'mediaBuying' | 'crm' | 'ecommerce'
  | 'payPerCall' | 'email' | 'mmp' | 'eSignature';

export interface CatalogCardDef {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** Settings key for API-key style integrations (integrations.{settingsKey}). */
  settingsKey?: string;
  badge?: 'upgrade' | 'native';
}

export interface CatalogCard extends CatalogCardDef {
  connected: boolean;
  detail: string;
}

export interface CategoryCatalog {
  connected: CatalogCard[];
  notConnected: CatalogCard[];
}

const CATALOG: Record<IntegrationCategory, CatalogCardDef[]> = {
  fraud: [
    {
      id: 'network-fraud',
      name: '24Metrics',
      tagline: 'Real-time click & conversion fraud scoring',
      description: 'Network-native fraud engine — velocity limits, datacenter detection, conversion spike alerts, and automated scanning.',
      badge: 'upgrade',
    },
    {
      id: 'ip-quality',
      name: 'IPQualityScore',
      tagline: 'IP reputation & proxy detection',
      description: 'Connect your IPQualityScore API key to enrich click fraud signals with IP reputation data.',
      settingsKey: 'ipQualityScoreApiKey',
    },
    {
      id: 'anura',
      name: 'Anura',
      tagline: 'Advanced bot & invalid traffic detection',
      description: 'Store your Anura API credentials to flag suspicious traffic alongside network fraud rules.',
      settingsKey: 'anuraApiKey',
    },
  ],
  suppression: [
    {
      id: 'traffic-controls',
      name: 'Traffic Controls',
      tagline: 'Live blacklist & whitelist on clicks',
      description: 'Block bad subs, IPs, countries, devices, and user agents — enforced on the tracking hot path.',
      badge: 'native',
    },
    {
      id: 'optizmo',
      name: 'Optizmo',
      tagline: 'Suppression list sync',
      description: 'Connect your Optizmo API key to sync opt-out and suppression lists.',
      settingsKey: 'optizmoApiKey',
    },
    {
      id: 'partner-blocking',
      name: 'Partner Traffic Blocking',
      tagline: 'Per-partner source filters',
      description: 'Block specific partner sub IDs and traffic sources on selected offers.',
      badge: 'native',
    },
  ],
  billing: [
    {
      id: 'partner-invoices',
      name: 'Partner Invoices',
      tagline: 'Accounts payable tracking',
      description: 'Create and manage partner payout invoices — track what you owe affiliates.',
      badge: 'native',
    },
    {
      id: 'advertiser-invoices',
      name: 'Advertiser Invoices',
      tagline: 'Accounts receivable tracking',
      description: 'Bill advertisers and track receivables with full invoice lifecycle.',
      badge: 'native',
    },
    {
      id: 'tipalti',
      name: 'Tipalti',
      tagline: 'Global partner payouts',
      description: 'Store Tipalti API credentials to prepare automated payout workflows.',
      settingsKey: 'tipaltiApiKey',
    },
  ],
  mediaBuying: [
    {
      id: 'facebook-capi',
      name: 'Facebook CAPI',
      tagline: 'Server-side conversion events to Meta',
      description: 'Send approved conversions to Meta Conversions API using your Pixel ID and access token.',
      settingsKey: 'fbAccessToken',
    },
    {
      id: 'pin-api',
      name: 'Pin API',
      tagline: 'Network-level API key for partners',
      description: 'User-provided API key mirrored into the Public REST API for partner and MMP integrations.',
      settingsKey: 'pinApiKey',
    },
    {
      id: 'google-ads',
      name: 'Google Ads',
      tagline: 'Offline conversion uploads',
      description: 'Store Google Ads API credentials for server-side conversion forwarding.',
      settingsKey: 'googleAdsApiKey',
    },
  ],
  crm: [
    {
      id: 'communication-hub',
      name: 'Communication Hub',
      tagline: 'Email campaigns & audiences',
      description: 'Send emails to partner and advertiser audiences using your SMTP configuration.',
      badge: 'native',
    },
    {
      id: 'salesforce',
      name: 'Salesforce',
      tagline: 'CRM sync for partners & leads',
      description: 'Store Salesforce API credentials to sync partner and lead data.',
      settingsKey: 'salesforceApiKey',
    },
    {
      id: 'hubspot',
      name: 'HubSpot',
      tagline: 'Marketing CRM integration',
      description: 'Connect HubSpot with an API key for contact and deal sync.',
      settingsKey: 'hubspotApiKey',
    },
  ],
  ecommerce: [
    {
      id: 'shopify',
      name: 'Shopify',
      tagline: 'Storefront order attribution',
      description: 'Connect your Shopify store URL and API key to attribute e-commerce sales.',
      settingsKey: 'shopifyApiKey',
    },
    {
      id: 'woocommerce',
      name: 'WooCommerce',
      tagline: 'WordPress store integration',
      description: 'Link your WooCommerce store for S2S conversion postbacks.',
      settingsKey: 'woocommerceStoreUrl',
    },
    {
      id: 'stripe',
      name: 'Stripe',
      tagline: 'Payment event webhooks',
      description: 'Store Stripe API credentials to reconcile payment events as conversions.',
      settingsKey: 'stripeApiKey',
    },
    {
      id: 'coupon-codes',
      name: 'Coupon Codes',
      tagline: 'Promo code tracking',
      description: 'Track coupon codes tied to offers and partners for e-commerce campaigns.',
      badge: 'native',
    },
  ],
  payPerCall: [
    {
      id: 'invoca',
      name: 'Invoca',
      tagline: 'Call attribution platform',
      description: 'Connect Invoca API credentials for inbound call conversion tracking.',
      settingsKey: 'invocaApiKey',
    },
    {
      id: 'ringba',
      name: 'Ringba',
      tagline: 'Pay per call routing',
      description: 'Store Ringba API key to sync call tracking data.',
      settingsKey: 'ringbaApiKey',
    },
    {
      id: 'offline-calls',
      name: 'Offline Conversions',
      tagline: 'Manual phone sale entry',
      description: 'Log phone and offline sales as manual conversions with full ledger support.',
      badge: 'native',
    },
  ],
  email: [
    {
      id: 'smtp',
      name: 'SMTP',
      tagline: 'Send from your mail server',
      description: 'Configure host, port, and credentials — powers Communication Hub email delivery.',
      badge: 'native',
    },
    {
      id: 'sendgrid',
      name: 'SendGrid',
      tagline: 'Transactional email API',
      description: 'Store your SendGrid API key as an alternative email delivery provider.',
      settingsKey: 'sendgridApiKey',
    },
    {
      id: 'mailchimp',
      name: 'Mailchimp',
      tagline: 'Email marketing sync',
      description: 'Connect Mailchimp API credentials for audience and campaign sync.',
      settingsKey: 'mailchimpApiKey',
    },
  ],
  mmp: [
    {
      id: 's2s-postback',
      name: 'S2S Postback',
      tagline: 'Server postback for MMP events',
      description: 'Point AppsFlyer, Adjust, or Branch postbacks at your tracking URL with secure code.',
      badge: 'native',
    },
    {
      id: 'appsflyer',
      name: 'AppsFlyer',
      tagline: 'Mobile attribution data',
      description: 'Store AppsFlyer API token for enhanced reporting and event sync.',
      settingsKey: 'appsflyerApiKey',
    },
    {
      id: 'adjust',
      name: 'Adjust',
      tagline: 'Flexible mobile attribution',
      description: 'Connect Adjust API credentials for install and event data.',
      settingsKey: 'adjustApiKey',
    },
    {
      id: 'branch',
      name: 'Branch',
      tagline: 'Deep linking & attribution',
      description: 'Store Branch API key for deep link and attribution data.',
      settingsKey: 'branchApiKey',
    },
  ],
  eSignature: [
    {
      id: 'docusign',
      name: 'DocuSign',
      tagline: 'Electronic signature workflows',
      description: 'Store DocuSign integration credentials for automated partner agreements.',
      settingsKey: 'docusignApiKey',
    },
    {
      id: 'hellosign',
      name: 'HelloSign',
      tagline: 'Dropbox Sign integration',
      description: 'Connect HelloSign API credentials for agreement signing.',
      settingsKey: 'hellosignApiKey',
    },
    {
      id: 'partner-agreement',
      name: 'Partner Agreement',
      tagline: 'Standard agreement template',
      description: 'Store your partner agreement document URL for reference during onboarding.',
      settingsKey: 'esignAgreementName',
    },
  ],
};

interface Counts {
  openAlerts: number;
  trafficControls: number;
  trafficBlocking: number;
  smartSwitchRules: number;
  partnerInvoices: number;
  advertiserInvoices: number;
  audiences: number;
  emailsSent: number;
  applications: number;
  couponCodes: number;
  offlineConversions: number;
  smtpConfigured: boolean;
  s2sPostback: boolean;
}

async function loadCounts(networkId: string): Promise<Counts> {
  const count = async (table: string, extra = '') => {
    const { rows } = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ${table} WHERE network_id = $1${extra}`,
      [networkId],
    );
    return Number(rows[0]?.n ?? 0);
  };
  const net = await query<{ settings: Record<string, unknown>; postback_security_code: string | null }>(
    'SELECT settings, postback_security_code FROM networks WHERE id = $1', [networkId],
  ).then((r) => r.rows[0]);
  const smtp = (net?.settings?.['smtp'] as Record<string, unknown> | undefined) ?? {};
  return {
    openAlerts: await count('alerts', " AND status = 'open'"),
    trafficControls: await count('traffic_controls', " AND status = 'active'"),
    trafficBlocking: await count('traffic_blockings'),
    smartSwitchRules: await count('smartswitch_rules', " AND status = 'active'"),
    partnerInvoices: await count('partner_invoices'),
    advertiserInvoices: await count('advertiser_invoices'),
    audiences: await count('audiences'),
    emailsSent: await count('email_messages', " AND status = 'sent'"),
    applications: await count('offer_publisher_access', " AND approval_status = 'pending'"),
    couponCodes: await count('offer_coupons'),
    offlineConversions: await count('conversions', " AND source = 'manual'"),
    smtpConfigured: Boolean(smtp['host'] && smtp['fromEmail'] && smtp['password']),
    s2sPostback: Boolean(net?.postback_security_code),
  };
}

function hasKey(integrations: IntegrationSettings, key?: string): boolean {
  if (!key) return false;
  const v = integrations[key];
  return typeof v === 'string' ? v.length > 0 : Boolean(v);
}

function resolveConnected(
  card: CatalogCardDef,
  integrations: IntegrationSettings,
  counts: Counts,
  fraudEnabled: boolean,
  scanWindowHours: number,
): { connected: boolean; detail: string } {
  if (card.settingsKey) {
    const connected = hasKey(integrations, card.settingsKey);
    return { connected, detail: connected ? 'Connected — click Configure to update.' : 'Not connected.' };
  }

  switch (card.id) {
    case 'network-fraud':
      return {
        connected: fraudEnabled || counts.openAlerts > 0,
        detail: fraudEnabled
          ? `Active — ${scanWindowHours}h scan window, ${counts.openAlerts} open alert(s).`
          : 'Enable network fraud rules to start scoring traffic.',
      };
    case 'traffic-controls':
      return {
        connected: counts.trafficControls > 0,
        detail: counts.trafficControls > 0 ? `${counts.trafficControls} active rule(s).` : 'No traffic controls configured.',
      };
    case 'partner-blocking':
      return {
        connected: counts.trafficBlocking > 0,
        detail: counts.trafficBlocking > 0 ? `${counts.trafficBlocking} blocking rule(s).` : 'No partner blocking rules yet.',
      };
    case 'partner-invoices':
      return {
        connected: counts.partnerInvoices > 0,
        detail: counts.partnerInvoices > 0 ? `${counts.partnerInvoices} invoice(s) on file.` : 'Create partner invoices to connect.',
      };
    case 'advertiser-invoices':
      return {
        connected: counts.advertiserInvoices > 0,
        detail: counts.advertiserInvoices > 0 ? `${counts.advertiserInvoices} invoice(s) on file.` : 'Create advertiser invoices to connect.',
      };
    case 'facebook-capi':
      return {
        connected: Boolean(integrations.fbPixelId && integrations.fbAccessToken),
        detail: integrations.fbAccessToken ? 'CAPI fires on approved conversions.' : 'Add Pixel ID and access token.',
      };
    case 'pin-api':
      return {
        connected: Boolean(integrations.pinApiKey),
        detail: integrations.pinApiKey ? 'Key active on Public REST API.' : 'Add a network API key.',
      };
    case 'communication-hub':
      return {
        connected: counts.emailsSent > 0 || counts.audiences > 0,
        detail: counts.emailsSent > 0 ? `${counts.emailsSent} email(s) sent.` : 'Configure SMTP then send from Communication Hub.',
      };
    case 'coupon-codes':
      return {
        connected: counts.couponCodes > 0,
        detail: counts.couponCodes > 0 ? `${counts.couponCodes} coupon code(s).` : 'Import or create coupon codes.',
      };
    case 'offline-calls':
      return {
        connected: counts.offlineConversions > 0 || Boolean(integrations.payPerCallEnabled),
        detail: counts.offlineConversions > 0 ? `${counts.offlineConversions} offline conversion(s).` : 'Log phone sales as manual conversions.',
      };
    case 'smtp':
      return {
        connected: counts.smtpConfigured,
        detail: counts.smtpConfigured ? 'SMTP configured — Communication Hub can send.' : 'Configure host, from email, and password.',
      };
    case 's2s-postback':
      return {
        connected: counts.s2sPostback,
        detail: counts.s2sPostback ? 'Postback secure code active.' : 'Generate a postback security code.',
      };
    case 'partner-agreement':
      return {
        connected: Boolean(integrations.esignAgreementName),
        detail: integrations.esignAgreementName ? `Agreement: ${integrations.esignAgreementName}` : 'Add partner agreement template.',
      };
    default:
      return { connected: false, detail: 'Not connected.' };
  }
}

export async function getCategoryCatalog(networkId: string, category: IntegrationCategory): Promise<CategoryCatalog> {
  const [integrations, fraudCfg, counts] = await Promise.all([
    loadIntegrations(networkId),
    getFraudConfig(networkId),
    loadCounts(networkId),
  ]);

  const cards: CatalogCard[] = (CATALOG[category] ?? []).map((def) => {
    const { connected, detail } = resolveConnected(def, integrations, counts, fraudCfg.enabled, fraudCfg.scanWindowHours);
    return { ...def, connected, detail };
  });

  return {
    connected: cards.filter((c) => c.connected),
    notConnected: cards.filter((c) => !c.connected),
  };
}

export async function getAllCatalogs(networkId: string): Promise<Record<IntegrationCategory, CategoryCatalog>> {
  const categories = Object.keys(CATALOG) as IntegrationCategory[];
  const entries = await Promise.all(categories.map(async (c) => [c, await getCategoryCatalog(networkId, c)] as const));
  return Object.fromEntries(entries) as Record<IntegrationCategory, CategoryCatalog>;
}

export function categoryFromTab(tab: string): IntegrationCategory | null {
  const map: Record<string, IntegrationCategory> = {
    'Fraud Detection': 'fraud',
    'Suppression List': 'suppression',
    Billing: 'billing',
    'Media Buying': 'mediaBuying',
    CRM: 'crm',
    'E-Commerce': 'ecommerce',
    'Pay Per Call': 'payPerCall',
    Email: 'email',
    MMP: 'mmp',
    'E-Signature': 'eSignature',
  };
  return map[tab] ?? null;
}

/** Card id → configure handler hint for the frontend. */
export const CARD_CONFIGURE: Record<string, { type: 'api-key' | 'fraud-rules' | 'smtp' | 'link' | 'facebook' | 'pin' | 'agreement' | 'shopify'; link?: string; settingsKey?: string; label?: string }> = {
  'network-fraud': { type: 'fraud-rules' },
  'ip-quality': { type: 'api-key', settingsKey: 'ipQualityScoreApiKey', label: 'API Key' },
  anura: { type: 'api-key', settingsKey: 'anuraApiKey', label: 'API Key' },
  'traffic-controls': { type: 'link', link: '/app/offers-traffic-controls' },
  optizmo: { type: 'api-key', settingsKey: 'optizmoApiKey', label: 'API Key' },
  'partner-blocking': { type: 'link', link: '/app/aff-traffic-blocking' },
  'partner-invoices': { type: 'link', link: '/app/aff-invoices' },
  'advertiser-invoices': { type: 'link', link: '/app/adv-invoices' },
  tipalti: { type: 'api-key', settingsKey: 'tipaltiApiKey', label: 'API Key' },
  'facebook-capi': { type: 'facebook' },
  'pin-api': { type: 'pin' },
  'google-ads': { type: 'api-key', settingsKey: 'googleAdsApiKey', label: 'API Key' },
  'communication-hub': { type: 'link', link: '/app/communication-hub' },
  salesforce: { type: 'api-key', settingsKey: 'salesforceApiKey', label: 'API Key' },
  hubspot: { type: 'api-key', settingsKey: 'hubspotApiKey', label: 'API Key' },
  shopify: { type: 'shopify' },
  woocommerce: { type: 'api-key', settingsKey: 'woocommerceStoreUrl', label: 'Store URL' },
  stripe: { type: 'api-key', settingsKey: 'stripeApiKey', label: 'API Key' },
  'coupon-codes': { type: 'link', link: '/app/aff-coupons' },
  invoca: { type: 'api-key', settingsKey: 'invocaApiKey', label: 'API Key' },
  ringba: { type: 'api-key', settingsKey: 'ringbaApiKey', label: 'API Key' },
  'offline-calls': { type: 'link', link: '/app/reports/conversion-imports' },
  smtp: { type: 'smtp' },
  sendgrid: { type: 'api-key', settingsKey: 'sendgridApiKey', label: 'API Key' },
  mailchimp: { type: 'api-key', settingsKey: 'mailchimpApiKey', label: 'API Key' },
  's2s-postback': { type: 'link', link: '/app/adv-debug-postback' },
  appsflyer: { type: 'api-key', settingsKey: 'appsflyerApiKey', label: 'API Token' },
  adjust: { type: 'api-key', settingsKey: 'adjustApiKey', label: 'API Token' },
  branch: { type: 'api-key', settingsKey: 'branchApiKey', label: 'API Key' },
  docusign: { type: 'api-key', settingsKey: 'docusignApiKey', label: 'Integration Key' },
  hellosign: { type: 'api-key', settingsKey: 'hellosignApiKey', label: 'API Key' },
  'partner-agreement': { type: 'agreement' },
};
