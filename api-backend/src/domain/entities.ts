/**
 * DB row shapes for Phase 1 entities. These mirror the migration columns and are used to type
 * ScopedDb results. External callers NEVER receive these raw — always through an audience DTO
 * (spec §3A non-negotiable #13).
 */
export interface AdvertiserRow {
  id: string;
  ref: number;
  network_id: string;
  auth_user_id: string | null;
  name: string;
  status: 'active' | 'pending' | 'inactive';
  contact_email: string | null;
  billing_terms: string | null;
  default_currency: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PublisherRow {
  id: string;
  ref: number;
  network_id: string;
  auth_user_id: string | null;
  name: string;
  status: 'active' | 'pending' | 'inactive';
  contact_email: string | null;
  traffic_source: string | null;
  payout_terms: string | null;
  default_attribution_window_s: number;
  default_dedup_window_s: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OfferRow {
  id: string;
  ref: number;
  network_id: string;
  advertiser_id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  destination_url: string;
  payout_model: 'CPA' | 'CPL' | 'CPC' | 'CPI' | 'RevShare';
  default_payout: string; // numeric arrives as string from pg — keep as string, never float
  default_revenue: string;
  currency: string;
  daily_conversion_cap: number | null;
  total_conversion_cap: number | null;
  daily_click_cap: number | null;
  attribution_window_s: number;
  dedup_window_s: number;
  allowed_traffic_types: string[];
  fallback_url: string | null;
  objective: 'conversions' | 'sale' | 'app_installs' | 'leads' | 'impressions' | 'clicks';
  visibility: 'public' | 'private' | 'ask';
  category: string | null;
  preview_url: string | null;
  security_code: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OfferGeoRuleRow {
  id: string;
  network_id: string;
  offer_id: string;
  country: string;
  region: string | null;
  action: 'allow' | 'deny';
  payout_override: string | null;
  revenue_override: string | null;
  destination_override: string | null;
  created_at: string;
  updated_at: string;
}

export interface OfferPublisherAccessRow {
  id: string;
  network_id: string;
  offer_id: string;
  publisher_id: string;
  access: 'allow' | 'deny';
  approval_status: 'approved' | 'pending' | 'rejected';
  payout_override: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackingDomainRow {
  id: string;
  network_id: string;
  host: string;
  mode: 'subdomain' | 'custom';
  status: 'pending' | 'active' | 'disabled';
  verification_state: 'unverified' | 'pending' | 'verified' | 'failed';
  verification_token: string | null;
  ssl_status: 'none' | 'pending' | 'issued' | 'error';
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}
