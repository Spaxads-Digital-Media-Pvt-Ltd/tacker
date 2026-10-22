/**
 * Control Center config — stored in networks.settings.controlCenter JSONB.
 */
import { notFound, validationFailed } from '../../../lib/http/errors.js';
import { query } from '../../../lib/db/pool.js';
import { assertImageValue } from '../../../lib/storage/images.js';

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

const BRANDING_IMAGES = ['logoUrl', 'faviconUrl'] as const;

/**
 * A `platform.branding` patch (O12): only logoUrl / faviconUrl, each null or an uploaded image's URL
 * (POST /api/control-center/branding/:kind) — the file itself never goes into settings. Merged over
 * what's stored, so the SPA sends only what changed.
 */
export function mergeBranding(stored: unknown, patch: unknown): Record<string, unknown> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw validationFailed('branding must be an object');
  const before = stored && typeof stored === 'object' ? stored as Record<string, unknown> : {};
  const next = patch as Record<string, unknown>;
  const unknownKeys = Object.keys(next).filter((k) => !(BRANDING_IMAGES as readonly string[]).includes(k));
  if (unknownKeys.length) throw validationFailed(`branding: unknown field(s) ${unknownKeys.join(', ')}`);
  for (const k of BRANDING_IMAGES) if (k in next) assertImageValue(next[k], before[k], `branding.${k}`);
  return { ...before, ...next };
}

/** A network's branding images for every portal (GET /api/me): stored URLs only. */
export async function networkBranding(networkId: string): Promise<{ logoUrl: string | null; faviconUrl: string | null }> {
  const { rows } = await query<{ b: Record<string, unknown> | null }>(
    `SELECT settings->'controlCenter'->'platform'->'branding' AS b FROM networks WHERE id = $1`, [networkId]);
  const url = (v: unknown) => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null);
  return { logoUrl: url(rows[0]?.b?.['logoUrl']), faviconUrl: url(rows[0]?.b?.['faviconUrl']) };
}

/** The self-serve sign-ups a network can open (Control Center › Platform). */
export type SignupKind = 'partner' | 'advertiser';
const SIGNUP_FLAG: Record<SignupKind, { key: string; dflt: boolean }> = {
  // Partner sign-up existed before the switch, so it stays open until a network closes it; advertiser
  // sign-up is new — closed until a network opens it.
  partner: { key: 'showPartnerSignupLink', dflt: true },
  advertiser: { key: 'showAdvertiserSignupLink', dflt: false },
};

/**
 * Is this network taking sign-ups of this kind? The Control Center switch shows the link on the login
 * page AND gates the sign-up endpoint — a hidden link alone would leave the form reachable.
 */
export function signupOpen(settings: Record<string, unknown>, kind: SignupKind): boolean {
  const v = getControlCenterConfig(settings, 'platform')[SIGNUP_FLAG[kind].key];
  return typeof v === 'boolean' ? v : SIGNUP_FLAG[kind].dflt;
}
