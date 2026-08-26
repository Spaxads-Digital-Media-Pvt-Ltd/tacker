/** Shared types/constants for Offers › Traffic Controls, matching the reference's real "Add
 * Traffic Control" wizard: an explicit offer scope (All / specific Offers / specific Advertisers),
 * a partner scope, an effective date range, and a real Control rule (Action + Variables +
 * Comparison Method + Values) that the tracking surface actually enforces at /click. */
export interface TrafficControl {
  id: string; ref: number; name: string; controlType: 'blacklist' | 'whitelist';
  status: 'active' | 'inactive' | 'deleted';
  effectiveFrom: string | null; effectiveTo: string | null;
  offerScope: 'all' | 'offers' | 'advertisers'; offerIds: string[]; advertiserIds: string[];
  partnerScope: 'all' | 'specific'; partnerIds: string[];
  action: 'block' | 'fail_traffic';
  variables: string[]; comparisonMethod: string | null; values: string[];
  createdAt: string; updatedAt: string;
}

export const VARIABLES: { value: string; label: string }[] = [
  { value: 'sub1', label: 'Sub1' }, { value: 'sub2', label: 'Sub2' }, { value: 'sub3', label: 'Sub3' },
  { value: 'sub4', label: 'Sub4' }, { value: 'sub5', label: 'Sub5' },
  { value: 'referrer', label: 'Referrer' }, { value: 'ip', label: 'IP' }, { value: 'country', label: 'Country' },
  { value: 'device', label: 'Device' }, { value: 'os', label: 'OS' }, { value: 'browser', label: 'Browser' },
  { value: 'user_agent', label: 'User Agent' },
];

export const COMPARISON_METHODS: { value: string; label: string; max: number | null }[] = [
  { value: 'begins_with', label: 'Begins With', max: 100 },
  { value: 'contains', label: 'Contains', max: 100 },
  { value: 'not_contains', label: 'Does not contain', max: 100 },
  { value: 'not_match', label: 'Does not match', max: 100 },
  { value: 'ends_with', label: 'Ends With', max: 100 },
  { value: 'exact_match', label: 'Exact Match', max: 3000 },
  { value: 'is_empty', label: 'Is Empty', max: null },
];

export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return { date: d.toLocaleDateString(), time: `${d.toLocaleTimeString(undefined, { timeStyle: 'medium' })} ${Intl.DateTimeFormat().resolvedOptions().timeZone}` };
}
