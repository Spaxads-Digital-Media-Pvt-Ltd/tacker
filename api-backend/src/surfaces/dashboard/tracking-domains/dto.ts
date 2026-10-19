import type { TrackingDomainRow } from '../../../domain/entities.js';
import { verificationRecord, type DnsRecord } from '../../../lib/tracking-domains/verify.js';

export interface TrackingDomainDTO {
  id: string;
  ref: number;
  host: string;
  mode: TrackingDomainRow['mode'];
  status: TrackingDomainRow['status'];
  verificationState: TrackingDomainRow['verification_state'];
  verificationToken: string | null;
  sslStatus: TrackingDomainRow['ssl_status'];
  isPrimary: boolean;
  /** The domain links use when an offer has none of its own (lib/tracking-domains/default-host.ts): the primary if
   * it's active, else the domain the tracking server is live on, else another real domain — localhost last. */
  isDefault: boolean;
  /** Custom hosts: the DNS TXT record that verifies them (F-15). Null for subdomains. */
  dnsRecord: DnsRecord | null;
  createdAt: string;
  updatedAt: string;
}

export function toDTO(row: TrackingDomainRow, defaultId: string | null = null): TrackingDomainDTO {
  return {
    id: row.id,
    ref: Number(row.ref),
    host: row.host,
    mode: row.mode,
    status: row.status,
    verificationState: row.verification_state,
    verificationToken: row.verification_token,
    sslStatus: row.ssl_status,
    isPrimary: row.is_primary,
    isDefault: defaultId != null && row.id === defaultId,
    dnsRecord: row.mode === 'custom' && row.verification_token ? verificationRecord(row.host, row.verification_token) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
