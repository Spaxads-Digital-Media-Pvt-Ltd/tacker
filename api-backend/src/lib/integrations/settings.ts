/**
 * Network integration settings — stored in networks.settings.integrations jsonb.
 *
 * Credentials (audit F-07) — every key ending in key/token/secret/password: the catalog API keys,
 * fbAccessToken, offerFeedKey, pinApiKey, shopifyApiKey, ... — are encrypted at rest
 * (lib/crypto/secret-box.ts), never sent to the browser (maskIntegrations → `<key>Set`), and only
 * decrypted where they are used (secretValue). Legacy plaintext values still read correctly.
 */
import { query } from '../db/pool.js';
import { encryptSecret, decryptSecret } from '../crypto/secret-box.js';

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

const SECRET_KEY_RE = /(key|token|secret|password)$/i;

/** Is this integration setting a credential? */
export const isSecretIntegrationKey = (key: string): boolean => SECRET_KEY_RE.test(key);

/** A stored credential as plaintext (decrypted here, at the point of use), or null when unset. */
export function secretValue(cfg: IntegrationSettings, key: string): string | null {
  const v = cfg[key];
  return typeof v === 'string' && v ? decryptSecret(v) : null;
}

/** For the browser: every credential replaced by `<key>Set: boolean` (like the SMTP passwordSet). */
export function maskIntegrations(stored: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stored)) {
    if (isSecretIntegrationKey(k)) out[`${k}Set`] = Boolean(v);
    else out[k] = v;
  }
  return out;
}

/**
 * Apply a patch to stored integrations. A credential is only replaced by a non-empty string (which is
 * encrypted); '' or anything else keeps the stored one, like the SMTP password; null removes it.
 * Other keys are copied as sent.
 */
export function mergeIntegrationsPatch(prev: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...prev };
  for (const [k, v] of Object.entries(patch)) {
    if (!isSecretIntegrationKey(k)) out[k] = v;
    else if (v === null) delete out[k];
    else if (typeof v === 'string' && v !== '') out[k] = encryptSecret(v);
  }
  return out;
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
  const integrations = mergeIntegrationsPatch((settings['integrations'] as Record<string, unknown> | undefined) ?? {}, patch);
  await query('UPDATE networks SET settings = $2 WHERE id = $1', [networkId, JSON.stringify({ ...settings, integrations })]);
}
