/** Frontend mirrors of the backend audience DTOs (admin view). Read-only shapes for rendering. */
export interface Advertiser {
  id: string;
  ref?: number;
  name: string;
  status: 'active' | 'pending' | 'inactive';
  contactEmail: string | null;
  billingTerms: string | null;
  defaultCurrency: string;
  accountManagerId?: string | null;
  salesManagerId?: string | null;
  billingFrequency?: string | null;
  verificationToken?: string | null;
  hasPortalAccount?: boolean;
  customFields?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
}

export interface Publisher {
  id: string;
  ref?: number;
  name: string;
  status: 'active' | 'pending' | 'inactive';
  contactEmail: string | null;
  trafficSource: string | null;
  payoutTerms: string | null;
  defaultAttributionWindowS?: number;
  country?: string | null;
  paymentMethod?: string | null;
  billingFrequency?: string | null;
  tier?: string | null;
  partnerManagerId?: string | null;
  accountExecutiveId?: string | null;
  referredById?: string | null;
  /** Control Center channel (segmentation_channels id) + its name when the API joined it. */
  channelId?: string | null;
  channelName?: string | null;
  /** Referring partner's name — present on paged list rows (GET /api/publishers?paged=1). */
  referredByName?: string | null;
  contactName?: string | null;
  taxId?: string | null;
  website?: string | null;
  notes?: string | null;
  hasPortalAccount?: boolean;
  customFields?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
}

export interface DashboardUser {
  id: string; ref?: number; name: string; email: string; role: string; status: string;
  businessUnit?: string | null; partnerManager?: boolean; advertiserManager?: boolean;
  primaryPhone?: string | null; title?: string | null; superUser?: boolean;
  /** A login exists for them (Resend invite / password reset act on it). */
  hasLogin?: boolean;
  createdAt: string; updatedAt: string;
}

export interface Offer {
  id: string;
  /** Settings that stop the offer getting traffic (GET /api/offers/:id only — lib/offer-settings/warnings.ts). */
  configWarnings?: string[];
  ref?: number;
  advertiserId: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  destinationUrl: string;
  payoutModel: 'CPA' | 'CPL' | 'CPC' | 'CPI' | 'CPM' | 'RevShare';
  defaultPayout: string;
  defaultRevenue: string;
  currency: string;
  objective?: 'conversions' | 'sale' | 'app_installs' | 'leads' | 'impressions' | 'clicks';
  visibility?: 'public' | 'private' | 'ask';
  category?: string | null;
  previewUrl?: string | null;
  attributionWindowS?: number;
  dedupWindowS?: number;
  dailyConversionCap?: number | null;
  totalConversionCap?: number | null;
  dailyClickCap?: number | null;
  /** When this offer's daily caps reset (IANA zone); null = the network's cap time zone. */
  capTimezone?: string | null;
  allowedTrafficTypes?: string[];
  fallbackUrl?: string | null;
  description?: string | null;
  notes?: string[];
  securityCode?: string | null;
  /** A per-offer security code exists (shown to every role). */
  securityCodeSet?: boolean;
  /** The caller's role can't see security codes (finance / read-only, O5): `securityCode` is null. */
  securityCodeHidden?: boolean;
  trackingDomainId?: string | null;
  linkingType?: 'redirect' | 'redirect_direct' | null;
  /** The advertiser's / MMP's impression URL: /impression sends the browser there with {imp_id}; null = a pixel. */
  impressionUrl?: string | null;
  deepLinkEnabled?: boolean | null;
  firePartnerPostback?: boolean | null;
  appIdentifier?: string | null;
  /** @deprecated derived from emailSettings.suppression.enabled server-side — kept for API back-compat. */
  suppressionFileEnabled?: boolean;
  /** @deprecated derived from emailSettings.optOut.enabled server-side — kept for API back-compat. */
  emailOptOutEnabled?: boolean;
  internalNotes?: string | null;
  productId?: string | null;
  thumbnailUrl?: string | null;
  targeting?: OfferTargeting;
  attributionSettings?: OfferAttributionSettings;
  revenueSettings?: OfferRevenueSettings;
  emailSettings?: OfferEmailSettings;
  createdAt: string;
  updatedAt?: string;
  /** Joined advertiser fields — present on paged list rows (GET /api/offers?paged=1). */
  advertiserName?: string | null;
  advertiserRef?: number | null;
  advertiserAccountManagerId?: string | null;
  advertiserSalesManagerId?: string | null;
}

/** Paged entity list (GET /api/offers|publishers|advertisers?paged=1): one page of the filtered,
 * sorted set + the filtered total + badge counts (e.g. counts.statuses.active, counts.tabs.pending). */
export interface PagedList<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, Record<string, number> | undefined>;
}

export const TARGETING_KEYS = [
  'platform', 'browser', 'deviceBrand', 'osVersion', 'language',
  'country', 'region', 'city', 'dma', 'mobileCarrier', 'isp',
  'zip', 'ipExact', 'ipRange',
] as const;
export type TargetingKey = (typeof TARGETING_KEYS)[number];
export interface TargetingRule { mode: 'include' | 'exclude'; values: string[] }
export type OfferTargeting = Partial<Record<TargetingKey, TargetingRule>>;

export interface OfferAttributionSettings {
  tracker24: { enabled: boolean; trackerId: string | null };
  ipqs: { enabled: boolean };
  throttle: { enabled: boolean; ratePct: number };
  clickToConversion: { enabled: boolean; minSeconds: number; maxSeconds: number | null };
  emailOwnership: boolean;
  /** Email Ownership: 'first' partner keeps the customer, or the 'last' converting partner takes it over. */
  emailOwnershipMethod?: 'first' | 'last';
  /** Ownership ends this many days after it began ('static') or after the latest conversion ('dynamic'); null = never. */
  emailOwnershipWindowDays?: number | null;
  emailOwnershipWindowMode?: 'static' | 'dynamic';
  viewThrough: boolean;
  /** How long after an impression a click-less conversion is credited to it (hours, default 24). */
  viewThroughWindowHours?: number;
  serverSideClick: boolean;
}

/** How many conversions one click may produce for an event (backend lib/offer-settings DuplicateMode). */
export type DuplicateMode = 'one_per_click' | 'unique_txn' | 'every_postback';

export interface OfferRevenueSettings {
  baseEventName: string | null;
  manualApproval: boolean;
  /** Kept in step with duplicateMode (false ⇔ 'one_per_click') for older API clients. */
  allowDuplicates: boolean;
  duplicateMode: DuplicateMode;
  /** More conversions than this from one click within 10 minutes are held as pending for review; null / 0 = no limit. */
  clickConversionLimit: number | null;
  revenueAction: 'impression' | 'click' | 'conversion';
  revenueType: 'fixed' | 'percentage' | 'mixed';
  revenuePct: number | null;
  pricePerProduct: boolean;
}

export interface OfferEmailSettings {
  suppression: { enabled: boolean; fileUrl: string | null };
  ezepo: { enabled: boolean };
  optizmo: { enabled: boolean; listId: string | null };
  instructions: { enabled: boolean; text: string | null };
  optOut: { enabled: boolean; url: string | null };
}

export interface Postback {
  id: string;
  publisherId: string | null;
  publisherName: string | null;
  offerId: string | null;
  offerName: string | null;
  scope: 'specific' | 'global' | 'global_offer';
  postbackType: 'conversion' | 'event' | 'cpc';
  deliveryMethod: 'postback' | 'html' | 'meta' | 'tiktok' | 'snapchat' | 'rumble';
  htmlCode: string | null;
  description: string | null;
  delay: string | null;
  event: string | null;
  url: string | null;
  method: 'GET' | 'POST';
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

export interface PartnerTierPreview { id: string; ref?: number; name: string }

export interface PartnerTier {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'deleted';
  description: string | null;
  marginPct: number;
  isDefault: boolean;
  labels: string[];
  partners: PartnerTierPreview[];
  partnersTotal: number;
  /** Every member publisher id (list endpoint). Optional until the backend ships it — fall back to `partners` (preview). */
  memberIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PartnerTierMember { id: string; ref?: number; name: string; status: string }

export interface PartnerTierOffer {
  id: string;
  offerId: string;
  offerRef?: number;
  offerName: string;
  applyMargin: boolean;
  autoApprovePartners: boolean;
}

export interface OfferApplication {
  id: string;
  status: 'approved' | 'pending' | 'rejected';
  access: 'allow' | 'deny';
  publisherId: string;
  publisherRef?: number;
  publisherName: string;
  offerId: string;
  offerRef?: number;
  offerName: string;
  partnerManagerId: string | null;
  partnerManagerName: string | null;
  questionnaireId: string | null;
  questionnaireName: string | null;
  requestDate: string;
  latestUpdate: string;
}


export interface PublisherOffer {
 id: string;
 name: string;
 status: 'draft' | 'active' | 'paused' | 'archived';
 payoutModel: 'CPA' | 'CPL' | 'CPC' | 'CPI' | 'CPM' | 'RevShare';
 payout: string;
 currency: string;
 trackingUrl: string | null;
 access: 'allow' | 'deny' | null;
 approvalStatus: 'approved' | 'pending' | 'rejected' | null;
 destinationUrl: string;
 description: string | null;
 previewUrl: string | null;
 objective: 'conversions' | 'sale' | 'app_installs' | 'leads' | 'impressions' | 'clicks' | null;
 visibility: 'public' | 'private' | 'ask';
 category: string | null;
 allowedTrafficTypes: string[];
 fallbackUrl: string | null;
 attributionWindowS: number;
 dedupWindowS: number;
 dailyClickCap: number | null;
 dailyConversionCap: number | null;
 totalConversionCap: number | null;
 trackingDomainId: string | null;
 createdAt: string;
}

export interface AdvertiserOffer {
 id: string;
 ref?: number;
 name: string;
 status: 'draft' | 'active' | 'paused' | 'archived';
 payoutModel: 'CPA' | 'CPL' | 'CPC' | 'CPI' | 'CPM' | 'RevShare';
 revenue: string;
 currency: string;
 destinationUrl: string;
 description: string | null;
 previewUrl: string | null;
 objective: 'conversions' | 'sale' | 'app_installs' | 'leads' | 'impressions' | 'clicks' | null;
 visibility: 'public' | 'private' | 'ask';
 category: string | null;
 allowedTrafficTypes: string[];
 fallbackUrl: string | null;
 attributionWindowS: number;
 dedupWindowS: number;
 dailyClickCap: number | null;
 dailyConversionCap: number | null;
 totalConversionCap: number | null;
 trackingDomainId: string | null;
 trackingUrl: string | null;
 createdAt: string;
 updatedAt: string;
}

export type QuestionnaireDataField = 'checkbox' | 'date_input' | 'input' | 'numeric_input' | 'select' | 'textarea';

export interface QuestionnaireField {
  id: string;
  position: number;
  label: string;
  required: boolean;
  tooltip: string | null;
  dataField: QuestionnaireDataField;
  options: string[];
}

export interface QuestionnaireListItem {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  questions: string[];
  offers: string[];
  /** Same order as `offers`; optional only for responses from older servers. */
  offerIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Questionnaire {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  fields: QuestionnaireField[];
  createdAt: string;
  updatedAt: string;
}

export type TrafficBlockingFieldKey = 'sub1' | 'sub2' | 'sub3' | 'sub4' | 'sub5' | 'sub6' | 'sub7' | 'sub8' | 'sub9' | 'sub10' | 'sourceId';
export type TrafficBlockingMatchType = 'begins_with' | 'contains' | 'does_not_contain' | 'does_not_match' | 'ends_with' | 'exact_match' | 'is_empty';

export interface TrafficBlockingFilterEntry { matchType: TrafficBlockingMatchType; value: string | null }

export interface TrafficBlocking {
  id: string;
  publisherId: string;
  publisherRef?: number;
  publisherName: string;
  offerId: string;
  offerRef?: number;
  offerName: string;
  status: 'active' | 'inactive';
  filters: Partial<Record<TrafficBlockingFieldKey, TrafficBlockingFilterEntry>>;
  filterSummary: Record<TrafficBlockingFieldKey, string | null>;
  createdAt: string;
  updatedAt: string;
}

export interface TrafficSourceParam { parameter: string; value: string }

export interface TrafficSource {
  id: string;
  name: string;
  enablePostback: boolean;
  postbackUrl: string | null;
  visibleToPartners: boolean;
  parameters: TrafficSourceParam[];
  trackingLinkParameters: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdjustmentMetrics {
  revenue: number; payout: number; grossSales: number;
  totalClicks: number; uniqueClicks: number; conversions: number; impressions: number;
}

export interface ReportingAdjustment {
  id: string;
  publisherId: string;
  publisherRef?: number;
  publisherName: string;
  offerId: string;
  offerRef?: number;
  offerName: string;
  advertiserName: string | null;
  dateFrom: string;
  dateTo: string;
  original: AdjustmentMetrics;
  adjusted: AdjustmentMetrics;
  lastModifiedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportingAdjustmentDayOverride {
  date: string;
  revenue?: number; payout?: number; grossSales?: number;
  totalClicks?: number; uniqueClicks?: number; conversions?: number; impressions?: number;
  notes?: string | null;
}

export interface ReportingAdjustmentDay {
  date: string;
  original: AdjustmentMetrics;
  adjusted: AdjustmentMetrics & { margin: number; cvr: number; profit: number };
  override: ReportingAdjustmentDayOverride | null;
  notes: string | null;
}

export interface ReportingAdjustmentDetail {
  id: string;
  publisherId: string;
  publisherName: string;
  offerId: string;
  offerName: string;
  advertiserName: string | null;
  dateFrom: string;
  dateTo: string;
  days: ReportingAdjustmentDay[];
  createdAt: string;
  updatedAt: string;
}

export interface CouponCode {
  id: string;
  code: string;
  status: 'active' | 'expired' | 'disabled';
  publisherId: string | null;
  publisherRef?: number | null;
  publisherName: string | null;
  offerId: string;
  offerRef?: number;
  offerName: string;
  description: string | null;
  discount: string | null;
  notes: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PartnerInvoice {
  id: string;
  ref: number;
  publisherId: string;
  publisherRef?: number;
  publisherName: string;
  /** 'void' = voided unpaid invoice (O8); 'deleted' only on rows soft-deleted before that. */
  status: 'unpaid' | 'paid' | 'void' | 'deleted';
  visibleToPartner: boolean;
  paymentTerms: string | null;
  paymentMethod: string | null;
  currency: string;
  periodStart: string;
  periodEnd: string;
  billedAmount: string;
  paymentsAmount: string;
  balance: string;
  paidAt: string | null;
  publicNotes: string | null;
  internalNotes: string | null;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PartnerInvoiceSummary {
  currency: string; billedAmount: string; paymentsAmount: string; balance: string; otherCurrencies: string[];
  /** Every currency's own totals (O4). */
  byCurrency?: { currency: string; billedAmount: string; paymentsAmount: string; balance: string }[];
}

export interface PartnerInvoiceLedgerEntry {
  id: string;
  entryType: string;
  direction: 'credit' | 'debit';
  amount: string;
  currency: string;
  conversionId: string | null;
  createdAt: string;
}

export interface LinkTemplate {
  id: string;
  ref: number;
  advertiserId: string;
  advertiserRef?: number;
  advertiserName: string;
  name: string;
  destinationUrl: string;
  createdAt: string;
  updatedAt: string;
}

export type PostbackControlVariable = 'event' | 'payout' | 'revenue' | 'source' | 'sub1' | 'sub2' | 'sub3' | 'sub4' | 'sub5';
export type PostbackControlOperator = 'equals' | 'not_equals' | 'contains' | 'is_empty' | 'greater_than' | 'less_than';
export interface PostbackControlRule { variable: PostbackControlVariable; operator: PostbackControlOperator; value: string }

export interface PostbackControl {
  id: string;
  ref: number;
  name: string;
  status: 'active' | 'inactive';
  effectiveStart: string | null;
  effectiveEnd: string | null;
  controlType: 'accept' | 'reject' | 'hold';
  targetType: 'offer' | 'advertiser' | null;
  targetIds: string[];
  partnerIds: string[];
  conditionLogic: 'all' | 'any';
  rules: PostbackControlRule[];
  createdAt: string;
  updatedAt: string;
}

export interface AdvertiserInvoice {
  id: string;
  ref: number;
  advertiserId: string;
  advertiserRef?: number;
  advertiserName: string;
  /** 'void' = voided unpaid invoice (O8); 'deleted' only on rows soft-deleted before that. */
  status: 'unpaid' | 'paid' | 'void' | 'deleted';
  visibleToAdvertiser: boolean;
  paymentTerms: string | null;
  currency: string;
  periodStart: string;
  periodEnd: string;
  billedAmount: string;
  paidAmount: string;
  balance: string;
  paidAt: string | null;
  notes: string | null;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdvertiserInvoiceSummary {
  currency: string; billedAmount: string; paidAmount: string; balance: string; otherCurrencies: string[];
  /** Every currency's own totals (O4). */
  byCurrency?: { currency: string; billedAmount: string; paidAmount: string; balance: string }[];
}

export interface AdvertiserInvoiceLedgerEntry {
  id: string;
  entryType: string;
  direction: 'credit' | 'debit';
  amount: string;
  currency: string;
  conversionId: string | null;
  createdAt: string;
}

export type TieredVariable = 'conversion' | 'total_payout' | 'total_revenue';
export type TieredAction = 'decrease_flat' | 'decrease_pct' | 'increase_flat' | 'increase_pct';
export type TimePeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'global';
export interface TieredGoal { variable: TieredVariable; minValue: number; maxValue: number | null }

export interface TieredCommission {
  id: string;
  ref: number;
  name: string;
  status: 'active' | 'inactive';
  notes: string | null;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  targetType: 'offer' | 'advertiser';
  targetIds: string[];
  partnerIds: string[];
  timePeriod: TimePeriod;
  retroactiveMode: 'disabled' | 'enabled' | 'custom';
  goals: TieredGoal[];
  payoutEnabled: boolean;
  payoutAction: TieredAction | null;
  payoutValue: string | null;
  revenueEnabled: boolean;
  revenueAction: TieredAction | null;
  revenueValue: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TieredCommissionSummaryRow {
  publisherId: string;
  publisherName: string;
  offerId: string;
  offerName: string;
  conversions: number;
  revenue: string;
  payout: string;
}

export interface TrackingDomain {
  id: string;
  ref: number;
  host: string;
  mode: 'subdomain' | 'custom';
  status: 'pending' | 'active' | 'disabled';
  verificationState: 'unverified' | 'pending' | 'verified' | 'failed';
  sslStatus: 'none' | 'pending' | 'issued' | 'error';
  isPrimary: boolean;
  /** The domain links use when an offer / smart link has none of its own — set by the API (backend
   * lib/tracking-domains/default-host.ts): the primary if active, else the domain the tracking server is live
   * on, else another real domain; localhost / 127.0.0.1 last. */
  isDefault?: boolean;
  /** Custom hosts: the DNS TXT record that verifies them (F-15). */
  dnsRecord?: { type: string; name: string; value: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface NetworkRow {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'deleted';
  default_currency: string;
  subscription_status: string | null;
  plan_code: string | null;
  created_at: string;
  /** Soft delete (D3): when it was deleted, and from when it can be purged (until then: restorable). */
  deleted_at?: string | null;
  purge_after?: string | null;
  /** Last full export (Super Admin › Export) — a purge wants one taken since the delete. */
  exported_at?: string | null;
  plan_name?: string | null;
  /** The network's first admin (its owner). */
  owner_email?: string | null;
  /** Why it is suspended: an unpaid invoice ('billing') or a Super Admin ('manual'). */
  suspended_reason?: 'manual' | 'billing' | null;
  /** Customer success: who looks after it, and its health (null until first computed). */
  account_manager_id?: string | null;
  account_manager_name?: string | null;
  health_score?: number | null;
  health_status?: 'healthy' | 'attention' | 'at_risk' | null;
}

/** A plan limit this billing period (lib/usage/meter.ts): used vs limit, ok | near (≥ 80 %) | over. */
export interface PlanLimitStatus { key: string; used: number; limit: number; pct: number; state: 'ok' | 'near' | 'over' }

/** GET /platform/networks/:id — one network as the Super Admin console shows it. */
/** A network's plan overrides: its own price (text, the plan's currency), billing exempt, limits (null = unlimited). */
export interface NetworkOverrides {
  price: string | null; billingExempt: boolean; limits: Partial<Record<'clicks' | 'conversions' | 'events' | 'offers' | 'seats', number | null>>; note: string | null;
}

export interface NetworkDetail {
  id: string;
  ref: string;
  name: string;
  slug: string;
  /** Super Admin › Resellers: who sold this network (null = direct). */
  reseller_id?: string | null;
  reseller_name?: string | null;
  status: 'active' | 'suspended' | 'deleted';
  default_currency: string;
  created_at: string;
  deleted_at: string | null;
  exported_at: string | null;
  purge_after: string | null;
  suspended_reason: 'manual' | 'billing' | null;
  subscription: {
    id: string; status: string; plan_id: string; plan_code: string; plan_name: string; price_cents: number; currency: string;
    billing_interval: 'month' | 'year';
    current_period_start: string | null; current_period_end: string | null; renews_at: string | null; created_at: string;
    trial_ends_at: string | null; cancel_at_period_end: boolean; canceled_at: string | null;
    limits: Record<string, number | string | boolean>;
  } | null;
  owner: { id: string; email: string; name: string | null; status: string; has_login: boolean; last_sign_in_at: string | null } | null;
  counts: { users: number; offers: number; partners: number; advertisers: number };
  trackingDomains: { host: string; mode: string; status: string; is_primary: boolean }[];
  usage: { plan: { code: string; name: string } | null; period: { start: string; end: string }; limits: PlanLimitStatus[] };
  /** Super Admin › its deal when it differs from the plan (null = the plan as it is). */
  overrides?: NetworkOverrides | null;
}

/** GET /platform/networks/:id/users — a network's team, as the Super Admin sees it. */
export interface NetworkTeamMember {
  id: string; email: string; name: string | null; role: string; status: string; created_at: string;
  has_login: boolean; last_sign_in_at: string | null;
}

/** GET /platform/networks/:id/activity — what Super Admins did to a network. */
export interface PlatformActivityRow {
  id: string; created_at: string; action: string; entity_type: string | null; entity_id: string | null;
  after: unknown; in_support_session: boolean; admin_email: string | null;
}

/** A purged network's tombstone (D3): who it was, when it went — its money ledger is kept. */
export interface PurgedNetworkRow {
  id: string; name: string; slug: string; default_currency: string | null;
  created_at: string | null; deleted_at: string | null; exported_at: string | null; purged_at: string;
  purged_by_email: string | null; ledger_entries_retained: number; auth_users_deleted: number;
}

export interface MarketplaceAdvertiser {
  id: string; name: string; status: 'active' | 'pending' | 'inactive'; createdAt: string;
  contactEmail: string | null; categories: string[]; payoutModels: string[]; offerCount: number; hasFunnel: boolean;
}

export interface MarketplaceProfile {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  categoriesMode: 'targeted' | 'all';
  categories: string[];
  conversionFunnelExpertise: string[];
  promotionalMethods: string[];
  payoutTypesAccepted: string[];
  deviceTypesCovered: string[];
  geolocationsMode: 'global' | 'specific';
  geolocations: string[];
  websiteUrl: string | null;
  contactSharePublicly: boolean;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  socialTwitter: string | null;
  socialInstagram: string | null;
  socialMeta: string | null;
  socialTiktok: string | null;
  socialYoutube: string | null;
  socialLinkedin: string | null;
  customLinkLabel: string | null;
  customLinkUrl: string | null;
  requireDefaultOffer: boolean;
  createdAt: string;
  updatedAt: string;
}
