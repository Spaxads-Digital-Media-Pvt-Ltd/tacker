/**
 * Automated System Emails (Communication Hub › Settings) — the events the platform can email about,
 * each with an on/off toggle stored per network (settings.communicationHub.systemEmails; default on).
 * `SENT_SYSTEM_EMAILS` are the ones that actually send (F-24 transactional layer; the partner
 * notifications in lib/email/notifications.ts and the alert emails, O11). The rest have no send
 * behind them, so the API leaves them out of the list (O11: hidden until they're wired).
 */
export const SYSTEM_EMAIL_CATALOG = [
  { key: 'partner_signup_approved', label: 'Partner Sign-Up Approved', category: 'partner' },
  { key: 'partner_signup_rejected', label: 'Partner Sign-Up Rejected', category: 'partner' },
  { key: 'offer_application_approved', label: 'Offer Application Approved', category: 'partner' },
  { key: 'offer_application_denied', label: 'Offer Application Denied', category: 'partner' },
  { key: 'new_offer_creative_available', label: 'New Offer Creative Available', category: 'partner' },
  { key: 'partner_offer_now_available', label: 'Partner Offer Now Available', category: 'partner' },
  { key: 'partner_offer_now_unavailable', label: 'Partner Offer Now Unavailable', category: 'partner' },
  { key: 'partner_invoice_generated', label: 'Partner Invoice Generated', category: 'partner' },
  { key: 'advertiser_invoice_generated', label: 'Advertiser Invoice Generated', category: 'advertiser' },
  { key: 'advertiser_postback_received', label: 'Advertiser Postback Received', category: 'advertiser' },
  { key: 'new_conversion_recorded', label: 'New Conversion Recorded', category: 'advertiser' },
  { key: 'alert_threshold_triggered', label: 'Alert Threshold Triggered', category: 'misc' },
  { key: 'payout_batch_completed', label: 'Payout Batch Completed', category: 'misc' },
  { key: 'fraud_rule_triggered', label: 'Fraud Rule Triggered', category: 'misc' },
  // F-24: sent by the transactional layer.
  { key: 'partner_portal_invite', label: 'Partner Portal Invite', category: 'partner' },
  { key: 'advertiser_portal_invite', label: 'Advertiser Portal Invite', category: 'advertiser' },
  { key: 'partner_balance_request', label: 'Outstanding Balance Request', category: 'partner' },
  { key: 'offer_details_shared', label: 'Offer Details Shared', category: 'partner' },
] as const;

export type SystemEmailKey = (typeof SYSTEM_EMAIL_CATALOG)[number]['key'];

export const SENT_SYSTEM_EMAILS: ReadonlySet<SystemEmailKey> = new Set<SystemEmailKey>([
  'partner_portal_invite', 'advertiser_portal_invite', 'partner_balance_request', 'offer_details_shared',
  'partner_invoice_generated', 'advertiser_invoice_generated',
  // O11: partner notifications (lib/email/notifications.ts) and the alert emails (lib/alerts/deliver.ts).
  'partner_signup_approved', 'partner_signup_rejected', 'offer_application_approved', 'offer_application_denied',
  'new_offer_creative_available', 'partner_offer_now_available', 'partner_offer_now_unavailable',
  'payout_batch_completed', 'alert_threshold_triggered', 'fraud_rule_triggered',
]);

/** The toggles shown: only emails that actually send (unwired ones stay hidden until they are). */
export const VISIBLE_SYSTEM_EMAILS = SYSTEM_EMAIL_CATALOG.filter((e) => SENT_SYSTEM_EMAILS.has(e.key));
