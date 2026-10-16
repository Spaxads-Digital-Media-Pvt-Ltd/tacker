/**
 * The network's branding images (O12 — Control Center › Platform › Logo / Favicon), shown to everyone
 * in the network: staff and partner / advertiser portals (GET /api/me carries them as stored URLs).
 * The favicon replaces the tab icon while signed in and is put back on sign-out. The same answer
 * carries the network's overdue platform invoice for staff — the shell warns before a suspension.
 */
import { useEffect } from 'react';
import { useQuery } from './useApi';

/** The network's oldest overdue platform invoice — staff only (GET /api/me `billing.overdue`). */
export interface OverdueInvoice { id: string; number: string; total: string; currency: string; due_at: string; suspend_at: string }

export function useNetworkBranding(enabled: boolean): { logoUrl: string | null; overdueInvoice: OverdueInvoice | null } {
  const { data } = useQuery<{ branding?: { logoUrl: string | null; faviconUrl: string | null }; billing?: { overdue: OverdueInvoice | null } }>(enabled ? '/api/me' : null);
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
  return { logoUrl, overdueInvoice: data?.billing?.overdue ?? null };
}
