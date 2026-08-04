import type { TrackingDomainRow } from '../../../domain/entities.js';

export interface TrackingDomainDTO {
  id: string;
  host: string;
  mode: TrackingDomainRow['mode'];
  status: TrackingDomainRow['status'];
  verificationState: TrackingDomainRow['verification_state'];
  verificationToken: string | null;
  sslStatus: TrackingDomainRow['ssl_status'];
  isPrimary: boolean;
  createdAt: string;
}

export function toDTO(row: TrackingDomainRow): TrackingDomainDTO {
  return {
    id: row.id,
    host: row.host,
    mode: row.mode,
    status: row.status,
    verificationState: row.verification_state,
    verificationToken: row.verification_token,
    sslStatus: row.ssl_status,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
  };
}
