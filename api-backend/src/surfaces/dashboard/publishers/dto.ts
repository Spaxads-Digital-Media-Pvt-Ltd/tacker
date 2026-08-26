/** Publisher audience DTOs (spec §3A). Admins see all; a publisher sees only their own profile. */
import type { PublisherRow } from '../../../domain/entities.js';

export interface PublisherAdminDTO {
  id: string;
  ref: number;
  name: string;
  status: PublisherRow['status'];
  contactEmail: string | null;
  trafficSource: string | null;
  payoutTerms: string | null;
  defaultAttributionWindowS: number;
  defaultDedupWindowS: number;
  country: string | null;
  paymentMethod: string | null;
  billingFrequency: string | null;
  tier: string | null;
  partnerManagerId: string | null;
  accountExecutiveId: string | null;
  referredById: string | null;
  contactName: string | null;
  taxId: string | null;
  website: string | null;
  notes: string | null;
  hasPortalAccount: boolean;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function toAdminDTO(row: PublisherRow): PublisherAdminDTO {
  return {
    id: row.id,
    ref: Number(row.ref),
    name: row.name,
    status: row.status,
    contactEmail: row.contact_email,
    trafficSource: row.traffic_source,
    payoutTerms: row.payout_terms,
    defaultAttributionWindowS: row.default_attribution_window_s,
    defaultDedupWindowS: row.default_dedup_window_s,
    country: row.country,
    paymentMethod: row.payment_method,
    billingFrequency: row.billing_frequency,
    tier: row.tier,
    partnerManagerId: row.partner_manager_id,
    accountExecutiveId: row.account_executive_id,
    referredById: row.referred_by_id,
    contactName: row.contact_name,
    taxId: row.tax_id,
    website: row.website,
    notes: row.notes,
    hasPortalAccount: row.auth_user_id != null,
    customFields: (row.metadata?.['custom'] as Record<string, unknown> | undefined) ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface PublisherSelfDTO {
  id: string;
  name: string;
  status: PublisherRow['status'];
  contactEmail: string | null;
  trafficSource: string | null;
}

export function toSelfDTO(row: PublisherRow): PublisherSelfDTO {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    contactEmail: row.contact_email,
    trafficSource: row.traffic_source,
  };
}
