/**
 * Network integration settings — stored in networks.settings.integrations jsonb.
 */
import { query } from '../db/pool.js';

export interface IntegrationSettings {
  fbPixelId?: string;
  fbAccessToken?: string;
  pinApiKey?: string;
  offerFeedName?: string;
  offerFeedStatus?: string;
  offerFeedAdvertiserId?: string;
  offerFeedSyncFrequency?: string;
  offerFeedUrl?: string;
  offerFeedKey?: string;
  offerFeedUseAdvertiserCurrency?: boolean;
  offerFeedCreatedAt?: string;
  offerFeedModifiedAt?: string;
  offerFeedLastFullSync?: string;
  offerFeedLastStatusSync?: string;
  offerFeedTotalOffers?: number;
  offerFeedTotalActiveOffers?: number;
  offerFeedPulledToday?: number;
  offerFeedPulledMonth?: number;
  offerFeedPulledTotal?: number;
  offerFeedLastSyncError?: string | null;
  [key: string]: unknown;
}

export async function loadIntegrations(networkId: string): Promise<IntegrationSettings> {
  const { rows } = await query<{ settings: { integrations?: IntegrationSettings } }>(
    'SELECT settings FROM networks WHERE id = $1',
    [networkId],
  );
  return (rows[0]?.settings?.integrations ?? {}) as IntegrationSettings;
}

export async function saveIntegrations(networkId: string, patch: IntegrationSettings): Promise<void> {
  const { rows } = await query<{ settings: Record<string, unknown> }>(
    'SELECT settings FROM networks WHERE id = $1',
    [networkId],
  );
  const settings = rows[0]?.settings ?? {};
  const integrations = { ...(settings['integrations'] as object ?? {}), ...patch };
  await query('UPDATE networks SET settings = $2 WHERE id = $1', [networkId, JSON.stringify({ ...settings, integrations })]);
}
