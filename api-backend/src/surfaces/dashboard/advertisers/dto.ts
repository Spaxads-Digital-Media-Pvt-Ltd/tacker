/**
 * Advertiser audience DTOs (spec §3A #13). The serializer — not the caller — decides what fields
 * leave the server. Admins see everything; an advertiser portal user sees only their own
 * profile fields (no internal metadata beyond what they own).
 */
import type { AdvertiserRow } from '../../../domain/entities.js';

export interface AdvertiserAdminDTO {
  id: string;
  ref: number;
  name: string;
  status: AdvertiserRow['status'];
  contactEmail: string | null;
  billingTerms: string | null;
  defaultCurrency: string;
  accountManagerId: string | null;
  salesManagerId: string | null;
  billingFrequency: string | null;
  verificationToken: string | null;
  hasPortalAccount: boolean;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function toAdminDTO(row: AdvertiserRow): AdvertiserAdminDTO {
  return {
    id: row.id,
    ref: Number(row.ref),
    name: row.name,
    status: row.status,
    contactEmail: row.contact_email,
    billingTerms: row.billing_terms,
    defaultCurrency: row.default_currency,
    accountManagerId: row.account_manager_id,
    salesManagerId: row.sales_manager_id,
    billingFrequency: row.billing_frequency,
    verificationToken: row.verification_token,
    hasPortalAccount: Boolean(row.auth_user_id),
    customFields: (row.metadata?.['custom'] as Record<string, unknown> | undefined) ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** What an advertiser sees about THEMSELVES in their portal. No cross-advertiser fields exist here. */
export interface AdvertiserSelfDTO {
  id: string;
  name: string;
  status: AdvertiserRow['status'];
  contactEmail: string | null;
  defaultCurrency: string;
}

export function toSelfDTO(row: AdvertiserRow): AdvertiserSelfDTO {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    contactEmail: row.contact_email,
    defaultCurrency: row.default_currency,
  };
}
