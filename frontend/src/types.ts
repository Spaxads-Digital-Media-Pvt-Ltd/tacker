/** Frontend mirrors of the backend audience DTOs (admin view). Read-only shapes for rendering. */
export interface Advertiser {
  id: string;
  ref?: number;
  name: string;
  status: 'active' | 'pending' | 'inactive';
  contactEmail: string | null;
  billingTerms: string | null;
  defaultCurrency: string;
  customFields?: Record<string, unknown>;
  createdAt: string;
}

export interface Publisher {
  id: string;
  ref?: number;
  name: string;
  status: 'active' | 'pending' | 'inactive';
  contactEmail: string | null;
  trafficSource: string | null;
  payoutTerms: string | null;
  customFields?: Record<string, unknown>;
  createdAt: string;
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
  description?: string | null;
  notes?: string[];
  securityCode?: string | null;
  createdAt: string;
}

export interface TrackingDomain {
  id: string;
  host: string;
  mode: 'subdomain' | 'custom';
  status: 'pending' | 'active' | 'disabled';
  verificationState: 'unverified' | 'pending' | 'verified' | 'failed';
  sslStatus: 'none' | 'pending' | 'issued' | 'error';
  isPrimary: boolean;
  createdAt: string;
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
