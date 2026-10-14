// Saved report presets (lib/savedReports.ts, audit F-24): the server is the source of truth, the
// localStorage cache is per user, and the old browser-wide list is uploaded once as the signed-in
// user's — never taken over by whoever signs in next on the same browser.
import { describe, it, beforeEach, vi } from 'vitest';
import assert from 'node:assert';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('../api', () => ({ api }));

import { loadSavedReports, persistSavedReports, syncSavedReports } from '../savedReports.ts';
import type { SavedReportConfig } from '../../shared-components/primitives/ReportPageKit';

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  },
});

const NET = '11111111-1111-4111-8111-111111111111';
const signIn = (email: string) => store.set('tracker.session.v2', JSON.stringify({ token: 't', role: 'admin', displayName: email, email, networkId: NET, ownerId: null, expiresAt: null }));
const config: SavedReportConfig<string> = { from: '2026-10-01', to: '2026-10-07', filters: {}, exclusions: {}, metricFilters: {}, ignoreFailTraffic: false, orderBy: 'clicks', orderDir: 'desc', hiddenColumns: [] };
const names = (list: { name: string }[]) => list.map((s) => s.name);

beforeEach(() => {
  store.clear();
  api.get.mockReset(); api.put.mockReset(); api.del.mockReset();
  api.put.mockResolvedValue({}); api.del.mockResolvedValue({});
});

describe('per-user cache', () => {
  it("one user's presets are never shown to another user of the same browser", () => {
    signIn('a@example.com');
    persistSavedReports('offer-report', [{ name: 'Mine', config }]);
    assert.deepStrictEqual(names(loadSavedReports('offer-report')), ['Mine']);
    signIn('b@example.com');
    assert.deepStrictEqual(loadSavedReports('offer-report'), []);
  });

  it('save / delete write the cache at once and send only what changed to the server', () => {
    signIn('a@example.com');
    persistSavedReports('offer-report', [{ name: 'One', config }, { name: 'Two & more', config }]);
    assert.strictEqual(api.put.mock.calls.length, 2);
    api.put.mockClear();
    persistSavedReports('offer-report', [{ name: 'One', config: { ...config, orderBy: 'revenue' } }]);
    assert.deepStrictEqual(api.put.mock.calls.map((c) => c[1].name), ['One']);
    assert.deepStrictEqual(api.del.mock.calls.map((c) => c[0]), ['/api/saved-reports/by-name?page=offer-report&name=Two%20%26%20more']);
    assert.deepStrictEqual(names(loadSavedReports('offer-report')), ['One']);
  });
});

describe('syncSavedReports', () => {
  it('the server list becomes the cache; the old browser-wide list is uploaded once, then dropped', async () => {
    store.set('tracker.savedReports.offer-report', JSON.stringify([{ name: 'Legacy', config }, { name: 'Both', config }]));
    signIn('a@example.com');
    assert.deepStrictEqual(names(loadSavedReports('offer-report')), ['Legacy', 'Both']); // shown until the first sync
    api.get.mockResolvedValue([{ page: 'offer-report', name: 'Both', config }, { page: 'daily-report', name: 'Other page', config }]);

    const byPage = await syncSavedReports(['offer-report']);
    assert.deepStrictEqual(names(byPage.get('offer-report')!), ['Both', 'Legacy']);
    assert.deepStrictEqual(api.put.mock.calls.map((c) => [c[0], c[1].page, c[1].name]), [['/api/saved-reports/by-name', 'offer-report', 'Legacy']]);
    assert.strictEqual(store.has('tracker.savedReports.offer-report'), false);
    assert.deepStrictEqual(names(loadSavedReports('offer-report')), ['Both', 'Legacy']);

    // The next user of this browser gets nothing of it.
    signIn('b@example.com');
    api.put.mockClear();
    api.get.mockResolvedValue([]);
    assert.deepStrictEqual(loadSavedReports('offer-report'), []);
    assert.deepStrictEqual(names((await syncSavedReports(['offer-report'])).get('offer-report')!), []);
    assert.strictEqual(api.put.mock.calls.length, 0);
  });

  it('a refused upload keeps the browser-wide list for the next sync', async () => {
    store.set('tracker.savedReports.daily-report', JSON.stringify([{ name: 'x'.repeat(130), config }]));
    signIn('a@example.com');
    api.get.mockResolvedValue([]);
    api.put.mockRejectedValue(new Error('422'));
    const byPage = await syncSavedReports(['daily-report']);
    assert.strictEqual(byPage.get('daily-report')!.length, 1); // still shown locally
    assert.strictEqual(store.has('tracker.savedReports.daily-report'), true);
  });

  it('malformed entries are dropped and missing fields defaulted', async () => {
    signIn('a@example.com');
    api.get.mockResolvedValue([
      { page: 'offer-report', name: 'Sparse', config: { orderBy: 7, orderDir: 'sideways', hiddenColumns: ['cr', 3] } },
      { page: 'offer-report', name: 42, config },
      { page: 'offer-report', name: 'No config' },
    ]);
    const [only, ...rest] = (await syncSavedReports(['offer-report'])).get('offer-report')!;
    assert.strictEqual(rest.length, 0);
    assert.strictEqual(only!.name, 'Sparse');
    assert.deepStrictEqual({ orderBy: only!.config.orderBy, orderDir: only!.config.orderDir, hiddenColumns: only!.config.hiddenColumns, ignoreFailTraffic: only!.config.ignoreFailTraffic },
      { orderBy: 'clicks', orderDir: 'desc', hiddenColumns: ['cr'], ignoreFailTraffic: false });
  });
});
