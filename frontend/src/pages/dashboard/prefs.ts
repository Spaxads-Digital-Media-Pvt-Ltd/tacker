/**
 * Dashboard preferences, per browser (localStorage, every access guarded — private mode / blocked
 * storage just falls back to the defaults): the date range and which cards are shown.
 */
import { useCallback, useState } from 'react';
import { isRangePreset, type RangePreset } from './range';

const RANGE_KEY = 'dashboard-range';
// Same key as before the redesign, so existing "Customize cards" choices carry over.
const SECTIONS_KEY = 'dashboard-visible-sections';

export const DEFAULT_RANGE: RangePreset = '7d';

export const SECTIONS = [
  { id: 'kpi', label: 'KPI cards' },
  { id: 'performance', label: 'Performance' },
  { id: 'cr', label: 'Conversion rate' },
  { id: 'offers', label: 'Top offers' },
  { id: 'publishers', label: 'Top partners' },
  { id: 'advertisers', label: 'Top advertisers' },
  { id: 'recent', label: 'Recent changes' },
] as const;
export type SectionId = (typeof SECTIONS)[number]['id'];
export type Visible = Record<SectionId, boolean>;
const ALL_VISIBLE: Visible = { kpi: true, performance: true, cr: true, offers: true, publishers: true, advertisers: true, recent: true };

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable — keep it for this visit */ }
}

export function readRange(): RangePreset {
  const v = read(RANGE_KEY);
  return isRangePreset(v) ? v : DEFAULT_RANGE;
}

export function readVisible(): Visible {
  const raw = read(SECTIONS_KEY);
  if (!raw) return { ...ALL_VISIBLE };
  try {
    const saved = JSON.parse(raw) as Partial<Record<string, unknown>>;
    const out = { ...ALL_VISIBLE };
    for (const s of SECTIONS) if (typeof saved[s.id] === 'boolean') out[s.id] = saved[s.id] as boolean;
    return out;
  } catch {
    return { ...ALL_VISIBLE };
  }
}

/** The dashboard range, remembered. */
export function useRangePref(): [RangePreset, (p: RangePreset) => void] {
  const [range, setRange] = useState<RangePreset>(readRange);
  const set = useCallback((p: RangePreset) => { setRange(p); write(RANGE_KEY, p); }, []);
  return [range, set];
}

/** Which cards are shown, remembered. */
export function useVisiblePref(): [Visible, (v: Visible) => void] {
  const [visible, setVisible] = useState<Visible>(readVisible);
  const set = useCallback((v: Visible) => { setVisible(v); write(SECTIONS_KEY, JSON.stringify(v)); }, []);
  return [visible, set];
}
