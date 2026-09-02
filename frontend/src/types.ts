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
  createdAt: string; updatedAt: string;
}

export interface Offer {
  id: string;
  ref?: number;
  advertiserId: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  destinationUrl: string;
  payoutModel: 'CPA' | 'CPL' | 'CPC' | 'CPI' | 'RevShare';
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
  allowedTrafficTypes?: string[];
  fallbackUrl?: string | null;
  description?: string | null;
  notes?: string[];
  securityCode?: string | null;
  trackingDomainId?: string | null;
  createdAt: string;
  updatedAt?: string;
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
  status: 'unpaid' | 'paid' | 'deleted';
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
  createdAt: string;
  updatedAt: string;
}

export interface PartnerInvoiceSummary { billedAmount: string; paymentsAmount: string; balance: string }

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
  status: 'unpaid' | 'paid' | 'deleted';
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
  createdAt: string;
  updatedAt: string;
}

export interface AdvertiserInvoiceSummary { billedAmount: string; paidAmount: string; balance: string }

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
