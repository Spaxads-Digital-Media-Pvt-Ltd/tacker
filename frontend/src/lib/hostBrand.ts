/**
 * The brand of the host the app is served on (white-label): on a network's verified dashboard domain the
 * API answers GET /api/public/brand?host= with its name, logo, favicon, colour and support link; anywhere
 * else it's 404 and the platform's own brand stays. Asked once per page load; applying it sets the page
 * title, the favicon and the accent colour (CSS variables are RGB triplets — index.css).
 */
import { useEffect, useState } from 'react';

export interface HostBrand {
  networkSlug: string; brandName: string; logoUrl: string | null; faviconUrl: string | null; primaryColor: string | null;
  supportUrl: string | null; hidePlatformBranding: boolean;
}

let pending: Promise<HostBrand | null> | null = null;
let current: HostBrand | null = null;

/** "#1E3557" → "30 53 87" (the triplet form the theme variables use), or null. */
export function hexToTriplet(hex: string | null | undefined): string | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '');
  return m ? `${parseInt(m[1]!, 16)} ${parseInt(m[2]!, 16)} ${parseInt(m[3]!, 16)}` : null;
}

function apply(b: HostBrand): void {
  if (typeof document === 'undefined') return;
  document.title = b.brandName;
  if (b.faviconUrl) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = b.faviconUrl;
  }
  const rgb = hexToTriplet(b.primaryColor);
  if (rgb) {
    const root = document.documentElement.style;
    root.setProperty('--accent', rgb);
    root.setProperty('--accent-hover', rgb);
  }
}

/** Fetch (once) and apply the host's brand. */
export function loadHostBrand(): Promise<HostBrand | null> {
  if (pending) return pending;
  if (typeof window === 'undefined') return Promise.resolve(null);
  pending = fetch(`/api/public/brand?host=${encodeURIComponent(window.location.host)}`, { credentials: 'omit' })
    .then(async (res) => (res.ok ? ((await res.json()) as { data?: HostBrand }).data ?? null : null))
    .catch(() => null)
    .then((b) => { current = b; if (b) apply(b); return b; });
  return pending;
}

/** The host's brand (null on the platform's own domain, and until it has loaded). */
export function useHostBrand(): HostBrand | null {
  const [brand, setBrand] = useState<HostBrand | null>(current);
  useEffect(() => { let live = true; void loadHostBrand().then((b) => { if (live) setBrand(b); }); return () => { live = false; }; }, []);
  return brand;
}
