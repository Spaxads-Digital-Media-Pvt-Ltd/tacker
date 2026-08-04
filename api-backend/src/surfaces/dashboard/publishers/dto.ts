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
