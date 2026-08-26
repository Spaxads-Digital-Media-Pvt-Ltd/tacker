/**
 * Per-viewer "Recently Viewed" for the global Search modal. Genuinely real — no view-tracking
 * backend exists, so this lives entirely in localStorage rather than being fabricated data; it's
 * private to this browser, same tradeoff as any other client-only convenience in this app.
 */
export type RecentKind = 'offer' | 'advertiser' | 'partner';

export interface RecentView {
  kind: RecentKind;
  id: string;
  ref: number | null;
  name: string;
  viewedAt: number;
}

const KEY = 'tracker.recentlyViewed.v1';
const MAX = 8;

export function recordView(kind: RecentKind, id: string, name: string, ref: number | null | undefined): void {
  try {
    const cur = getRecentViews().filter((v) => !(v.kind === kind && v.id === id));
    cur.unshift({ kind, id, ref: ref ?? null, name, viewedAt: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(cur.slice(0, MAX)));
  } catch {
    /* localStorage unavailable — silently skip, not essential */
  }
}

export function getRecentViews(): RecentView[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RecentView[]) : [];
  } catch {
    return [];
  }
}

// Search query history — separate from Recently Viewed (pages visited vs. terms searched), same
// per-viewer localStorage tradeoff. Backs the Search modal's "View Search History" link.
const QUERY_KEY = 'tracker.searchHistory.v1';
const QUERY_MAX = 10;

export function recordQuery(q: string): void {
  const trimmed = q.trim();
  if (!trimmed) return;
  try {
    const cur = getQueryHistory().filter((v) => v.toLowerCase() !== trimmed.toLowerCase());
    cur.unshift(trimmed);
    localStorage.setItem(QUERY_KEY, JSON.stringify(cur.slice(0, QUERY_MAX)));
  } catch {
    /* localStorage unavailable — silently skip, not essential */
  }
}

export function getQueryHistory(): string[] {
  try {
    const raw = localStorage.getItem(QUERY_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
