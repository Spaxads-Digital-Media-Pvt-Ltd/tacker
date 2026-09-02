/**
 * Aggregated integration connection status — powers Integrations hub tabs with real backend counts.
 */
import { query } from '../db/pool.js';
import { getFraudConfig } from '../fraud/rules.js';
import { loadIntegrations } from './settings.js';

async function countTable(networkId: string, table: string, extraWhere = ''): Promise<number> {
  const { rows } = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ${table} WHERE network_id = $1${extraWhere}`,
    [networkId],
  );
  return Number(rows[0]?.n ?? 0);
}

async function countConversionImports(networkId: string): Promise<number> {
  const { rows } = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM import_export_logs
      WHERE network_id = $1 AND kind = 'import' AND entity = 'conversions'`,
    [networkId],
  );
  return Number(rows[0]?.n ?? 0);
}

export interface CategoryStatus {
  connected: boolean;
  [key: string]: unknown;
}

export interface IntegrationStatusResponse {
  fraud: CategoryStatus & { rulesEnabled: boolean; openAlerts: number; trafficControls: number; smartSwitchRules: number };
  suppression: CategoryStatus & { trafficControls: number; trafficBlocking: number };
  billing: CategoryStatus & { partnerInvoices: number; advertiserInvoices: number };
  crm: CategoryStatus & { audiences: number; emailsSent: number; applications: number };
  ecommerce: CategoryStatus & { couponCodes: number; customerValueRules: number; conversionImports: number };
  payPerCall: CategoryStatus & { offlineConversions: number; s2sPostback: boolean };
  email: CategoryStatus & { smtpConfigured: boolean; emailsSent: number; templates: number };
  eSignature: CategoryStatus & { agreementName: string | null };
  mmp: CategoryStatus & { s2sPostback: boolean; advertiserApi: boolean };
  mediaBuying: CategoryStatus & { facebookCapi: boolean; pinApi: boolean };
  feeds: CategoryStatus & { offerFeed: boolean };
}

export async function getIntegrationStatus(networkId: string): Promise<IntegrationStatusResponse> {
  const [
    fraudCfg,
    integrations,
    netRow,
    openAlerts,
    trafficControls,
    trafficBlocking,
    smartSwitchRules,
    partnerInvoices,
    advertiserInvoices,
    audiences,
    emailsSent,
    applications,
    couponCodes,
    customerValueRules,
    conversionImports,
    offlineConversions,
    emailTemplates,
  ] = await Promise.all([
    getFraudConfig(networkId),
    loadIntegrations(networkId),
    query<{ settings: Record<string, unknown>; postback_security_code: string | null }>(
      'SELECT settings, postback_security_code FROM networks WHERE id = $1',
      [networkId],
    ).then((r) => r.rows[0]),
    countTable(networkId, 'alerts', " AND status = 'open'"),
    countTable(networkId, 'traffic_controls', " AND status = 'active'"),
    countTable(networkId, 'traffic_blockings'),
    countTable(networkId, 'smartswitch_rules', " AND status = 'active'"),
    countTable(networkId, 'partner_invoices'),
    countTable(networkId, 'advertiser_invoices'),
    countTable(networkId, 'audiences'),
    countTable(networkId, 'email_messages', " AND status = 'sent'"),
    countTable(networkId, 'offer_publisher_access', " AND approval_status = 'pending'"),
    countTable(networkId, 'offer_coupons'),
    countTable(networkId, 'customer_value_rules', " AND status = 'active'"),
    countConversionImports(networkId),
    countTable(networkId, 'conversions', " AND source = 'manual'"),
    countTable(networkId, 'email_templates'),
  ]);

  const smtp = (netRow?.settings?.['smtp'] as Record<string, unknown> | undefined) ?? {};
  const smtpConfigured = Boolean(smtp['host'] && smtp['fromEmail'] && smtp['password']);
  const facebookCapi = Boolean(integrations.fbPixelId && integrations.fbAccessToken);
  const pinApi = Boolean(integrations.pinApiKey);
  const offerFeed = Boolean(integrations.offerFeedUrl);
  const s2sPostback = Boolean(netRow?.postback_security_code);
  const agreementName = (integrations.esignAgreementName as string) ?? null;

  const fraudConnected = fraudCfg.enabled || openAlerts > 0 || trafficControls > 0 || smartSwitchRules > 0;
  const suppressionConnected = trafficControls > 0 || trafficBlocking > 0;
  const billingConnected = partnerInvoices > 0 || advertiserInvoices > 0;
  const crmConnected = audiences > 0 || emailsSent > 0 || applications > 0;
  const ecommerceConnected = couponCodes > 0 || customerValueRules > 0 || conversionImports > 0
    || Boolean(integrations.ecommerceApiEnabled);
  const payPerCallConnected = offlineConversions > 0 || Boolean(integrations.payPerCallEnabled) || s2sPostback;
  const emailConnected = smtpConfigured || emailsSent > 0;
  const eSignatureConnected = Boolean(agreementName);
  const mmpConnected = s2sPostback || pinApi || Boolean(integrations.mmpPostbackUrl);
  const mediaBuyingConnected = facebookCapi || pinApi;
  const feedsConnected = offerFeed;

  return {
    fraud: { connected: fraudConnected, rulesEnabled: fraudCfg.enabled, openAlerts, trafficControls, smartSwitchRules },
    suppression: { connected: suppressionConnected, trafficControls, trafficBlocking },
    billing: { connected: billingConnected, partnerInvoices, advertiserInvoices },
    crm: { connected: crmConnected, audiences, emailsSent, applications },
    ecommerce: { connected: ecommerceConnected, couponCodes, customerValueRules, conversionImports },
    payPerCall: { connected: payPerCallConnected, offlineConversions, s2sPostback },
    email: { connected: emailConnected, smtpConfigured, emailsSent, templates: emailTemplates },
    eSignature: { connected: eSignatureConnected, agreementName },
    mmp: { connected: mmpConnected, s2sPostback, advertiserApi: pinApi },
    mediaBuying: { connected: mediaBuyingConnected, facebookCapi, pinApi },
    feeds: { connected: feedsConnected, offerFeed },
  };
}
