/**
 * Control Center config — stored in networks.settings.controlCenter JSONB.
 */
import { notFound } from '../../../lib/http/errors.js';
import { query } from '../../../lib/db/pool.js';

export type ConfigSection = 'platform' | 'partners' | 'advertisers' | 'security';

interface NetworkRow {
  settings: Record<string, unknown>;
}

export async function loadNetworkSettings(networkId: string): Promise<Record<string, unknown>> {
  const { rows } = await query<NetworkRow>('SELECT settings FROM networks WHERE id = $1', [networkId]);
  if (!rows[0]) throw notFound('Network not found');
  return rows[0].settings ?? {};
}

export async function saveNetworkSettings(networkId: string, settings: Record<string, unknown>): Promise<void> {
  await query('UPDATE networks SET settings = $2 WHERE id = $1', [networkId, JSON.stringify(settings)]);
}

export function getControlCenterConfig(settings: Record<string, unknown>, section: ConfigSection): Record<string, unknown> {
  const cc = (settings['controlCenter'] as Record<string, unknown> | undefined) ?? {};
  return (cc[section] as Record<string, unknown> | undefined) ?? {};
}

export async function putControlCenterConfig(
  networkId: string,
  section: ConfigSection,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const settings = await loadNetworkSettings(networkId);
  const cc = (settings['controlCenter'] as Record<string, unknown> | undefined) ?? {};
  const prev = (cc[section] as Record<string, unknown> | undefined) ?? {};
  const merged = { ...prev, ...patch };
  await saveNetworkSettings(networkId, { ...settings, controlCenter: { ...cc, [section]: merged } });
  return merged;
}

export async function getFullControlCenterConfig(networkId: string): Promise<Record<string, unknown>> {
  const settings = await loadNetworkSettings(networkId);
  return (settings['controlCenter'] as Record<string, unknown> | undefined) ?? {};
}
