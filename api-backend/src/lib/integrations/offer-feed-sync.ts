/**
 * Offer Feed sync — fetch remote JSON feed and upsert offers for the configured advertiser.
 * Matches existing offers by metadata.feedExternalId. Supports demo://offer-feed for local testing.
 */
import { query } from '../db/pool.js';
import { invalidateOfferConfig } from '../../surfaces/tracking/offer-cache.js';
import { loadIntegrations, saveIntegrations, type IntegrationSettings } from './settings.js';

export interface FeedOffer {
  id: string;
  name: string;
  destinationUrl: string;
  payout?: string | number;
  revenue?: string | number;
  currency?: string;
  status?: string;
}

export interface SyncResult {
  pulled: number;
  created: number;
  updated: number;
  error?: string;
}

const DEMO_FEED: FeedOffer[] = [
  { id: 'demo-001', name: 'Demo Feed Offer — Finance', destinationUrl: 'https://example.com/finance?cid={click_id}', payout: '12.00', revenue: '18.00', currency: 'USD', status: 'active' },
  { id: 'demo-002', name: 'Demo Feed Offer — Health', destinationUrl: 'https://example.com/health?cid={click_id}', payout: '8.50', revenue: '14.00', currency: 'USD', status: 'active' },
  { id: 'demo-003', name: 'Demo Feed Offer — Gaming', destinationUrl: 'https://example.com/gaming?cid={click_id}', payout: '5.00', revenue: '9.00', currency: 'USD', status: 'paused' },
];

function normalizeOffer(raw: Record<string, unknown>, index: number): FeedOffer | null {
  const id = String(raw['id'] ?? raw['offer_id'] ?? raw['externalId'] ?? `feed-${index}`);
  const name = String(raw['name'] ?? raw['title'] ?? '').trim();
  const destinationUrl = String(raw['destinationUrl'] ?? raw['destination_url'] ?? raw['url'] ?? '').trim();
  if (!name || !destinationUrl) return null;
  const status = raw['status'] != null ? String(raw['status']).toLowerCase() : 'active';
  return {
    id,
    name,
    destinationUrl,
    payout: raw['payout'] as string | number | undefined,
    revenue: raw['revenue'] as string | number | undefined,
    currency: raw['currency'] != null ? String(raw['currency']) : undefined,
    status,
  };
}

function parseFeedPayload(json: unknown): FeedOffer[] {
  let items: unknown[] = [];
  if (Array.isArray(json)) items = json;
  else if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o['offers'])) items = o['offers'];
    else if (Array.isArray(o['data'])) items = o['data'];
  }
  return items
    .map((item, i) => (item && typeof item === 'object' ? normalizeOffer(item as Record<string, unknown>, i) : null))
    .filter((o): o is FeedOffer => o != null);
}

async function fetchFeed(url: string, apiKey: string | undefined): Promise<FeedOffer[]> {
  if (url === 'demo://offer-feed') return DEMO_FEED;

  const headers: Record<string, string> = { accept: 'application/json' };
  if (apiKey) {
    headers['authorization'] = `Bearer ${apiKey}`;
    headers['x-api-key'] = apiKey;
  }
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Feed HTTP ${res.status}`);
  const json = await res.json();
  const offers = parseFeedPayload(json);
  if (offers.length === 0) throw new Error('Feed returned no valid offers');
  return offers;
}

function mapStatus(s: string | undefined): 'active' | 'paused' | 'draft' {
  const v = (s ?? 'active').toLowerCase();
  if (v === 'paused' || v === 'inactive') return 'paused';
  if (v === 'draft') return 'draft';
  return 'active';
}

function money(v: string | number | undefined, fallback: string): string {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(4) : fallback;
}

async function resolveCurrency(networkId: string, cfg: IntegrationSettings, offer: FeedOffer): Promise<string> {
  if (!cfg.offerFeedUseAdvertiserCurrency && offer.currency) return offer.currency.toUpperCase().slice(0, 3);
  if (offer.currency) return offer.currency.toUpperCase().slice(0, 3);
  if (cfg.offerFeedAdvertiserId) {
    const { rows } = await query<{ default_currency: string | null }>(
      'SELECT default_currency FROM advertisers WHERE id = $1 AND network_id = $2',
      [cfg.offerFeedAdvertiserId, networkId],
    );
    if (rows[0]?.default_currency) return rows[0].default_currency;
  }
  const { rows } = await query<{ default_currency: string }>(
    'SELECT default_currency FROM networks WHERE id = $1',
    [networkId],
  );
  return rows[0]?.default_currency ?? 'USD';
}

async function upsertFeedOffer(
  networkId: string,
  advertiserId: string,
  offer: FeedOffer,
  currency: string,
): Promise<'created' | 'updated'> {
  const { rows: existing } = await query<{ id: string }>(
    `SELECT id FROM offers
      WHERE network_id = $1 AND advertiser_id = $2 AND metadata->>'feedExternalId' = $3
      LIMIT 1`,
    [networkId, advertiserId, offer.id],
  );

  const status = mapStatus(offer.status);
  const payout = money(offer.payout, '0');
  const revenue = money(offer.revenue, '0');
  const meta = JSON.stringify({ feedExternalId: offer.id, feedSource: 'offer_feed' });

  if (existing[0]) {
    await query(
      `UPDATE offers SET name = $3, destination_url = $4, status = $5,
         default_payout = $6, default_revenue = $7, currency = $8, metadata = $9::jsonb, updated_at = now()
       WHERE id = $2 AND network_id = $1`,
      [networkId, existing[0].id, offer.name, offer.destinationUrl, status, payout, revenue, currency, meta],
    );
    await invalidateOfferConfig(networkId, existing[0].id);
    return 'updated';
  }

  const { rows: inserted } = await query<{ id: string }>(
    `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, default_payout, default_revenue, currency, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING id`,
    [networkId, advertiserId, offer.name, status, offer.destinationUrl, payout, revenue, currency, meta],
  );
  if (inserted[0]) await invalidateOfferConfig(networkId, inserted[0].id);
  return 'created';
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

export async function syncOfferFeed(networkId: string): Promise<SyncResult> {
  const cfg = await loadIntegrations(networkId);
  const url = cfg.offerFeedUrl;
  const advertiserId = cfg.offerFeedAdvertiserId;

  if (!url || !advertiserId) return { pulled: 0, created: 0, updated: 0, error: 'feed_not_configured' };
  if (cfg.offerFeedStatus === 'paused') return { pulled: 0, created: 0, updated: 0, error: 'feed_paused' };

  const { rows: adv } = await query<{ id: string }>(
    'SELECT id FROM advertisers WHERE id = $1 AND network_id = $2',
    [advertiserId, networkId],
  );
  if (!adv[0]) return { pulled: 0, created: 0, updated: 0, error: 'advertiser_not_found' };

  try {
    const offers = await fetchFeed(url, cfg.offerFeedKey);
    let created = 0;
    let updated = 0;
    for (const offer of offers) {
      const currency = await resolveCurrency(networkId, cfg, offer);
      const result = await upsertFeedOffer(networkId, advertiserId, offer, currency);
      if (result === 'created') created++;
      else updated++;
    }

    const now = new Date().toISOString();
    const today = todayKey();
    const month = monthKey();
    const lastDay = cfg.offerFeedLastSyncDay as string | undefined;
    const lastMonth = cfg.offerFeedLastSyncMonth as string | undefined;
    const pulledToday = lastDay === today ? (Number(cfg.offerFeedPulledToday) || 0) + offers.length : offers.length;
    const pulledMonth = lastMonth === month ? (Number(cfg.offerFeedPulledMonth) || 0) + offers.length : offers.length;
    const pulledTotal = (Number(cfg.offerFeedPulledTotal) || 0) + offers.length;

    const { rows: counts } = await query<{ active: string; total: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active')::text AS active,
         COUNT(*)::text AS total
       FROM offers
       WHERE network_id = $1 AND advertiser_id = $2 AND metadata->>'feedSource' = 'offer_feed'`,
      [networkId, advertiserId],
    );

    await saveIntegrations(networkId, {
      offerFeedLastFullSync: now,
      offerFeedLastStatusSync: now,
      offerFeedTotalOffers: Number(counts[0]?.total ?? 0),
      offerFeedTotalActiveOffers: Number(counts[0]?.active ?? 0),
      offerFeedPulledToday: pulledToday,
      offerFeedPulledMonth: pulledMonth,
      offerFeedPulledTotal: pulledTotal,
      offerFeedLastSyncDay: today,
      offerFeedLastSyncMonth: month,
      offerFeedLastSyncError: null,
      offerFeedModifiedAt: now,
      ...(cfg.offerFeedCreatedAt ? {} : { offerFeedCreatedAt: now }),
    });

    return { pulled: offers.length, created, updated };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await saveIntegrations(networkId, { offerFeedLastSyncError: msg, offerFeedLastStatusSync: new Date().toISOString() });
    return { pulled: 0, created: 0, updated: 0, error: msg };
  }
}

/** Networks with an active feed due for scheduled sync. */
export async function listNetworksDueForFeedSync(): Promise<string[]> {
  const { rows } = await query<{ id: string; settings: { integrations?: IntegrationSettings } }>(
    `SELECT id, settings FROM networks WHERE settings->'integrations'->>'offerFeedUrl' IS NOT NULL`,
  );
  const now = Date.now();
  const due: string[] = [];
  for (const row of rows) {
    const cfg = row.settings?.integrations ?? {};
    if (cfg.offerFeedStatus === 'paused' || !cfg.offerFeedUrl) continue;
    const last = cfg.offerFeedLastFullSync ? new Date(cfg.offerFeedLastFullSync).getTime() : 0;
    const freq = cfg.offerFeedSyncFrequency ?? 'Daily';
    const intervalMs = freq === 'As Soon As Possible' ? 15 * 60_000
      : freq === 'Hourly' ? 60 * 60_000
      : freq === 'Weekly' ? 7 * 24 * 60 * 60_000
      : 24 * 60 * 60_000; // Daily default
    if (now - last >= intervalMs) due.push(row.id);
  }
  return due;
}
