/**
 * Shared between the Offer Templates list, the Add/Edit page, and the Template Details page — the
 * catalog of fields a template can pre-fill, grouped to match this app's own Add Offer wizard steps
 * (OfferCreate.tsx's STEPS array) so the taxonomy reads the same everywhere it appears.
 */
import { useQuery } from '../lib/useApi';
import type { Advertiser } from '../types';

export interface Template {
  id: string; ref: number; name: string; isDefault: boolean; offerFields: string[];
  fieldValues: Record<string, string>; createdAt: string; updatedAt: string;
}

export interface FieldSpec { key: string; label: string; group: string; type?: 'select'; options?: { value: string; label: string }[] }

export function useFieldSpecs(): FieldSpec[] {
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  return [
    { key: 'advertiserId', label: 'Advertiser', group: 'General', type: 'select', options: (advertisers ?? []).map((a) => ({ value: a.id, label: a.name })) },
    { key: 'category', label: 'Category', group: 'General' },
    { key: 'visibility', label: 'Visibility', group: 'General', type: 'select', options: ['public', 'private', 'ask'].map((v) => ({ value: v, label: v })) },
    { key: 'destinationUrl', label: 'Default Landing Page URL', group: 'Tracking & Controls' },
    { key: 'currency', label: 'Currency', group: 'Revenue & Payout (Events)' },
    { key: 'payoutModel', label: 'Payout Model', group: 'Revenue & Payout (Events)', type: 'select', options: ['CPA', 'CPL', 'CPC', 'CPI', 'RevShare'].map((v) => ({ value: v, label: v })) },
    { key: 'defaultRevenue', label: 'Revenue Per Action', group: 'Revenue & Payout (Events)' },
    { key: 'defaultPayout', label: 'Payout Per Action', group: 'Revenue & Payout (Events)' },
  ];
}

export function valueLabel(spec: FieldSpec, raw: string | undefined): string {
  raw = raw ?? '';
  if (spec.type === 'select') return spec.options?.find((o) => o.value === raw)?.label ?? raw;
  return raw;
}

export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString(),
    time: `${d.toLocaleTimeString(undefined, { timeStyle: 'medium' })} ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
  };
}
