/**
 * White-label — a network's own brand on a dashboard domain of its own (network_white_label). The
 * platform grants it (Super Admin › Networks › White-label: `enabled`); the network's admin then sets
 * it up (Control Center › Platform › White-label): brand name, primary colour, support link, "hide the
 * platform's branding" and the dashboard domain, verified by a DNS TXT record (the same
 * `_tracker-verify.<domain>` check custom tracking domains use). Once verified, the SPA served on that
 * domain asks GET /api/public/brand?host= and shows the network's name, logo, favicon and colour.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { query } from './db/pool.js';
import { getRedis } from './redis.js';
import { logger } from './logger.js';
import { txtMatches, verificationRecord } from './tracking-domains/verify.js';
import { networkBranding } from '../surfaces/dashboard/control-center/config.js';
import { AppError, conflict } from './http/errors.js';

export interface WhiteLabelRow {
  network_id: string; enabled: boolean; brand_name: string | null; primary_color: string | null; support_url: string | null;
  hide_platform_branding: boolean; dashboard_domain: string | null; domain_token: string | null; domain_verified_at: Date | null;
  domain_checked_at: Date | null; domain_check_result: string | null;
}

const HOSTNAME = /^(?=.{4,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/** What a network may set (the platform's `enabled` is separate). */
export const whiteLabelPatchSchema = z.object({
  brandName: z.string().trim().min(1).max(80).nullable().optional(),
  primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'must be a colour like #1E3557').nullable().optional(),
  supportUrl: z.string().trim().url().max(500).refine((u) => /^https?:\/\//i.test(u), 'must be an http(s) URL').nullable().optional(),
  hidePlatformBranding: z.boolean().optional(),
  dashboardDomain: z.string().trim().toLowerCase().max(253)
    .refine((d) => HOSTNAME.test(d), 'must be a host name like dashboard.example.com').nullable().optional(),
}).strict();
export type WhiteLabelPatch = z.infer<typeof whiteLabelPatchSchema>;

export const whiteLabelDto = (r: WhiteLabelRow | null) => ({
  enabled: r?.enabled ?? false,
  brandName: r?.brand_name ?? null,
  primaryColor: r?.primary_color ?? null,
  supportUrl: r?.support_url ?? null,
  hidePlatformBranding: r?.hide_platform_branding ?? false,
  dashboardDomain: r?.dashboard_domain ?? null,
  domainVerified: Boolean(r?.domain_verified_at),
  domainVerifiedAt: r?.domain_verified_at ?? null,
  domainCheckedAt: r?.domain_checked_at ?? null,
  domainCheckResult: r?.domain_check_result ?? null,
  // The record to publish for the domain (shown until it is verified).
  dnsRecord: r?.dashboard_domain && r.domain_token ? verificationRecord(r.dashboard_domain, r.domain_token) : null,
});

export async function whiteLabelFor(networkId: string): Promise<WhiteLabelRow | null> {
  const { rows } = await query<WhiteLabelRow>('SELECT * FROM network_white_label WHERE network_id = $1', [networkId]);
  return rows[0] ?? null;
}

const brandKey = (host: string) => `wlbrand:${host}`;
async function forgetBrand(...hosts: (string | null | undefined)[]): Promise<void> {
  try { for (const h of hosts) if (h) await getRedis().del(brandKey(h.toLowerCase())); } catch { /* the TTL bounds it */ }
}

/**
 * Save the network's white-label settings. A new / changed domain gets a fresh token and is unverified
 * until its TXT record checks out; a domain another network already uses → 409.
 */
export async function saveWhiteLabel(networkId: string, patch: WhiteLabelPatch & { enabled?: boolean }): Promise<WhiteLabelRow> {
  const before = await whiteLabelFor(networkId);
  const domainChanged = patch.dashboardDomain !== undefined && (patch.dashboardDomain ?? null) !== (before?.dashboard_domain ?? null);
  if (domainChanged && patch.dashboardDomain) {
    const { rows } = await query('SELECT 1 FROM network_white_label WHERE lower(dashboard_domain) = $1 AND network_id <> $2', [patch.dashboardDomain, networkId]);
    if (rows.length) throw new AppError('conflict', `${patch.dashboardDomain} is already the dashboard domain of another network.`, { reason: 'domain_in_use' });
  }
  const v = <T>(next: T | undefined, prev: T): T => (next === undefined ? prev : next);
  const domain = domainChanged ? (patch.dashboardDomain ?? null) : (before?.dashboard_domain ?? null);
  const { rows } = await query<WhiteLabelRow>(
    `INSERT INTO network_white_label (network_id, enabled, brand_name, primary_color, support_url, hide_platform_branding,
                                      dashboard_domain, domain_token, domain_verified_at, domain_checked_at, domain_check_result)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (network_id) DO UPDATE SET enabled = EXCLUDED.enabled, brand_name = EXCLUDED.brand_name,
       primary_color = EXCLUDED.primary_color, support_url = EXCLUDED.support_url, hide_platform_branding = EXCLUDED.hide_platform_branding,
       dashboard_domain = EXCLUDED.dashboard_domain, domain_token = EXCLUDED.domain_token, domain_verified_at = EXCLUDED.domain_verified_at,
       domain_checked_at = EXCLUDED.domain_checked_at, domain_check_result = EXCLUDED.domain_check_result
     RETURNING *`,
    [networkId, v(patch.enabled, before?.enabled ?? false), v(patch.brandName, before?.brand_name ?? null), v(patch.primaryColor, before?.primary_color ?? null),
      v(patch.supportUrl, before?.support_url ?? null), v(patch.hidePlatformBranding, before?.hide_platform_branding ?? false), domain,
      domainChanged ? (domain ? randomBytes(16).toString('hex') : null) : (before?.domain_token ?? null),
      domainChanged ? null : (before?.domain_verified_at ?? null),
      domainChanged ? null : (before?.domain_checked_at ?? null),
      domainChanged ? null : (before?.domain_check_result ?? null)]);
  await forgetBrand(before?.dashboard_domain, domain);
  return rows[0]!;
}

/** Check the dashboard domain's TXT record now; verified when it carries the token. */
export async function verifyWhiteLabelDomain(networkId: string): Promise<WhiteLabelRow> {
  const wl = await whiteLabelFor(networkId);
  if (!wl?.dashboard_domain || !wl.domain_token) throw conflict('Set a dashboard domain first.');
  const check = await txtMatches(wl.dashboard_domain, wl.domain_token);
  const { rows } = await query<WhiteLabelRow>(
    `UPDATE network_white_label SET domain_checked_at = now(), domain_check_result = $2,
            domain_verified_at = CASE WHEN $3 THEN COALESCE(domain_verified_at, now()) ELSE NULL END
      WHERE network_id = $1 RETURNING *`, [networkId, check.reason, check.ok]);
  await forgetBrand(wl.dashboard_domain);
  return rows[0]!;
}

export interface PublicBrand {
  networkSlug: string; brandName: string; logoUrl: string | null; faviconUrl: string | null; primaryColor: string | null;
  supportUrl: string | null; hidePlatformBranding: boolean;
}

/**
 * The brand to show on `host` — only a granted, verified domain of an active network; else null.
 * Cached in Redis for a minute (negative answers too), busted when the settings change.
 */
export async function brandForHost(rawHost: string): Promise<PublicBrand | null> {
  const host = rawHost.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  if (!host || !HOSTNAME.test(host)) return null;
  try {
    const cached = await getRedis().get(brandKey(host));
    if (cached) return cached === 'none' ? null : (JSON.parse(cached) as PublicBrand);
  } catch (err) {
    logger.warn({ err }, 'white-label brand cache unavailable');
  }
  const { rows } = await query<WhiteLabelRow & { slug: string; name: string }>(
    `SELECT wl.*, n.slug, n.name FROM network_white_label wl JOIN networks n ON n.id = wl.network_id AND n.status = 'active'
      WHERE lower(wl.dashboard_domain) = $1 AND wl.enabled AND wl.domain_verified_at IS NOT NULL`, [host]);
  const r = rows[0];
  let brand: PublicBrand | null = null;
  if (r) {
    const images = await networkBranding(r.network_id);
    brand = {
      networkSlug: r.slug, brandName: r.brand_name ?? r.name, logoUrl: images.logoUrl, faviconUrl: images.faviconUrl,
      primaryColor: r.primary_color, supportUrl: r.support_url, hidePlatformBranding: r.hide_platform_branding,
    };
  }
  try { await getRedis().set(brandKey(host), brand ? JSON.stringify(brand) : 'none', 'EX', 60); } catch { /* best effort */ }
  return brand;
}
