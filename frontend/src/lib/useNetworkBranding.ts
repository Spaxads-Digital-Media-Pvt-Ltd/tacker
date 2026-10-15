/**
 * The network's branding images (O12 — Control Center › Platform › Logo / Favicon), shown to everyone
 * in the network: staff and partner / advertiser portals (GET /api/me carries them as stored URLs).
 * The favicon replaces the tab icon while signed in and is put back on sign-out.
 */
import { useEffect } from 'react';
import { useQuery } from './useApi';

export function useNetworkBranding(enabled: boolean): { logoUrl: string | null } {
  const { data } = useQuery<{ branding?: { logoUrl: string | null; faviconUrl: string | null } }>(enabled ? '/api/me' : null);
  const logoUrl = data?.branding?.logoUrl ?? null;
  const faviconUrl = data?.branding?.faviconUrl ?? null;
  useEffect(() => {
    if (!faviconUrl) return;
    let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    const added = !link;
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    const before = link.href;
    link.href = faviconUrl;
    return () => { if (added) link.remove(); else link.href = before; };
  }, [faviconUrl]);
  return { logoUrl };
}
