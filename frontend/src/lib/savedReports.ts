/**
 * Saved report presets (audit F-24): the report pages' Save / Load lists. The server
 * (`/api/saved-reports`, the signed-in user's own) is the source of truth; localStorage is a cache
 * so a page can show its list at once. The cache is per user (network + email in the key) — people
 * sharing a browser never see, or take over, each other's presets. Before F-24 the list was
 * browser-wide (`tracker.savedReports.<page>`); the first sync uploads those once as the signed-in
 * user's and then drops them. Stored data outlives code changes, so every field is shape-checked and
 * defaulted — an old or hand-edited entry must never crash a report page on load.
 */
import { useEffect } from 'react';
import { api } from './api';
import { loadSession } from '../auth/session';
import { cleanFilterValues } from './reportFilterState';
import { daysAgo, todayStr } from './reportMath';
import type { MetricFilters, SavedReportConfig } from '../shared-components/primitives/ReportPageKit';

type SavedList<OrderMetric extends string> = { name: string; config: SavedReportConfig<OrderMetric> }[];

const legacyKey = (page: string) => `tracker.savedReports.${page}`;
function cacheKey(page: string): string {
  const s = loadSession();
  return `${legacyKey(page)}:${s?.networkId ?? ''}:${(s?.email ?? '').toLowerCase()}`;
}
function readList(storageKey: string): unknown {
  try { return JSON.parse(localStorage.getItem(storageKey) ?? '[]'); } catch { return []; }
}

export function loadSavedReports<OrderMetric extends string>(key: string): SavedList<OrderMetric> {
  let cached: string | null = null;
  try { cached = localStorage.getItem(cacheKey(key)); } catch { /* storage unavailable */ }
  // Until this browser's first sync, the pre-F-24 browser-wide list still shows.
  return normalizeSavedReports<OrderMetric>(cached != null ? readList(cacheKey(key)) : readList(legacyKey(key)));
}

function normalizeSavedReports<OrderMetric extends string>(raw: unknown): SavedList<OrderMetric> {
  if (!Array.isArray(raw)) return [];
  const out: SavedList<OrderMetric> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { name, config } = item as { name?: unknown; config?: Record<string, unknown> };
    if (typeof name !== 'string' || !config || typeof config !== 'object') continue;
    const str = (v: unknown, d: string) => (typeof v === 'string' && v ? v : d);
    out.push({
      name,
      config: {
        ...(config as object),
        from: str(config['from'], daysAgo(30)),
        to: str(config['to'], todayStr()),
        filters: cleanFilterValues(config['filters']),
        exclusions: cleanFilterValues(config['exclusions']),
        metricFilters: (config['metricFilters'] && typeof config['metricFilters'] === 'object' ? config['metricFilters'] : {}) as MetricFilters,
        ignoreFailTraffic: config['ignoreFailTraffic'] === true,
        // '' is kept: it's the Daily/Hourly default order (chronological), not a missing value.
        orderBy: (typeof config['orderBy'] === 'string' ? config['orderBy'] : 'clicks') as OrderMetric,
        orderDir: config['orderDir'] === 'asc' ? 'asc' : 'desc',
        hiddenColumns: Array.isArray(config['hiddenColumns']) ? (config['hiddenColumns'] as unknown[]).filter((c): c is string => typeof c === 'string') : [],
      },
    });
  }
  return out;
}

/** Replace this user's cached list for a page (no server write — for lists that came from the server). */
function cacheSavedReports(key: string, list: unknown): void {
  try { localStorage.setItem(cacheKey(key), JSON.stringify(list)); } catch { /* best-effort */ }
}

/** Save a page's list: the cache at once, and the server (the source of truth) for what changed. */
export function persistSavedReports<OrderMetric extends string>(key: string, list: SavedList<OrderMetric>): void {
  const before = new Map(loadSavedReports<OrderMetric>(key).map((s) => [s.name, JSON.stringify(s.config)]));
  cacheSavedReports(key, list);
  for (const s of list) {
    if (before.get(s.name) !== JSON.stringify(s.config)) {
      void api.put('/api/saved-reports/by-name', { page: key, name: s.name, config: s.config }).catch(() => undefined);
    }
  }
  for (const name of before.keys()) {
    if (!list.some((s) => s.name === name)) {
      void api.del(`/api/saved-reports/by-name?page=${encodeURIComponent(key)}&name=${encodeURIComponent(name)}`).catch(() => undefined);
    }
  }
}

interface ServerSavedReport { page: string; name: string; config: unknown }

/**
 * Load these pages' lists from the server into this user's cache, and return them per page. A
 * pre-F-24 browser-wide list is uploaded once as the signed-in user's, then dropped — only once
 * every upload succeeded, so a failed one is retried on the next sync rather than lost.
 */
export async function syncSavedReports(pages: readonly string[]): Promise<Map<string, SavedList<string>>> {
  const rows = await api.get<ServerSavedReport[]>(`/api/saved-reports${pages.length === 1 ? `?page=${encodeURIComponent(pages[0]!)}` : ''}`);
  const byPage = new Map<string, SavedList<string>>();
  for (const page of pages) {
    const server = normalizeSavedReports<string>((rows ?? []).filter((r) => r.page === page));
    const legacy = normalizeSavedReports<string>(readList(legacyKey(page))).filter((l) => !server.some((s) => s.name === l.name));
    const uploads = await Promise.allSettled(legacy.map((l) => api.put('/api/saved-reports/by-name', { page, name: l.name, config: l.config })));
    if (uploads.every((u) => u.status === 'fulfilled')) {
      try { localStorage.removeItem(legacyKey(page)); } catch { /* best-effort */ }
    }
    const list = [...server, ...legacy];
    cacheSavedReports(page, list);
    byPage.set(page, list);
  }
  return byPage;
}

/** Load a page's saved reports from the server once it mounts (the initial state came from the cache). */
export function useServerSavedReports<T>(key: string, setList: (list: T[]) => void): void {
  useEffect(() => {
    let live = true;
    void syncSavedReports([key]).then((byPage) => {
      if (live) setList((byPage.get(key) ?? []) as unknown as T[]);
    }).catch(() => { /* offline / no access: keep the cache */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
