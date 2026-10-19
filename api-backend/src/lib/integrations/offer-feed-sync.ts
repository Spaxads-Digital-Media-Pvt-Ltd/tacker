/**
 * Offer Feed sync — fetch remote JSON feed and upsert offers for the configured advertiser.
 * Matches existing offers by metadata.feedExternalId. Supports demo://offer-feed for local testing.
 */
import { query } from '../db/pool.js';
import { roundMoney, MoneyFormatError } from '../money.js';
import { invalidateOfferConfig } from '../../surfaces/tracking/offer-cache.js';
import { safeRequest, BlockedDestinationError, type SafeResponse } from '../net/safe-http.js';
import { loadIntegrations, saveIntegrations, secretValue, type IntegrationSettings } from './settings.js';

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
  /** Offers left out because an amount wasn't a usable decimal (O9) — never imported as 0. */
  skipped?: { id: string; reason: string }[];
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

/** A feed is parsed whole, so its size is capped (tens of thousands of offers fit comfortably). */
export const FEED_MAX_BYTES = 16 * 1024 * 1024;
const FEED_TIMEOUT_MS = 30_000;

/**
 * Fetch + parse the feed. The URL is tenant-supplied, so it goes through the SSRF guard (audit F-06):
 * http(s) only, no redirects, and no loopback / private / link-local (cloud metadata) targets outside
 * NODE_ENV=development — checked on the address actually connected to. 30 s for the whole fetch.
 */
export async function fetchFeed(url: string, apiKey: string | undefined): Promise<FeedOffer[]> {
  if (url === 'demo://offer-feed') return DEMO_FEED;

  const headers: Record<string, string> = { accept: 'application/json' };
  if (apiKey) {
    headers['authorization'] = `Bearer ${apiKey}`;
    headers['x-api-key'] = apiKey;
  }
  let res: SafeResponse;
  try {
    res = await safeRequest(url, {
      method: 'GET', headers, timeoutMs: FEED_TIMEOUT_MS, deadlineMs: FEED_TIMEOUT_MS, maxBodyBytes: FEED_MAX_BYTES,
    });
  } catch (err) {
    if (err instanceof BlockedDestinationError) {
      throw new Error(`${err.message} — offer feeds can only be fetched from public internet addresses`);
    }
    if ((err as Error).name === 'AbortError') throw new Error(`Feed request timed out after ${FEED_TIMEOUT_MS / 1000}s`);
    throw err;
  }
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`Feed HTTP ${res.status} (redirects are not followed — use the feed's final URL)`);
  }
  if (res.status < 200 || res.status >= 300) throw new Error(`Feed HTTP ${res.status}`);
  if (res.truncated) throw new Error(`Feed is larger than ${FEED_MAX_BYTES / (1024 * 1024)} MB`);
  let json: unknown;
  try {
    // Money must stay exact (O9): a parsed JSON number has already lost digits past ~15, so payout /
    // revenue keep the number's source text where the runtime provides it (Node 21+); else the number.
    json = JSON.parse(res.body.replace(/^\uFEFF/, ''), keepMoneySource as (this: unknown, key: string, value: unknown) => unknown);
  } catch {
    throw new Error('Feed is not valid JSON');
  }
  const offers = parseFeedPayload(json);
  if (offers.length === 0) throw new Error('Feed returned no valid offers');
  return offers;
}

const MONEY_KEYS = new Set(['payout', 'revenue']);
function keepMoneySource(key: string, value: unknown, context?: { source?: string }): unknown {
  return typeof value === 'number' && MONEY_KEYS.has(key) && typeof context?.source === 'string' ? context.source : value;
}

function mapStatus(s: string | undefined): 'active' | 'paused' | 'draft' {
  const v = (s ?? 'active').toLowerCase();
  if (v === 'paused' || v === 'inactive') return 'paused';
  if (v === 'draft') return 'draft';
  return 'active';
}

/** A feed amount, exactly (O9): missing → the fallback; not a usable decimal → MoneyFormatError. */
function money(v: string | number | undefined, fallback: string): string {
  if (v == null || (typeof v === 'string' && !v.trim())) return fallback;
  return roundMoney(v);
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
      // The feed owns name / URL / status / money; everything else on the offer (targeting, settings,
      // notes, custom fields set in the dashboard) stays — the feed keys are MERGED into metadata.
      `UPDATE offers SET name = $3, destination_url = $4, status = $5,
         default_payout = $6, default_revenue = $7, currency = $8,
         metadata = COALESCE(metadata, '{}'::jsonb) || $9::jsonb, updated_at = now()
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
    const offers = await fetchFeed(url, secretValue(cfg, 'offerFeedKey') ?? undefined); // key stored encrypted (F-07)
    let created = 0;
    let updated = 0;
    const skipped: { id: string; reason: string }[] = [];
    for (const offer of offers) {
      const currency = await resolveCurrency(networkId, cfg, offer);
      let result: 'created' | 'updated';
      try {
        result = await upsertFeedOffer(networkId, advertiserId, offer, currency);
      } catch (err) {
        if (!(err instanceof MoneyFormatError)) throw err;
        skipped.push({ id: offer.id, reason: err.message }); // never imported with a made-up amount
        continue;
      }
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
      offerFeedLastSyncError: skipped.length
        ? `${skipped.length} offer(s) skipped — an amount wasn't a usable decimal: ${skipped.slice(0, 5).map((x) => `${x.id} (${x.reason})`).join('; ')}`
        : null,
      offerFeedModifiedAt: now,
      ...(cfg.offerFeedCreatedAt ? {} : { offerFeedCreatedAt: now }),
    });

    return { pulled: offers.length, created, updated, ...(skipped.length ? { skipped } : {}) };
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
